/**
 * Playlist profiling service.
 *
 * Computes playlist profiles from track embeddings, audio features,
 * and genre distributions.
 */

import { Result } from "better-result";
import type { Json } from "@/lib/data/database.types";
import { hashPlaylistProfile } from "@/lib/domains/enrichment/embeddings/hashing";
import type { Song } from "@/lib/domains/library/songs/queries";
import * as audioFeatureData from "@/lib/domains/enrichment/audio-features/queries";
import * as vectorsData from "@/lib/domains/enrichment/embeddings/queries";
import type { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { getModelBundleHash } from "@/lib/domains/enrichment/embeddings/versioning";
import {
	blendEmbeddings,
	calculateAudioCentroid,
	calculateCentroid,
	computeGenreDistribution,
	computeIntentWeight,
} from "./calculations";
import type {
	AudioCentroid,
	ComputedPlaylistProfile,
	GenreDistribution,
	ProfileKind,
	ProfilingError,
	ProfilingOptions,
} from "./types";

/** Default profile kind */
const PROFILE_KIND: ProfileKind = "content_v1";

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
	 */
	async computeProfile(
		playlistId: string,
		songs: Song[],
		options: ProfilingOptions = {},
	): Promise<Result<ComputedPlaylistProfile, ProfilingError>> {
		const songIds = songs.map((s) => s.id);
		const intentText =
			[options.name, options.description].filter(Boolean).join(" — ").trim() ||
			undefined;
		const hasDescription = !!options.description;

		// Get model bundle hash for cache invalidation
		const modelBundleHashResult = await getModelBundleHash();
		if (Result.isError(modelBundleHashResult)) {
			return Result.err(modelBundleHashResult.error);
		}
		const modelBundleHash = modelBundleHashResult.value;

		// Get embeddings for all songs
		const embeddingsResult = await this.embeddingService.getEmbeddings(songIds);
		if (Result.isError(embeddingsResult)) {
			return Result.err(embeddingsResult.error);
		}

		// Calculate embedding centroid from song embeddings (authoritative when available)
		const vectors = Array.from(embeddingsResult.value.values())
			.map((e) => this.parseEmbedding(e.embedding))
			.filter((v): v is number[] => v !== null);
		const songCentroid = calculateCentroid(vectors);

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

		// Compute content hash — always include intent text so name changes invalidate
		const contentHash = await hashPlaylistProfile({
			playlistId,
			songIds: [...songIds],
			descriptionText: intentText,
			embeddingCentroid: songCentroid.length > 0 ? songCentroid : undefined,
			audioCentroid,
			genreDistribution,
		});
		const expectsIntentBlend = !!intentText;

		// Check cache if not skipped
		if (!options.skipCache) {
			const cached = await this.getProfile(playlistId);
			if (Result.isError(cached)) {
				return Result.err(cached.error);
			}
			if (
				cached.value &&
				cached.value.contentHash === contentHash &&
				cached.value.modelBundleHash === modelBundleHash &&
				(!expectsIntentBlend || cached.value.embedding !== null)
			) {
				return Result.ok(cached.value);
			}
		}

		// Embed intent text (name + description) for blending into profile
		let intentEmbedding: number[] | null = null;
		if (intentText) {
			const intentResult = await this.embeddingService.embedText(intentText, {
				prefix: "passage:",
			});
			if (Result.isOk(intentResult)) {
				intentEmbedding = intentResult.value;
			}
		}

		const intentWeight = computeIntentWeight(songs.length, hasDescription);
		const embeddingCentroid = blendEmbeddings(
			songCentroid,
			intentEmbedding,
			intentWeight,
		);

		const profile: ComputedPlaylistProfile = {
			playlistId,
			kind: PROFILE_KIND,
			embedding: embeddingCentroid.length > 0 ? embeddingCentroid : null,
			audioCentroid,
			genreDistribution,
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
				emotion_distribution: {} as Json,
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
		return Result.ok(undefined);
	}

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
}

/**
 * Factory to create PlaylistProfilingService.
 */
export function createPlaylistProfilingService(
	embeddingService: EmbeddingService,
): PlaylistProfilingService {
	return new PlaylistProfilingService(embeddingService);
}
