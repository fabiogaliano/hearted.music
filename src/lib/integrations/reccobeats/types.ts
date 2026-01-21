/**
 * ReccoBeats API types.
 *
 * ReccoBeats mirrors Spotify's deprecated audio features API.
 * Provides acousticness, danceability, energy, etc. for tracks.
 *
 * Uses Zod schemas for runtime validation of API responses.
 */

import { z } from "zod";

// ============================================================================
// Zod Schemas for API Response Validation
// ============================================================================

/** Audio features from ReccoBeats API with range validation */
export const ReccoBeatsAudioFeaturesSchema = z.object({
	id: z.string(),
	/** Confidence that track is acoustic (0.0 to 1.0) */
	acousticness: z.number().min(0).max(1),
	/** How suitable for dancing (0.0 to 1.0) */
	danceability: z.number().min(0).max(1),
	/** Perceptual intensity/activity (0.0 to 1.0) */
	energy: z.number().min(0).max(1),
	/** Predicts no vocals (0.0 to 1.0) */
	instrumentalness: z.number().min(0).max(1),
	/** Presence of audience in recording (0.0 to 1.0) */
	liveness: z.number().min(0).max(1),
	/** Overall loudness in dB (typically -60 to 0) */
	loudness: z.number().min(-60).max(0),
	/** Presence of spoken words (0.0 to 1.0) */
	speechiness: z.number().min(0).max(1),
	/** Tempo in BPM */
	tempo: z.number().min(0).max(300),
	/** Musical positiveness (0.0 to 1.0) */
	valence: z.number().min(0).max(1),
});
export type ReccoBeatsAudioFeatures = z.infer<
	typeof ReccoBeatsAudioFeaturesSchema
>;

/** Spotify ID lookup response - returns array of tracks in content field */
export const ReccoBeatsSpotifyLookupResponseSchema = z.object({
	content: z.array(
		z.object({
			id: z.string(),
			trackTitle: z.string().optional(),
			artists: z
				.array(
					z.object({
						id: z.string(),
						name: z.string(),
						href: z.string(),
					}),
				)
				.optional(),
		}),
	),
});

/** API response for audio features lookup (returns features directly, not wrapped) */
export const ReccoBeatsAudioFeaturesResponseSchema =
	ReccoBeatsAudioFeaturesSchema;
export type ReccoBeatsAudioFeaturesResponse = z.infer<
	typeof ReccoBeatsAudioFeaturesResponseSchema
>;

// ============================================================================
// Domain Types (not used for parsing external responses)
// ============================================================================

/** ReccoBeats track metadata */
export interface ReccoBeatsTrack {
	readonly id: string;
	readonly trackTitle: string;
	readonly artists: ReadonlyArray<{
		readonly id: string;
		readonly name: string;
		readonly href: string;
	}>;
	readonly durationMs: number;
	readonly isrc?: string;
	readonly href: string;
	readonly popularity: number;
}

/** API response for track search */
export interface ReccoBeatsSearchResponse {
	readonly tracks: ReadonlyArray<{
		readonly id: string;
		readonly trackTitle: string;
		readonly artists: ReadonlyArray<{
			readonly id: string;
			readonly name: string;
			readonly href: string;
		}>;
	}>;
}

/** Batch result with partial success tracking */
export interface ReccoBeatsAudioFeaturesBatchResult {
	/** Successfully fetched features keyed by Spotify track ID */
	readonly features: Map<string, ReccoBeatsAudioFeatures>;
	/** IDs that failed (not found or error) */
	readonly failedIds: string[];
	/** Statistics */
	readonly stats: {
		readonly total: number;
		readonly succeeded: number;
		readonly failed: number;
	};
}
