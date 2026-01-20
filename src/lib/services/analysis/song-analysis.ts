/**
 * SongAnalysisService - LLM-based song analysis.
 *
 * Responsibilities:
 * - Generate comprehensive song analysis using LLM
 * - Build structured prompts from lyrics + audio features
 * - Store analysis results via data/analysis.ts
 *
 * Uses:
 * - LlmService for AI SDK calls
 * - Zod schemas for structured output
 * - Result<T, Error> for composable error handling
 */

import { Result } from "better-result";
import { z } from "zod";
import type { LlmService } from "../llm/service";
import * as songAnalysis from "@/lib/data/song-analysis";
import type { DbError } from "@/lib/errors/database";
import { AnalysisFailedError, NoLyricsAvailableError } from "@/lib/errors/domain/analysis";
import { type LlmError } from "@/lib/errors/external/llm";
import type { SongAnalysis } from "@/lib/data/song-analysis";
import type { AudioFeature } from "@/lib/data/song-audio-feature";
import { getLyricsFormatLegend } from "@/lib/services/lyrics/utils/lyrics-formatter";

// ============================================================================
// Zod Schemas for Structured LLM Output
// ============================================================================

/** Theme identified in a song */
const ThemeSchema = z.object({
	name: z.string(),
	confidence: z.number().min(0).max(1),
	description: z.string(),
});

/** Metaphor found in lyrics */
const MetaphorSchema = z.object({
	text: z.string(),
	meaning: z.string(),
});

/** Key lyric line */
const KeyLineSchema = z.object({
	line: z.string(),
	significance: z.string(),
});

/** Interpretation of song meaning */
const InterpretationSchema = z.object({
	surface_meaning: z.string(),
	deeper_meaning: z.string(),
	cultural_significance: z.string().optional(),
	metaphors: z.array(MetaphorSchema).optional(),
	key_lines: z.array(KeyLineSchema).optional(),
});

/** Song meaning section */
const MeaningSchema = z.object({
	themes: z.array(ThemeSchema),
	interpretation: InterpretationSchema,
});

/** Emotional journey point */
const JourneyPointSchema = z.object({
	section: z.string(),
	mood: z.string(),
	description: z.string(),
});

/** Emotional analysis */
const EmotionalSchema = z.object({
	dominant_mood: z.string(),
	mood_description: z.string(),
	intensity: z.number().min(0).max(1),
	valence: z.number().min(0).max(1),
	energy: z.number().min(0).max(1),
	journey: z.array(JourneyPointSchema).optional(),
	emotional_peaks: z.array(z.string()).optional(),
});

/** Listening contexts scores */
const ListeningContextsSchema = z.object({
	workout: z.number().min(0).max(1),
	party: z.number().min(0).max(1),
	relaxation: z.number().min(0).max(1),
	focus: z.number().min(0).max(1),
	driving: z.number().min(0).max(1),
	emotional_release: z.number().min(0).max(1),
	cooking: z.number().min(0).max(1),
	social_gathering: z.number().min(0).max(1),
	morning_routine: z.number().min(0).max(1),
	late_night: z.number().min(0).max(1),
	romance: z.number().min(0).max(1),
	meditation: z.number().min(0).max(1),
});

/** Target audience info */
const AudienceSchema = z.object({
	primary_demographic: z.string().optional(),
	universal_appeal: z.number().min(0).max(1),
	resonates_with: z.array(z.string()),
});

/** Context analysis */
const ContextSchema = z.object({
	listening_contexts: ListeningContextsSchema,
	best_moments: z.array(z.string()),
	audience: AudienceSchema.optional(),
});

/** Musical style analysis */
const MusicalStyleSchema = z.object({
	genre_primary: z.string(),
	genre_secondary: z.string().optional(),
	vocal_style: z.string(),
	production_style: z.string(),
	sonic_texture: z.string(),
	distinctive_elements: z.array(z.string()).optional(),
});

/** Matching profile for playlist fitting */
const MatchingProfileSchema = z.object({
	mood_consistency: z.number().min(0).max(1),
	energy_flexibility: z.number().min(0).max(1),
	theme_cohesion: z.number().min(0).max(1),
	sonic_similarity: z.number().min(0).max(1),
});

/** Complete LLM analysis output */
export const SongAnalysisLlmSchema = z.object({
	meaning: MeaningSchema,
	emotional: EmotionalSchema,
	context: ContextSchema,
	musical_style: MusicalStyleSchema,
	matching_profile: MatchingProfileSchema,
});
export type SongAnalysisLlm = z.infer<typeof SongAnalysisLlmSchema>;

// ============================================================================
// Types
// ============================================================================

/** Input for analyzing a single song */
export interface AnalyzeSongInput {
	songId: string;
	artist: string;
	title: string;
	lyrics: string;
	audioFeatures?: AudioFeature | null;
}

