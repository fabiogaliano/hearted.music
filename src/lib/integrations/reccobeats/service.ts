/**
 * ReccoBeats API service for audio features.
 *
 * ReccoBeats provides free Spotify audio features data (acousticness,
 * danceability, energy, etc.) since Spotify deprecated their API.
 *
 * No authentication required, but rate limited.
 * Uses two-step lookup: Spotify ID → ReccoBeats ID → Audio Features.
 */

import { Result } from "better-result";
import {
	ReccoBeatsApiError,
	type ReccoBeatsError,
	ReccoBeatsRateLimitError,
} from "@/lib/shared/errors/external/reccobeats";
import { ConcurrencyLimiter } from "@/lib/shared/utils/concurrency";
import {
	type ReccoBeatsAudioFeatures,
	type ReccoBeatsAudioFeaturesBatchResult,
	ReccoBeatsAudioFeaturesResponseSchema,
	ReccoBeatsSpotifyLookupResponseSchema,
} from "./types";

// ============================================================================
// Constants
// ============================================================================

const BASE_URL = "https://api.reccobeats.com/v1";

// ============================================================================
// Service
// ============================================================================

export class ReccoBeatsService {
	private readonly limiter = new ConcurrencyLimiter(5, 50);

	/**
	 * Get audio features for a single track.
	 * Delegates to batch method for consistency.
	 */
	async getAudioFeatures(
		spotifyTrackId: string,
	): Promise<Result<ReccoBeatsAudioFeatures | null, ReccoBeatsError>> {
		const batchResult = await this.getAudioFeaturesBatch([spotifyTrackId]);
		if (Result.isError(batchResult)) {
			return Result.err(batchResult.error);
		}
		const features = batchResult.value.features.get(spotifyTrackId) ?? null;
		return Result.ok(features);
	}

