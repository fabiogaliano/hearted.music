/**
 * Audio features service.
 *
 * Orchestrates fetching and persisting audio features.
 * Uses ReccoBeats as the primary source (Spotify deprecated their API).
 */

import { Result } from "better-result";
import * as audioFeatureData from "@/lib/data/song-audio-feature";
import type { DbError } from "@/lib/shared/errors/database";
import type { ReccoBeatsError } from "@/lib/shared/errors/external/reccobeats";
import type { ReccoBeatsService } from "@/lib/integrations/reccobeats/service";
import type { ReccoBeatsAudioFeatures } from "@/lib/integrations/reccobeats/types";

// ============================================================================
// Types
// ============================================================================

/** Track info for backfill operations */
export interface TrackInfo {
	/** Internal database song ID (UUID) */
	readonly songId: string;
	/** Spotify track ID for API lookup */
	readonly spotifyTrackId: string;
}

/** Result of backfill operation */
export interface BackfillResult {
	/** Successfully fetched and persisted features */
	readonly filled: Map<string, audioFeatureData.AudioFeature>;
	/** Already had features (skipped) */
	readonly skipped: string[];
	/** Failed to fetch from API */
	readonly failed: string[];
	/** Statistics */
	readonly stats: {
		readonly total: number;
		readonly filled: number;
		readonly skipped: number;
		readonly failed: number;
	};
}

/** Union of possible errors */
export type AudioFeaturesError = DbError | ReccoBeatsError;

// ============================================================================
// Service
// ============================================================================

export class AudioFeaturesService {
	constructor(private readonly reccoBeatsService: ReccoBeatsService | null) {}

	/**
	 * Get audio features for songs, fetching from ReccoBeats if missing.
	 * Returns all features (existing + newly fetched).
	 */
	async getOrFetchFeatures(
		tracks: TrackInfo[],
	): Promise<
		Result<Map<string, audioFeatureData.AudioFeature>, AudioFeaturesError>
	> {
		if (tracks.length === 0) {
			return Result.ok(new Map());
		}

		const songIds = tracks.map((t) => t.songId);

		// Get existing features from database
		const existingResult = await audioFeatureData.getBatch(songIds);
		if (Result.isError(existingResult)) {
			return Result.err(existingResult.error);
		}

		const existingFeatures = existingResult.value;

		// Find tracks missing features
		const missingTracks = tracks.filter((t) => !existingFeatures.has(t.songId));

		// If all have features or no ReccoBeats service, return existing
		if (missingTracks.length === 0 || !this.reccoBeatsService) {
			return Result.ok(existingFeatures);
		}

		// Fetch missing from ReccoBeats
		const spotifyIds = missingTracks.map((t) => t.spotifyTrackId);
		const fetchResult =
			await this.reccoBeatsService.getAudioFeaturesBatch(spotifyIds);
		if (Result.isError(fetchResult)) {
			// Return existing on error (graceful degradation)
			return Result.ok(existingFeatures);
		}

		// Map Spotify IDs back to song IDs and persist
		const newFeatures: audioFeatureData.UpsertData[] = [];
		const spotifyToSongId = new Map(
			missingTracks.map((t) => [t.spotifyTrackId, t.songId]),
		);

		for (const [spotifyId, reccoFeatures] of fetchResult.value.features) {
			const songId = spotifyToSongId.get(spotifyId);
			if (songId) {
				newFeatures.push(this.mapReccoBeatsToUpsert(songId, reccoFeatures));
			}
		}

		// Persist new features
		if (newFeatures.length > 0) {
			const upsertResult = await audioFeatureData.upsert(newFeatures);
			if (Result.isOk(upsertResult)) {
				for (const feature of upsertResult.value) {
					existingFeatures.set(feature.song_id, feature);
				}
			}
			// On upsert error, continue with what we have
		}

		return Result.ok(existingFeatures);
	}

	/**
	 * Backfill missing audio features for tracks.
	 * Skips tracks that already have features.
	 */
	async backfillMissingFeatures(
		tracks: TrackInfo[],
	): Promise<Result<BackfillResult, AudioFeaturesError>> {
		if (tracks.length === 0) {
			return Result.ok({
				filled: new Map(),
				skipped: [],
				failed: [],
				stats: { total: 0, filled: 0, skipped: 0, failed: 0 },
			});
		}

		const songIds = tracks.map((t) => t.songId);

		// Check which already have features
		const existingResult = await audioFeatureData.getBatch(songIds);
		if (Result.isError(existingResult)) {
			return Result.err(existingResult.error);
		}

		const skipped = tracks
			.filter((t) => existingResult.value.has(t.songId))
			.map((t) => t.songId);
		const missingTracks = tracks.filter(
			(t) => !existingResult.value.has(t.songId),
		);

		// No missing or no service
		if (missingTracks.length === 0 || !this.reccoBeatsService) {
			return Result.ok({
				filled: new Map(),
				skipped,
				failed: missingTracks.map((t) => t.songId),
				stats: {
					total: tracks.length,
					filled: 0,
					skipped: skipped.length,
					failed: missingTracks.length,
				},
			});
		}

		// Fetch from ReccoBeats
		const spotifyIds = missingTracks.map((t) => t.spotifyTrackId);
		const fetchResult =
			await this.reccoBeatsService.getAudioFeaturesBatch(spotifyIds);
		if (Result.isError(fetchResult)) {
			return Result.err(fetchResult.error);
		}

		// Map and persist
		const newFeatures: audioFeatureData.UpsertData[] = [];
		const filled = new Map<string, audioFeatureData.AudioFeature>();
		const failed: string[] = [];

		for (const track of missingTracks) {
			const reccoFeatures = fetchResult.value.features.get(
				track.spotifyTrackId,
			);
			if (reccoFeatures) {
				newFeatures.push(
					this.mapReccoBeatsToUpsert(track.songId, reccoFeatures),
				);
			} else {
				failed.push(track.songId);
			}
		}

		// Persist
		if (newFeatures.length > 0) {
			const upsertResult = await audioFeatureData.upsert(newFeatures);
			if (Result.isOk(upsertResult)) {
				for (const feature of upsertResult.value) {
					filled.set(feature.song_id, feature);
				}
			}
		}

		return Result.ok({
			filled,
			skipped,
			failed,
			stats: {
				total: tracks.length,
				filled: filled.size,
				skipped: skipped.length,
				failed: failed.length,
			},
		});
	}

	// ============================================================================
	// Private Helpers
	// ============================================================================

	/**
	 * Map ReccoBeats features to database upsert format.
	 */
	private mapReccoBeatsToUpsert(
		songId: string,
		features: ReccoBeatsAudioFeatures,
	): audioFeatureData.UpsertData {
		return {
			song_id: songId,
			acousticness: features.acousticness,
			danceability: features.danceability,
			energy: features.energy,
			instrumentalness: features.instrumentalness,
			liveness: features.liveness,
			loudness: features.loudness,
			speechiness: features.speechiness,
			tempo: features.tempo,
			valence: features.valence,
			// ReccoBeats doesn't provide key, mode, time_signature
			key: null,
			mode: null,
			time_signature: null,
		};
	}
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Factory to create AudioFeaturesService.
 * Takes optional ReccoBeatsService for graceful degradation.
 */
export function createAudioFeaturesService(
	reccoBeatsService: ReccoBeatsService | null,
): AudioFeaturesService {
	return new AudioFeaturesService(reccoBeatsService);
}
