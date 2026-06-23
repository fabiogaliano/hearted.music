import { Result } from "better-result";
import { z } from "zod";
import type { AudioFeature } from "@/lib/domains/enrichment/audio-features/queries";
import {
	get as getSongAnalysis,
	type SongAnalysis,
	type InsertData as SongAnalysisInsertData,
	upsert as upsertSongAnalysis,
} from "@/lib/domains/enrichment/content-analysis/queries";
import type { LlmService } from "@/lib/integrations/llm/service";
import type { DbError } from "@/lib/shared/errors/database";
import type { AnalysisFailedError } from "@/lib/shared/errors/domain/analysis";
import type { LlmError } from "@/lib/shared/errors/external/llm";
import { settleInstrumentalFromAnalysis } from "../lyrics/queries";
import type { LyricsOutcome } from "../lyrics/types/lyrics.types";
import { getLyricsFormatLegend } from "../lyrics/utils/lyrics-formatter";
import {
	hasInstrumentalGenre,
	matchedInstrumentalGenre,
} from "./instrumental-genres";
import {
	hasRejectedInstrumentalReview,
	type InstrumentalReviewSignal,
	upsertPendingInstrumentalReview,
} from "./instrumental-review-queries";
import { type RecordLlmUsageInput, recordLlmUsage } from "./llm-usage-queries";
import {
	ACTIVE_INSTRUMENTAL_VERSION,
	ACTIVE_LYRICAL_VERSION,
	getInstrumentalPrompt,
	getLyricalPrompt,
} from "./prompts/registry";
import { type SongRead, SongReadSchema } from "./read-schema";
import {
	type RewritePassUsage,
	rewriteRead,
	TARGET_RULES,
} from "./voice/rewrite-pass";

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
	/**
	 * Typed outcome from the lyrics fetch (Decision 5). When present, the
	 * classifier uses it as the highest-precedence signal (step 1 of Decision 3):
	 *   - kind "instrumental" → classified instrumental regardless of other signals
	 *   - kind "lyrics"       → classified lyrical when above the word floor
	 *   - kind "not_found"    → no fetch signal; fall through to genre / instrumentalness
	 * When absent the classifier falls through directly to genre / instrumentalness.
	 */
	fetchOutcome?: LyricsOutcome;
	// Prebuilt prompt blocks for the v17+ {example} / {annotations} slots. The service NEVER
	// fetches golds or annotations itself (WP1 safety constraint); a caller assembles these and
	// passes them in. Both default to "" — older prompt versions have no slot to fill, so the
	// replace is a harmless no-op and existing callers are unaffected.
	exampleText?: string;
	annotationsBlock?: string;
	ignoreExistingAnalysis?: boolean;
}

export interface AnalyzeSongResult {
	songId: string;
	analysis: SongAnalysis;
	tokensUsed?: number;
	cached: boolean;
}

/**
 * Returned by analyzeSong when the classifier resolves to "unknown" — no
 * authoritative signal (lyrics, instrumental flag, genre keyword, or
 * instrumentalness ≥ 0.9) was available. The song is recorded as a retry
 * candidate: the caller should persist this state without writing an analysis
 * row, so the song remains selectable once better data arrives.
 */
export interface AnalyzeSongRetryCandidate {
	kind: "retry_candidate";
	songId: string;
}