	/**
	 * Get audio features for multiple tracks.
	 * Returns partial results - tracks not found are in failedIds.
	 */
	async getAudioFeaturesBatch(
		spotifyTrackIds: string[],
	): Promise<Result<ReccoBeatsAudioFeaturesBatchResult, ReccoBeatsError>> {
		if (spotifyTrackIds.length === 0) {
			return Result.ok({
				features: new Map(),
				failedIds: [],
				stats: { total: 0, succeeded: 0, failed: 0 },
			});
		}

		const features = new Map<string, ReccoBeatsAudioFeatures>();
		const failedIds: string[] = [];

		// Process each track
		const results = await Promise.all(
			spotifyTrackIds.map(async (spotifyId) => {
				const result = await this.fetchAudioFeaturesForTrack(spotifyId);
				return { spotifyId, result };
			}),
		);

		for (const { spotifyId, result } of results) {
			if (Result.isOk(result) && result.value !== null) {
				features.set(spotifyId, result.value);
			} else {
				failedIds.push(spotifyId);
			}
		}

		return Result.ok({
			features,
			failedIds,
			stats: {
				total: spotifyTrackIds.length,
				succeeded: features.size,
				failed: failedIds.length,
			},
		});
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	/**
	 * Fetch audio features for a single track.
	 * Two-step: Spotify ID → ReccoBeats ID → Audio Features.
	 */
	private async fetchAudioFeaturesForTrack(
		spotifyTrackId: string,
	): Promise<Result<ReccoBeatsAudioFeatures | null, ReccoBeatsError>> {
		// Step 1: Get ReccoBeats ID from Spotify ID
		const reccoIdResult = await this.getReccoBeatsId(spotifyTrackId);
		if (Result.isError(reccoIdResult)) {
			return Result.err(reccoIdResult.error);
		}
		if (reccoIdResult.value === null) {
			return Result.ok(null); // Track not found, not an error
		}

		// Step 2: Get audio features using ReccoBeats ID
		return this.fetchAudioFeatures(reccoIdResult.value);
	}

	/**
	 * Resolve Spotify track ID to ReccoBeats internal ID.
	 * Uses the /track?ids= endpoint (not /spotify/track/).
	 */
	private async getReccoBeatsId(
		spotifyTrackId: string,
	): Promise<Result<string | null, ReccoBeatsError>> {
		return this.limiter.run(async () => {
			const url = `${BASE_URL}/track?ids=${spotifyTrackId}`;

			const fetchResult = await Result.tryPromise({
				try: () => fetch(url),
				catch: (e) =>
					new ReccoBeatsApiError(
						0,
						e instanceof Error ? e.message : String(e),
						e,
					),
			});

			if (Result.isError(fetchResult)) {
				return Result.err<string | null, ReccoBeatsError>(fetchResult.error);
			}

			const response = fetchResult.value;

			// Handle rate limiting
			if (response.status === 429) {
				const retryAfter = response.headers.get("Retry-After");
				const retryMs = retryAfter
					? Number.parseInt(retryAfter, 10) * 1000
					: undefined;
				return Result.err<string | null, ReccoBeatsError>(
					new ReccoBeatsRateLimitError(retryMs),
				);
			}

			// Not found is expected for some tracks
			if (response.status === 404) {
				return Result.ok<string | null, ReccoBeatsError>(null);
			}

			if (!response.ok) {
				return Result.err<string | null, ReccoBeatsError>(
					new ReccoBeatsApiError(response.status, response.statusText),
				);
			}

			const jsonResult = await Result.tryPromise({
				try: () => response.json(),
				catch: () => new ReccoBeatsApiError(0, "Failed to parse JSON response"),
			});

			if (Result.isError(jsonResult)) {
				return Result.err<string | null, ReccoBeatsError>(jsonResult.error);
			}

			const parseResult = ReccoBeatsSpotifyLookupResponseSchema.safeParse(
				jsonResult.value,
			);
			if (!parseResult.success) {
				return Result.err<string | null, ReccoBeatsError>(
					new ReccoBeatsApiError(
						0,
						`Invalid API response: ${parseResult.error.message}`,
					),
				);
			}

			// Extract first track's ID from content array
			const firstTrack = parseResult.data.content[0];
			if (!firstTrack) {
				return Result.ok<string | null, ReccoBeatsError>(null);
			}

			return Result.ok<string | null, ReccoBeatsError>(firstTrack.id);
		});
	}

	/**
	 * Fetch audio features using ReccoBeats internal ID.
	 */
	private async fetchAudioFeatures(
		reccoBeatsId: string,
	): Promise<Result<ReccoBeatsAudioFeatures | null, ReccoBeatsError>> {
		return this.limiter.run(async () => {
			const url = `${BASE_URL}/track/${reccoBeatsId}/audio-features`;

			const fetchResult = await Result.tryPromise({
				try: () => fetch(url),
				catch: (e) =>
					new ReccoBeatsApiError(
						0,
						e instanceof Error ? e.message : String(e),
						e,
					),
			});

			if (Result.isError(fetchResult)) {
				return Result.err<ReccoBeatsAudioFeatures | null, ReccoBeatsError>(
					fetchResult.error,
				);
			}

			const response = fetchResult.value;

			if (response.status === 429) {
				const retryAfter = response.headers.get("Retry-After");
				const retryMs = retryAfter
					? Number.parseInt(retryAfter, 10) * 1000
					: undefined;
				return Result.err<ReccoBeatsAudioFeatures | null, ReccoBeatsError>(
					new ReccoBeatsRateLimitError(retryMs),
				);
			}

			if (response.status === 404) {
				return Result.ok<ReccoBeatsAudioFeatures | null, ReccoBeatsError>(null);
			}

			if (!response.ok) {
				return Result.err<ReccoBeatsAudioFeatures | null, ReccoBeatsError>(
					new ReccoBeatsApiError(response.status, response.statusText),
				);
			}

			const jsonResult = await Result.tryPromise({
				try: () => response.json(),
				catch: () => new ReccoBeatsApiError(0, "Failed to parse JSON response"),
			});

			if (Result.isError(jsonResult)) {
				return Result.err<ReccoBeatsAudioFeatures | null, ReccoBeatsError>(
					jsonResult.error,
				);
			}

			const parseResult = ReccoBeatsAudioFeaturesResponseSchema.safeParse(
				jsonResult.value,
			);
			if (!parseResult.success) {
				return Result.err<ReccoBeatsAudioFeatures | null, ReccoBeatsError>(
					new ReccoBeatsApiError(
						0,
						`Invalid API response: ${parseResult.error.message}`,
					),
				);
			}

			return Result.ok<ReccoBeatsAudioFeatures | null, ReccoBeatsError>(
				parseResult.data,
			);
		});
	}
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Factory to create ReccoBeatsService.
 * No configuration needed - ReccoBeats is a free public API.
 */
export function createReccoBeatsService(): ReccoBeatsService {
	return new ReccoBeatsService();
}