/** Result of a song analysis */
export interface AnalyzeSongResult {
	songId: string;
	analysis: SongAnalysis;
	tokensUsed?: number;
	cached: boolean;
}

/** Batch analysis result */
export interface BatchAnalysisResult {
	succeeded: AnalyzeSongResult[];
	failed: Array<{
		songId: string;
		artist: string;
		title: string;
		error: string;
	}>;
}

type SongAnalysisServiceError = DbError | LlmError | AnalysisFailedError | NoLyricsAvailableError;

// ============================================================================
// Prompt Template
// ============================================================================

const SONG_ANALYSIS_PROMPT = `You are an expert music analyst. Analyze this song comprehensively using both lyrics and audio features.

Artist: {artist}
Title: {title}

Lyrics and Annotations:
{lyrics}

Audio Features:
{audio_features}

Use the audio features to inform your analysis:
- High energy/tempo/danceability → higher workout/party/driving scores
- High valence → positive mood, low valence → melancholic/dark mood
- High acousticness → organic/intimate, low → electronic/produced
- Use actual valence and energy values in the emotional section

IMPORTANT STYLE GUIDELINES:
- Write in direct, present-tense language as an observer
- Never use phrases like "The song is about..." or "The artist expresses..."
- Instead use patterns like: "Someone's fighting to...", "We're witnessing...", "Here's a person who..."
- Make the emotional journey follow the actual song structure
- Be specific about which lyrics appear in which sections

Provide your analysis as a structured JSON response.`;

// ============================================================================
// Service
// ============================================================================

export class SongAnalysisService {
	constructor(private readonly llm: LlmService) { }

	/**
	 * Analyzes a song and stores the result.
	 * Returns cached analysis if available and still valid.
	 */
	async analyzeSong(
		input: AnalyzeSongInput,
	): Promise<Result<AnalyzeSongResult, SongAnalysisServiceError>> {
		const { songId, artist, title, lyrics, audioFeatures } = input;

		// 1. Check for existing analysis
		const existingResult = await songAnalysis.get(songId);
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

		// 2. Validate lyrics
		if (!lyrics || lyrics.trim().length === 0) {
			return Result.err(new NoLyricsAvailableError(songId, artist, title));
		}

		// 3. Build prompt
		const prompt = this.buildPrompt(artist, title, lyrics, audioFeatures);

		// 4. Call LLM
		const llmResult = await this.llm.generateObject(prompt, SongAnalysisLlmSchema);
		if (Result.isError(llmResult)) {
			return Result.err(llmResult.error);
		}

		// 5. Build final analysis with audio features
		const analysisData = this.buildAnalysisData(llmResult.value.output, audioFeatures);

		// 6. Store in database
		const storeResult = await songAnalysis.insert({
			song_id: songId,
			analysis: analysisData as songAnalysis.InsertData["analysis"],
			model: llmResult.value.model,
			prompt_version: "1",
			tokens_used: llmResult.value.tokens?.total ?? null,
			cost_cents: null, // Could calculate based on model pricing
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

	/**
	 * Analyzes multiple songs in batch.
	 * Processes sequentially to respect rate limits.
	 */
	async analyzeBatch(
		inputs: AnalyzeSongInput[],
	): Promise<Result<BatchAnalysisResult, DbError>> {
		const succeeded: AnalyzeSongResult[] = [];
		const failed: Array<{ songId: string; artist: string; title: string; error: string }> = [];

		for (const input of inputs) {
			const result = await this.analyzeSong(input);

			if (Result.isOk(result)) {
				succeeded.push(result.value);
			} else {
				failed.push({
					songId: input.songId,
					artist: input.artist,
					title: input.title,
					error: result.error instanceof Error ? result.error.message : String(result.error),
				});
			}
		}

		return Result.ok({ succeeded, failed });
	}

	// ============================================================================
	// Private Helpers
	// ============================================================================

	/**
	 * Builds the analysis prompt from input data.
	 */
	private buildPrompt(
		artist: string,
		title: string,
		lyrics: string,
		audioFeatures?: AudioFeature | null,
	): string {
		const lyricsWithLegend = `${getLyricsFormatLegend()}\n${lyrics}`;
		return SONG_ANALYSIS_PROMPT
			.replace("{artist}", artist)
			.replace("{title}", title)
			.replace("{lyrics}", lyricsWithLegend)
			.replace("{audio_features}", this.formatAudioFeatures(audioFeatures));
	}

	/**
	 * Formats audio features as human-readable text.
	 */
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

	/**
	 * Builds the final analysis data to store.
	 */
	private buildAnalysisData(
		llmOutput: SongAnalysisLlm,
		audioFeatures?: AudioFeature | null,
	): Record<string, unknown> {
		const analysisData: Record<string, unknown> = { ...llmOutput };
		// Include audio features in stored analysis
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
