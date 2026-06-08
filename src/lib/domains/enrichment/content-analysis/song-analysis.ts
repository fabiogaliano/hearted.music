import { Result } from "better-result";
import { z } from "zod";
import type { AudioFeature } from "@/lib/domains/enrichment/audio-features/queries";
import {
	get as getSongAnalysis,
	insert as insertSongAnalysis,
	type SongAnalysis,
	type InsertData as SongAnalysisInsertData,
} from "@/lib/domains/enrichment/content-analysis/queries";
import type { LlmService } from "@/lib/integrations/llm/service";
import type { DbError } from "@/lib/shared/errors/database";
import type { AnalysisFailedError } from "@/lib/shared/errors/domain/analysis";
import type { LlmError } from "@/lib/shared/errors/external/llm";
import { getLyricsFormatLegend } from "../lyrics/utils/lyrics-formatter";
import {
	ACTIVE_INSTRUMENTAL_VERSION,
	ACTIVE_LYRICAL_VERSION,
	getInstrumentalPrompt,
	getLyricalPrompt,
} from "./prompts/registry";
import { type SongRead, SongReadSchema } from "./read-schema";

const ThemeSchema = z.object({ name: z.string(), description: z.string() });
const JourneyPointSchema = z.object({
	section: z.string(),
	mood: z.string(),
	description: z.string(),
});
const KeyLineSchema = z.object({ line: z.string(), insight: z.string() });

export const SongAnalysisLyricalSchema = z.object({
	headline: z.string(),
	compound_mood: z.string(),
	mood_description: z.string(),
	interpretation: z.string(),
	themes: z.array(ThemeSchema),
	journey: z.array(JourneyPointSchema),
	key_lines: z.array(KeyLineSchema),
	sonic_texture: z.string(),
});
export type SongAnalysisLyrical = z.infer<typeof SongAnalysisLyricalSchema>;

export const SongAnalysisInstrumentalSchema = z.object({
	headline: z.string(),
	compound_mood: z.string(),
	mood_description: z.string(),
	sonic_texture: z.string(),
});
type SongAnalysisInstrumental = z.infer<typeof SongAnalysisInstrumentalSchema>;

export interface AnalyzeSongInput {
	songId: string;
	artist: string;
	title: string;
	lyrics?: string | null;
	audioFeatures?: AudioFeature | null;
	genres?: string[];
	instrumentalness?: number;
	// Prebuilt prompt blocks for the v17+ {example} / {annotations} slots. The service NEVER
	// fetches golds or annotations itself (WP1 safety constraint); a caller assembles these and
	// passes them in. Both default to "" — older prompt versions have no slot to fill, so the
	// replace is a harmless no-op and existing callers are unaffected.
	exampleText?: string;
	annotationsBlock?: string;
}

export interface AnalyzeSongResult {
	songId: string;
	analysis: SongAnalysis;
	tokensUsed?: number;
	cached: boolean;
}

export interface BatchAnalysisResult {
	succeeded: AnalyzeSongResult[];
	failed: Array<{
		songId: string;
		artist: string;
		title: string;
		error: string;
	}>;
}

type SongAnalysisServiceError = DbError | LlmError | AnalysisFailedError;

const INSTRUMENTAL_WORD_THRESHOLD = 50;

export class SongAnalysisService {
	constructor(private readonly llm: LlmService) {}

	async analyzeSong(
		input: AnalyzeSongInput,
	): Promise<Result<AnalyzeSongResult, SongAnalysisServiceError>> {
		const { songId } = input;

		const existingResult = await getSongAnalysis(songId);
		if (Result.isError(existingResult)) {
			return Result.err(existingResult.error);
		}
		if (existingResult.value) {
			return Result.ok({
				songId,
				analysis: existingResult.value,
				cached: true,
			});
		}

		const isInstrumental = this.detectInstrumental(input);

		const prompt = isInstrumental
			? this.buildInstrumentalPrompt(input)
			: this.buildPrompt(input);

		const promptVersion = isInstrumental
			? ACTIVE_INSTRUMENTAL_VERSION
			: ACTIVE_LYRICAL_VERSION;

		// Lyrical generation is v17-only: the active prompt emits the redesigned { read }
		// model, so output is always validated against SongReadSchema, stored flat, and
		// rendered in production by SongDetailPanel. The legacy 8-field
		// SongAnalysisLyricalSchema is retained only for the voice-audit harness (it adapts
		// pre-v17 rows for v13-vs-v17 comparison) and is no longer in the prod path.
		// Instrumental still uses its own schema. See claudedocs/session-6-prod-panel-swap.md.
		const schema: z.ZodTypeAny = isInstrumental
			? SongAnalysisInstrumentalSchema
			: SongReadSchema;

		// A low temperature roughly halves the rate of AI-writing tells (participial
		// closures, framing openers) and collapses run-to-run variance, versus the
		// provider default of ~1.0. See claudedocs/voice-prompt-handoff-eval-and-optimize-phase.md.
		const llmResult = await this.llm.generateObject(prompt, schema, {
			temperature: 0.3,
			// v17 reads run ~3.2k output tokens but vary draw-to-draw; ~10% exceed
			// the 4k service default, truncate mid-JSON (finish=length), and fail to
			// parse. 8k gives the long draws headroom. Billed on actual tokens used,
			// so typical cost is unchanged.
			maxOutputTokens: 8000,
		});
		if (Result.isError(llmResult)) {
			return Result.err(llmResult.error);
		}

		const analysisData = this.buildAnalysisData(
			llmResult.value.output as SongRead | SongAnalysisInstrumental,
			input.audioFeatures,
		);

		const storeResult = await insertSongAnalysis({
			song_id: songId,
			analysis: analysisData as SongAnalysisInsertData["analysis"],
			model: llmResult.value.model,
			prompt_version: promptVersion,
			tokens_used: llmResult.value.tokens?.total ?? null,
			cost_cents: null,
		});

		if (Result.isError(storeResult)) {
			return Result.err(storeResult.error);
		}

		return Result.ok({
			songId,
			analysis: storeResult.value,
			tokensUsed: llmResult.value.tokens?.total,
			cached: false,
		});
	}