/** Type guard: narrows `AnalyzeSongResult | AnalyzeSongRetryCandidate` to a retry candidate. */
export function isRetryCandidate(
	result: AnalyzeSongResult | AnalyzeSongRetryCandidate,
): result is AnalyzeSongRetryCandidate {
	return "kind" in result && result.kind === "retry_candidate";
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

/**
 * Minimum word count for a lyrics string to be considered "real lyrics" at
 * precedence step 2. Mirrors the previous detectInstrumental threshold.
 */
const LYRICS_WORD_FLOOR = 50;

/**
 * Minimum Spotify instrumentalness value that counts as a positive instrumental
 * signal (step 4 of Decision 3). Values below this threshold carry no vote.
 */
const INSTRUMENTALNESS_HIGH_THRESHOLD = 0.9;

export class SongAnalysisService {
	constructor(private readonly llm: LlmService) {}

	async analyzeSong(
		input: AnalyzeSongInput,
	): Promise<
		Result<
			AnalyzeSongResult | AnalyzeSongRetryCandidate,
			SongAnalysisServiceError
		>
	> {
		const { songId } = input;

		if (!input.ignoreExistingAnalysis) {
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
		}

		const contentType = this.classifyContentType(input);

		if (contentType === "unknown") {
			console.info(
				`[SongAnalysis] song ${songId} (${input.artist} – ${input.title}) classified unknown: no authoritative signal from fetch outcome, genres, or instrumentalness ≥ 0.9. Recording as retry candidate.`,
			);
			return Result.ok({ kind: "retry_candidate", songId });
		}

		const isInstrumental = contentType === "instrumental";

		// True when the instrumental verdict came from the genre / instrumentalness
		// heuristic rather than an authoritative provider-confirmed instrumental
		// outcome (step 1). Only these fallible determinations are settled into the
		// lyrics state and surfaced for operator review.
		const audioDeterminedInstrumental =
			isInstrumental && input.fetchOutcome?.kind !== "instrumental";

		// Honor a prior operator rejection ("this has vocals") before spending an LLM
		// call: skip the heuristic and wait for real lyrics instead of re-classifying
		// instrumental and re-surfacing a review the operator already dismissed.
		if (
			audioDeterminedInstrumental &&
			(await hasRejectedInstrumentalReview(songId))
		) {
			console.info(
				`[SongAnalysis] song ${songId} (${input.artist} – ${input.title}) instrumental verdict vetoed by a prior operator rejection. Recording as retry candidate (awaiting lyrics).`,
			);
			return Result.ok({ kind: "retry_candidate", songId });
		}

		const prompt = isInstrumental
			? this.buildInstrumentalPrompt(input)
			: this.buildPrompt(input);

		const promptVersion = isInstrumental
			? ACTIVE_INSTRUMENTAL_VERSION
			: ACTIVE_LYRICAL_VERSION;

		// Lyrical generation is v17: the active prompt emits the redesigned { read }
		// model, so output is validated against SongReadSchema, stored flat, and rendered
		// in production by SongDetailPanel. Instrumental uses its own schema.
		const schema: z.ZodTypeAny = isInstrumental
			? SongAnalysisInstrumentalSchema
			: SongReadSchema;

		// A low temperature roughly halves the rate of AI-writing tells (participial
		// closures, framing openers) and collapses run-to-run variance, versus the
		// provider default of ~1.0.
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

		// Post-generation cleanup pass (lyrical only). A second, surgical Flash call recasts the
		// HIGH-severity AI-tell constructions the tier1 checker flags (participial closures,
		// self-reference, the "not X, it's Y" pivot) while preserving every grounded claim — lens,
		// tension, and the verbatim lyric lines are pinned in code (voice/rewrite-pass.ts applySurgical),
		// so the pass can recast a flagged sentence but can never drift the content, invent a fact, or
		// fill a null field. Measured over the real production population (n=58): 5.28 → 0.19 HIGH
		// tells/read (96% removed), 90% of reads fully clean, prose length −0.4% (no gutting). It does
		// NOT close the depth/correctness gap to the hand-written golds — it cleans how the writing
		// sounds, not how deep it is. Generation-side few-shot examples were measured and REJECTED as a
		// wash on the real population (−0.07/read). See
		// scripts/voice-audit/experiments/changelog.md (Phase 4, Rounds 5 + 5b). On any rewrite/LLM error rewriteRead returns the original read unchanged, so
		// the cleanup can never block, fail, or corrupt an analysis — it only ever improves or no-ops.
		let generatedOutput = llmResult.value.output as
			| SongRead
			| SongAnalysisInstrumental;
		// Capture the cleanup outcome so prod efficacy is queryable instead of re-derived
		// offline (the rewrite otherwise discards it). Counts are filtered to the rules the
		// pass actually targets — residual structural HIGH rules it never touches would
		// misattribute as "cleanup left a tell". Stays null for instrumentals (no rewrite),
		// keeping "not applicable" distinct from 0 ("ran, nothing left").
		let cleanupMeta: {
			cleanup_passes: number;
			cleanup_tells_before: number;
			cleanup_tells_after: number;
			cleanup_error: string | null;
		} | null = null;
		// Per-pass rewrite spend, captured for the ledger (each pass is a real Flash call
		// whose tokens were previously summed-then-discarded). Empty for instrumentals.
		let rewriteUsages: RewritePassUsage[] = [];
		if (!isInstrumental) {
			const cleaned = await rewriteRead(generatedOutput as SongRead, this.llm);
			generatedOutput = cleaned.read;
			rewriteUsages = cleaned.usages;
			cleanupMeta = {
				cleanup_passes: cleaned.passes,
				cleanup_tells_before: cleaned.hitsBefore.filter((h) =>
					TARGET_RULES.has(h.rule),
				).length,
				cleanup_tells_after: cleaned.hitsAfter.filter((h) =>
					TARGET_RULES.has(h.rule),
				).length,
				cleanup_error: cleaned.error ?? null,
			};
		}

		// Ledger real call-time spend right after the calls happen — the generation, plus
		// one row per voice-rewrite pass on lyrical songs (instrumentals skip the rewrite, so
		// rewriteUsages is empty). Recorded before the analysis insert so a storage failure
		// still leaves an accurate record of tokens actually billed.
		await this.recordUsage({
			functionId: "song-analysis",
			songId,
			provider: llmResult.value.provider,
			model: llmResult.value.modelId,
			tokens: llmResult.value.tokens,
			costUsd: llmResult.value.costUsd,
			promptVersion,
		});
		for (const usage of rewriteUsages) {
			await this.recordUsage({
				functionId: "song-rewrite",
				songId,
				provider: usage.provider,
				model: usage.model,
				tokens: usage.tokens,
				costUsd: usage.costUsd,
				promptVersion,
			});
		}

		const analysisData = this.buildAnalysisData(
			generatedOutput,
			input.audioFeatures,
		);

		const storeResult = await upsertSongAnalysis({
			song_id: songId,
			analysis: analysisData as SongAnalysisInsertData["analysis"],
			model: llmResult.value.model,
			prompt_version: promptVersion,
			tokens_used: llmResult.value.tokens?.total ?? null,
			cost_cents: null,
			cleanup_passes: cleanupMeta?.cleanup_passes ?? null,
			cleanup_tells_before: cleanupMeta?.cleanup_tells_before ?? null,
			cleanup_tells_after: cleanupMeta?.cleanup_tells_after ?? null,
			cleanup_error: cleanupMeta?.cleanup_error ?? null,
		});

		if (Result.isError(storeResult)) {
			return Result.err(storeResult.error);
		}

		// Settle the lyrics state and log the determination for operator review. A
		// genre/instrumentalness verdict that leaves song_lyrics on 'not_found' is
		// exactly what makes the selector re-probe the song forever; writing the
		// instrumental row closes that loop. Best-effort — never fails the analysis.
		if (audioDeterminedInstrumental) {
			await this.settleInstrumentalDetermination({
				songId,
				genres: input.genres,
				instrumentalness:
					input.instrumentalness ??
					input.audioFeatures?.instrumentalness ??
					null,
			});
		}

		return Result.ok({
			songId,
			analysis: storeResult.value,
			tokensUsed: llmResult.value.tokens?.total,
			cached: false,
		});
	}

	/**
	 * Propagate a genre/instrumentalness instrumental verdict to the lyrics state
	 * (so the selector stops re-probing) and record it as a pending operator review
	 * (the heuristic occasionally mislabels a vocal track). Best-effort and ordered:
	 * a failed settle skips the review so the two never drift out of sync.
	 *
	 * Returns true only when the lyrics settle succeeded. analyzeSong runs this once
	 * after a song's first analysis and ignores the result (best-effort). The
	 * re-probe stage re-invokes it for any still-not_found song that already carries
	 * an instrumental analysis — the durable retry for a settle that transiently
	 * failed here, which would otherwise leave the song looping in the re-probe path
	 * forever — and uses the boolean to tell a resolved song from one to retry.
	 */
	async settleInstrumentalDetermination(input: {
		songId: string;
		genres?: string[] | null;
		instrumentalness?: number | null;
	}): Promise<boolean> {
		const settled = await settleInstrumentalFromAnalysis(input.songId);
		if (Result.isError(settled)) {
			console.warn(
				`[SongAnalysis] failed to settle instrumental lyrics state for ${input.songId}: ${settled.error.message}`,
			);
			return false;
		}

		const matchedGenre =
			input.genres && input.genres.length > 0
				? matchedInstrumentalGenre(input.genres)
				: null;
		// Classifier precedence: a genre keyword (step 3) wins over the
		// instrumentalness tiebreak (step 4), so a match means genre decided it.
		const signal: InstrumentalReviewSignal = matchedGenre
			? "genre"
			: "instrumentalness";

		const review = await upsertPendingInstrumentalReview({
			songId: input.songId,
			signal,
			instrumentalness: input.instrumentalness ?? null,
			matchedGenre,
		});
		if (Result.isError(review)) {
			console.warn(
				`[SongAnalysis] failed to record instrumental review for ${input.songId}: ${review.error.message}`,
			);
		}
		return true;
	}

	// Best-effort ledger write: a failed cost insert is logged, never propagated, so
	// cost tracking can never fail an analysis. See llm-usage-queries.ts.
	private async recordUsage(input: RecordLlmUsageInput): Promise<void> {
		const recorded = await recordLlmUsage(input);
		if (Result.isError(recorded)) {
			console.warn(
				`[llm-usage] failed to record ${input.functionId} for song ${input.songId}: ${recorded.error.message}`,
			);
		}
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
				// retry_candidate rows are not stored analyses; skip them here
				if (!isRetryCandidate(result.value)) {
					succeeded.push(result.value);
				}
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

	/**
	 * Classifies a song's content type using a fixed precedence of trustworthy
	 * signals (design.md Decision 3). First hit wins:
	 *
	 * 1. Confirmed-instrumental fetch outcome (LRCLIB flag or Genius page) → instrumental
	 * 2. Real lyrics in hand (at or above LYRICS_WORD_FLOOR words) → lyrical
	 * 3. Genres intersect the curated instrumental keyword set → instrumental
	 * 4. instrumentalness ≥ INSTRUMENTALNESS_HIGH_THRESHOLD → instrumental
	 * 5. Otherwise → unknown (no LLM call; recorded as retry candidate)
	 *
	 * Instrumentalness below 0.9 carries no vote in either direction.
	 */
	classifyContentType(
		input: AnalyzeSongInput,
	): "lyrical" | "instrumental" | "unknown" {
		// Step 1: confirmed-instrumental fetch outcome
		if (input.fetchOutcome?.kind === "instrumental") {
			return "instrumental";
		}

		// Step 2: real lyrics in hand (fetch outcome "lyrics" OR lyrics text present)
		const lyrics = input.lyrics?.trim() ?? "";
		const wordCount = lyrics.length > 0 ? lyrics.split(/\s+/).length : 0;
		if (wordCount >= LYRICS_WORD_FLOOR) {
			return "lyrical";
		}

		// Step 3: genre keyword match against curated instrumental set
		if (
			input.genres &&
			input.genres.length > 0 &&
			hasInstrumentalGenre(input.genres)
		) {
			return "instrumental";
		}

		// Step 4: high-extreme instrumentalness only (≥ 0.9)
		const instrumentalness =
			input.instrumentalness ??
			input.audioFeatures?.instrumentalness ??
			undefined;
		if (
			instrumentalness !== undefined &&
			instrumentalness >= INSTRUMENTALNESS_HIGH_THRESHOLD
		) {
			return "instrumental";
		}

		return "unknown";
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
