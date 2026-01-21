/**
 * Playlist profiling service.
 *
 * Computes playlist profiles from track embeddings, audio features,
 * genre distributions, and emotion distributions.
 */

import { Result } from "better-result";
import type { Json } from "@/lib/data/database.types";
import type { Song } from "@/lib/data/song";
import * as songAnalysisData from "@/lib/data/song-analysis";
import * as audioFeatureData from "@/lib/data/song-audio-feature";
import * as vectorsData from "@/lib/data/vectors";
import type { EmbeddingService } from "@/lib/ml/embedding/service";
import { getModelBundleHash } from "@/lib/ml/embedding/versioning";
import type {
	AudioCentroid,
	ComputedPlaylistProfile,
	EmotionDistribution,
	GenreDistribution,
	ProfileKind,
	ProfilingError,
	ProfilingOptions,
} from "./types";
import {
	calculateCentroid,
	calculateAudioCentroid,
	computeGenreDistribution,
	computeEmotionDistribution,
} from "./calculations";

// ============================================================================
// Constants
// ============================================================================

/** Default profile kind */
const PROFILE_KIND: ProfileKind = "content_v1";

// ============================================================================
// Service
// ============================================================================

export class PlaylistProfilingService {
	constructor(private readonly embeddingService: EmbeddingService) {}

	/**
	 * Get existing profile for a playlist.
	 * Returns null if no profile exists.
	 */
	async getProfile(
		playlistId: string,
	): Promise<Result<ComputedPlaylistProfile | null, ProfilingError>> {
		const result = await vectorsData.getPlaylistProfile(playlistId);
		if (Result.isError(result)) {
			return Result.err<ComputedPlaylistProfile | null, ProfilingError>(
				result.error,
			);
		}
		if (!result.value) {
			return Result.ok<ComputedPlaylistProfile | null, ProfilingError>(null);
		}

		const profile = result.value;
		const computed: ComputedPlaylistProfile = {
			playlistId: profile.playlist_id,
			kind: profile.kind as ProfileKind,
			embedding: this.parseEmbedding(profile.embedding),
			audioCentroid: (profile.audio_centroid as AudioCentroid) ?? {},
			genreDistribution:
				(profile.genre_distribution as GenreDistribution) ?? {},
			emotionDistribution:
				(profile.emotion_distribution as EmotionDistribution) ?? {},
			songIds: profile.song_ids ?? [],
			songCount: profile.song_count ?? 0,
			contentHash: profile.content_hash,
			modelBundleHash: profile.model_bundle_hash,
			fromCache: true,
		};
		return Result.ok<ComputedPlaylistProfile | null, ProfilingError>(computed);
	}

	/**
	 * Compute profile for a playlist from its songs.
	 *
	 * Computes:
	 * - Embedding centroid (mean of track embeddings)
	 * - Audio centroid (mean of 9 audio features)
	 * - Genre distribution from song.genres
	 * - Emotion distribution from song_analysis.emotional_profile
	 */
	async computeProfile(
		playlistId: string,
		songs: Song[],
		options: ProfilingOptions = {},
	): Promise<Result<ComputedPlaylistProfile, ProfilingError>> {
		const songIds = songs.map((s) => s.id);

		// Get model bundle hash for cache invalidation
		const modelBundleHashResult = await getModelBundleHash();
		if (Result.isError(modelBundleHashResult)) {
			return Result.err(modelBundleHashResult.error);
		}
		const modelBundleHash = modelBundleHashResult.value;

		// Compute content hash for caching
		const contentHash = await this.hashContent(songIds);

		// Check cache if not skipped
		if (!options.skipCache) {
			const cached = await this.getProfile(playlistId);
			if (Result.isError(cached)) {
				return Result.err(cached.error);
			}
			if (
				cached.value &&
				cached.value.contentHash === contentHash &&
				cached.value.modelBundleHash === modelBundleHash
			) {
				return Result.ok(cached.value);
			}
		}

		// Get embeddings for all songs
		const embeddingsResult = await this.embeddingService.getEmbeddings(
			songIds,
			"full",
		);
		if (Result.isError(embeddingsResult)) {
			return Result.err(embeddingsResult.error);
		}

		// Calculate embedding centroid
		const vectors = Array.from(embeddingsResult.value.values())
			.map((e) => this.parseEmbedding(e.embedding))
			.filter((v): v is number[] => v !== null);
		const embeddingCentroid = calculateCentroid(vectors);

		// Get audio features
		const audioResult = await audioFeatureData.getBatch(songIds);
		if (Result.isError(audioResult)) {
			return Result.err(audioResult.error);
		}
		const audioCentroid = calculateAudioCentroid(
			Array.from(audioResult.value.values()),
		);

		// Compute genre distribution from song.genres
		const genreDistribution = computeGenreDistribution(songs);

		// Get song analyses for emotion distribution
		const analysesResult = await songAnalysisData.get(songIds);
		if (Result.isError(analysesResult)) {
			return Result.err(analysesResult.error);
		}
		const emotionDistribution = computeEmotionDistribution(
			Array.from(analysesResult.value.values()),
		);

		const profile: ComputedPlaylistProfile = {
			playlistId,
			kind: PROFILE_KIND,
			embedding: embeddingCentroid.length > 0 ? embeddingCentroid : null,
			audioCentroid,
			genreDistribution,
			emotionDistribution,
			songIds,
			songCount: songs.length,
			contentHash,
			modelBundleHash,
			fromCache: false,
		};

		// Persist if not skipped
		if (!options.skipPersist) {
			const upsertResult = await vectorsData.upsertPlaylistProfile({
				playlist_id: playlistId,
				kind: PROFILE_KIND,
				model_bundle_hash: modelBundleHash,
				dims: embeddingCentroid.length || 0,
				content_hash: contentHash,
				embedding: profile.embedding ? JSON.stringify(profile.embedding) : null,
				audio_centroid: profile.audioCentroid as Json,
				genre_distribution: profile.genreDistribution as Json,
				emotion_distribution: profile.emotionDistribution as Json,
				song_count: profile.songCount,
				song_ids: profile.songIds,
			});
			if (Result.isError(upsertResult)) {
				return Result.err(upsertResult.error);
			}
		}

		return Result.ok(profile);
	}

	/**
	 * Invalidate a playlist's profile (delete from cache).
	 * Currently relies on content hash change to invalidate.
	 */
	async invalidateProfile(
		_playlistId: string,
	): Promise<Result<void, ProfilingError>> {
		// Note: vectors.ts needs a delete function for explicit invalidation
		// For now, we rely on content hash change to invalidate
		return Result.ok(undefined);
	}

	// ============================================================================
	// Private Helpers
	// ============================================================================

	/**
	 * Parse embedding from string or array format.
	 */
	private parseEmbedding(embedding: string | number[] | null): number[] | null {
		if (!embedding) return null;
		if (Array.isArray(embedding)) return embedding;
		try {
			return JSON.parse(embedding) as number[];
		} catch {
			return null;
		}
	}

	/**
	 * Hash content for cache key using Web Crypto API (Edge compatible).
	 */
	private async hashContent(songIds: string[]): Promise<string> {
		const content = songIds.sort().join(",");
		const encoder = new TextEncoder();
		const data = encoder.encode(content);
		const hashBuffer = await crypto.subtle.digest("SHA-256", data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("")
			.slice(0, 16);
	}
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Factory to create PlaylistProfilingService.
 */
export function createPlaylistProfilingService(
	embeddingService: EmbeddingService,
): PlaylistProfilingService {
	return new PlaylistProfilingService(embeddingService);
}