	async analyzeBatch(
		inputs: AnalyzeSongInput[],
	): Promise<Result<BatchAnalysisResult, DbError>> {
		const succeeded: AnalyzeSongResult[] = [];
		const failed: Array<{
			songId: string;
			artist: string;
			title: string;
			error: string;
		}> = [];

		for (const input of inputs) {
			const result = await this.analyzeSong(input);

			if (Result.isOk(result)) {
				succeeded.push(result.value);
			} else {
				failed.push({
					songId: input.songId,
					artist: input.artist,
					title: input.title,
					error:
						result.error instanceof Error
							? result.error.message
							: String(result.error),
				});
			}
		}

		return Result.ok({ succeeded, failed });
	}

	private detectInstrumental(input: AnalyzeSongInput): boolean {
		if (!input.lyrics || input.lyrics.trim().length === 0) {
			return true;
		}

		const instrumentalness =
			input.instrumentalness ?? input.audioFeatures?.instrumentalness;
		if (instrumentalness != null && instrumentalness > 0.5) {
			return true;
		}

		const wordCount = input.lyrics.trim().split(/\s+/).length;
		if (wordCount < INSTRUMENTAL_WORD_THRESHOLD) {
			return true;
		}

		return false;
	}

	private buildPrompt(input: AnalyzeSongInput): string {
		const genres = this.formatGenres(input.genres);
		const lyricsWithLegend = `${getLyricsFormatLegend()}\n${input.lyrics}`;
		return getLyricalPrompt()
			.template.replace("{artist}", input.artist)
			.replace("{title}", input.title)
			.replace("{genres}", genres)
			.replace("{lyrics}", lyricsWithLegend)
			.replace(
				"{audio_features}",
				this.formatAudioFeatures(input.audioFeatures),
			)
			.replace("{example}", input.exampleText ?? "")
			.replace("{annotations}", input.annotationsBlock ?? "");
	}

	private buildInstrumentalPrompt(input: AnalyzeSongInput): string {
		const genres = this.formatGenres(input.genres);
		return getInstrumentalPrompt()
			.template.replace("{artist}", input.artist)
			.replace("{title}", input.title)
			.replace("{genres}", genres)
			.replace(
				"{audio_features}",
				this.formatAudioFeatures(input.audioFeatures),
			);
	}

	private formatGenres(genres?: string[]): string {
		if (!genres || genres.length === 0) return "Unknown";
		return genres.join(", ");
	}

	private formatAudioFeatures(features?: AudioFeature | null): string {
		if (!features) {
			return "Audio features not available - analyze based on lyrics only";
		}

		return `Tempo: ${features.tempo ?? "unknown"} BPM
Energy: ${features.energy ?? "unknown"} (0.0 = low, 1.0 = high)
Valence: ${features.valence ?? "unknown"} (0.0 = sad/negative, 1.0 = happy/positive)
Danceability: ${features.danceability ?? "unknown"} (0.0 = not danceable, 1.0 = very danceable)
Acousticness: ${features.acousticness ?? "unknown"} (0.0 = not acoustic, 1.0 = acoustic)
Instrumentalness: ${features.instrumentalness ?? "unknown"} (0.0 = vocal, 1.0 = instrumental)
Liveness: ${features.liveness ?? "unknown"} (0.0 = studio, 1.0 = live performance)
Speechiness: ${features.speechiness ?? "unknown"} (0.0 = non-speech, 1.0 = speech-like)
Loudness: ${features.loudness ?? "unknown"} dB`;
	}

	private buildAnalysisData(
		llmOutput: SongRead | SongAnalysisInstrumental,
		audioFeatures?: AudioFeature | null,
	): Record<string, unknown> {
		const analysisData: Record<string, unknown> = { ...llmOutput };
		if (audioFeatures) {
			analysisData.audio_features = {
				tempo: audioFeatures.tempo,
				energy: audioFeatures.energy,
				valence: audioFeatures.valence,
				danceability: audioFeatures.danceability,
				acousticness: audioFeatures.acousticness,
				instrumentalness: audioFeatures.instrumentalness,
				liveness: audioFeatures.liveness,
				speechiness: audioFeatures.speechiness,
				loudness: audioFeatures.loudness,
			};
		}
		return analysisData;
	}
}
