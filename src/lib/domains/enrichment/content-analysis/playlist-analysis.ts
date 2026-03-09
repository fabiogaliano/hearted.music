/**
 * PlaylistAnalysisService - LLM-based playlist analysis.
 *
 * Responsibilities:
 * - Generate comprehensive playlist analysis using LLM
 * - Build structured prompts from playlist metadata + tracks
 * - Store analysis results via data/analysis.ts
 *
 * Uses:
 * - LlmService for AI SDK calls
 * - Zod schemas for structured output
 * - Result<T, Error> for composable error handling
 */

import { Result } from "better-result";
import { z } from "zod";
import type {
	InsertData as InsertPlaylistAnalysis,
	PlaylistAnalysis,
} from "@/lib/data/playlist-analysis";
import * as playlistAnalysis from "@/lib/data/playlist-analysis";
import type { LlmService } from "@/lib/ml/llm/service";
import type { DbError } from "@/lib/shared/errors/database";
import { AnalysisFailedError } from "@/lib/shared/errors/domain/analysis";
import type { LlmError } from "@/lib/shared/errors/external/llm";

/** Core theme in a playlist */
const CoreThemeSchema = z.object({
	name: z.string(),
	confidence: z.number().min(0).max(1),
	description: z.string(),
	cultural_significance: z.string().optional(),
	supporting_tracks: z.array(z.string()).optional(),
});

/** Cultural identity markers */
const CulturalIdentitySchema = z.object({
	primary_community: z.string().optional(),
	generational_markers: z.array(z.string()).optional(),
	social_movements: z.array(z.string()).optional(),
	historical_context: z.string().optional(),
	geographic_culture: z.string().optional(),
});

/** Contradiction analysis */
const ContradictionAnalysisSchema = z.object({
	internal_conflicts: z.array(z.string()).optional(),
	resolution: z.string().optional(),
});

/** Playlist meaning section */
const PlaylistMeaningSchema = z.object({
	playlist_purpose: z.string(),
	core_themes: z.array(CoreThemeSchema),
	cultural_identity: CulturalIdentitySchema.optional(),
	main_message: z.string(),
	contradiction_analysis: ContradictionAnalysisSchema.optional(),
});

/** Dominant mood info */
const DominantMoodSchema = z.object({
	mood: z.string(),
	description: z.string(),
	consistency: z.number().min(0).max(1),
});

/** Emotional arc */
const EmotionalArcSchema = z.object({
	opening_mood: z.string(),
	peak_moments: z.array(z.string()).optional(),
	resolution: z.string().optional(),
	journey_type: z.string(),
});

/** Playlist emotional section */
const PlaylistEmotionalSchema = z.object({
	dominant_mood: DominantMoodSchema,
	emotional_arc: EmotionalArcSchema.optional(),
	intensity_score: z.number().min(0).max(1),
	emotional_range: z.number().min(0).max(1),
	catharsis_potential: z.number().min(0).max(1).optional(),
});

/** Social context scores */
const SocialContextSchema = z.object({
	alone_vs_group: z.number().min(0).max(1),
	intimate_vs_public: z.number().min(0).max(1),
	active_vs_passive: z.number().min(0).max(1),
});

/** Situational fit */
const SituationsSchema = z.object({
	perfect_for: z.array(z.string()),
	avoid_during: z.array(z.string()).optional(),
	why: z.string().optional(),
});

/** Temporal context */
const TemporalContextSchema = z.object({
	time_of_day: z.array(z.string()).optional(),
	season: z.array(z.string()).optional(),
	life_moments: z.array(z.string()).optional(),
});

/** Listening experience */
const ListeningExperienceSchema = z.object({
	attention_level: z.string(),
	interaction_style: z.string(),
	repeat_potential: z.number().min(0).max(1).optional(),
});

/** Playlist context section */
const PlaylistContextSchema = z.object({
	primary_setting: z.string(),
	social_context: SocialContextSchema.optional(),
	situations: SituationsSchema,
	temporal_context: TemporalContextSchema.optional(),
	listening_experience: ListeningExperienceSchema.optional(),
});

/** Flow analysis */
const FlowAnalysisSchema = z.object({
	transition_quality: z.number().min(0).max(1),
	pacing: z.string(),
	narrative_structure: z.string().optional(),
});

/** Target matching constraints */
const TargetMatchingSchema = z.object({
	genre_flexibility: z.number().min(0).max(1),
	mood_rigidity: z.number().min(0).max(1),
	cultural_specificity: z.number().min(0).max(1).optional(),
	era_constraints: z.number().min(0).max(1).optional(),
});

/** Expansion guidelines */
const ExpansionGuidelinesSchema = z.object({
	must_have_elements: z.array(z.string()),
	deal_breakers: z.array(z.string()).optional(),
	growth_potential: z.array(z.string()).optional(),
});

/** Curation analysis */
const CurationSchema = z.object({
	cohesion_factors: z.array(z.string()),
	flow_analysis: FlowAnalysisSchema.optional(),
	target_matching: TargetMatchingSchema.optional(),
	expansion_guidelines: ExpansionGuidelinesSchema.optional(),
});

/** Matching profile for song suggestions */
const PlaylistMatchingProfileSchema = z.object({
	similarity_priorities: z.array(z.string()),
	exclusion_criteria: z.array(z.string()).optional(),
	ideal_additions: z.array(z.string()).optional(),
});

/** Complete LLM playlist analysis output */
export const PlaylistAnalysisLlmSchema = z.object({
	meaning: PlaylistMeaningSchema,
	emotional: PlaylistEmotionalSchema,
	context: PlaylistContextSchema,
	curation: CurationSchema,
	matching_profile: PlaylistMatchingProfileSchema,
});
export type PlaylistAnalysisLlm = z.infer<typeof PlaylistAnalysisLlmSchema>;

/** Track info for playlist analysis */
export interface PlaylistTrackInfo {
	name: string;
	artist: string;
}

/** Input for analyzing a playlist */
export interface AnalyzePlaylistInput {
	playlistId: string;
	name: string;
	description?: string;
	tracks: PlaylistTrackInfo[];
}

/** Result of a playlist analysis */
export interface AnalyzePlaylistResult {
	playlistId: string;
	analysis: PlaylistAnalysis;
	tokensUsed?: number;
	cached: boolean;
}

type PlaylistAnalysisServiceError = DbError | LlmError | AnalysisFailedError;

const PLAYLIST_ANALYSIS_PROMPT = `You are an expert music curator. Analyze this playlist to understand its purpose and cohesive elements. Only identify cultural significance when it's explicitly present and central to the playlist's theme.

Playlist Name: {playlist_name}
Description: {playlist_description}
Track Count: {track_count}

Songs in playlist:
{track_list}

Analyze this playlist with focus on:
1. Thematic consistency - what messages and themes tie these songs together
2. Emotional journey - how the playlist flows emotionally
3. Target audience - who would enjoy this playlist
4. Purpose and context - when/where/why someone would listen
5. Only note cultural or political themes if they are explicit and central

IMPORTANT: For all numeric scores, provide a decimal number between 0.0 and 1.0 (e.g., 0.75, 0.3, 0.95). Do NOT use strings or descriptions for numeric fields.

Provide your analysis as a structured JSON response.`;

export class PlaylistAnalysisService {
	constructor(private readonly llm: LlmService) {}

	/**
	 * Analyzes a playlist and stores the result.
	 * Returns cached analysis if available.
	 */
	async analyzePlaylist(
		input: AnalyzePlaylistInput,
	): Promise<Result<AnalyzePlaylistResult, PlaylistAnalysisServiceError>> {
		const { playlistId, name, description, tracks } = input;

		const existingResult = await playlistAnalysis.get(playlistId);
		if (Result.isError(existingResult)) {
			return Result.err(existingResult.error);
		}
		if (existingResult.value) {
			return Result.ok({
				playlistId,
				analysis: existingResult.value,
				cached: true,
			});
		}

		const prompt = this.buildPrompt(name, description, tracks);

		const llmResult = await this.llm.generateObject(
			prompt,
			PlaylistAnalysisLlmSchema,
		);
		if (Result.isError(llmResult)) {
			return Result.err(llmResult.error);
		}

		const output = llmResult.value.output;
		if (
			!output.meaning ||
			!output.emotional ||
			!output.context ||
			!output.matching_profile
		) {
			return Result.err(
				new AnalysisFailedError({
					playlistId,
					reason: "Analysis response is missing required fields",
				}),
			);
		}

		const storeResult = await playlistAnalysis.insert({
			playlist_id: playlistId,
			analysis: output as unknown as InsertPlaylistAnalysis["analysis"],
			model: llmResult.value.model,
			prompt_version: "1",
			tokens_used: llmResult.value.tokens?.total ?? null,
			cost_cents: null,
		});

		if (Result.isError(storeResult)) {
			return Result.err(storeResult.error);
		}

		return Result.ok({
			playlistId,
			analysis: storeResult.value,
			tokensUsed: llmResult.value.tokens?.total,
			cached: false,
		});
	}

	/**
	 * Builds the analysis prompt from input data.
	 */
	private buildPrompt(
		name: string,
		description: string | undefined,
		tracks: PlaylistTrackInfo[],
	): string {
		const trackList =
			tracks.length > 0
				? tracks
						.map((t, i) => `${i + 1}. "${t.name}" by ${t.artist}`)
						.join("\n")
				: "No tracks provided - analyzing based on playlist name and description only";

		const safeDescription = description?.trim() || "No description provided";

		return PLAYLIST_ANALYSIS_PROMPT.replace("{playlist_name}", name)
			.replace("{playlist_description}", safeDescription)
			.replace("{track_count}", tracks.length.toString())
			.replace("{track_list}", trackList);
	}
}
