/**
 * Re-match operation: runs matching on all data-enriched songs
 * without going through the full enrichment pipeline (stages A-D).
 *
 * Triggered when playlist profiles change (detected via playlistSetHash).
 */

import { Result } from "better-result";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { createPlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";
import { markItemsNew } from "@/lib/domains/library/liked-songs/status-queries";
import * as songData from "@/lib/domains/library/songs/queries";
import * as audioFeatureData from "@/lib/domains/enrichment/audio-features/queries";
import * as matchingData from "@/lib/domains/taste/song-matching/queries";
import { MATCHING_ALGO_VERSION } from "@/lib/domains/enrichment/embeddings/versioning";
import type { Json } from "@/lib/data/database.types";
import { computeMatchContextMetadata } from "@/lib/domains/taste/song-matching/cache";
import { createMatchingService } from "@/lib/domains/taste/song-matching/service";
import type {
	MatchingSong,
	MatchingPlaylistProfile,
	MatchingAudioFeatures,
} from "@/lib/domains/taste/song-matching/types";
import { loadExclusionSet } from "./stages/matching";
import { runPlaylistProfiling } from "./stages/playlist-profiling";
import { getDataEnrichedSongIds } from "./batch";

type RematchError = { message: string };

/**
 * Runs matching on all data-enriched songs for an account.
 * Does NOT run stages A-D — only playlist profiling + matching.
 * Updates item_status.is_new for songs that receive new suggestions.
 */
export async function requestRematch(
	accountId: string,
): Promise<Result<{ matched: number; total: number }, RematchError>> {
	let embeddingService: EmbeddingService;
	try {
		embeddingService = new EmbeddingService();
	} catch {
		return Result.err({ message: "Failed to initialize EmbeddingService" });
	}

	const profilingService = createPlaylistProfilingService(embeddingService);

	// Get all data-enriched songs
	const songIds = await getDataEnrichedSongIds(accountId);
	if (songIds.length === 0) {
		return Result.ok({ matched: 0, total: 0 });
	}

	// Load songs
	const songsResult = await songData.getByIds(songIds);
	if (Result.isError(songsResult)) {
		return Result.err({ message: "Failed to load songs" });
	}

	// Run playlist profiling
	const ctx = { accountId, embeddingService, profilingService };
	let playlists: Awaited<ReturnType<typeof runPlaylistProfiling>>["playlists"];
	try {
		const profilingResult = await runPlaylistProfiling(ctx);
		playlists = profilingResult.playlists;
	} catch {
		return Result.err({ message: "Failed to profile playlists" });
	}

	if (playlists.length === 0) {
		// Create an empty match_context to supersede any stale suggestions
		// from when the user previously had playlists
		await matchingData.createMatchContext({
			account_id: accountId,
			algorithm_version: MATCHING_ALGO_VERSION,
			config_hash: "empty",
			playlist_set_hash: "empty",
			candidate_set_hash: "empty",
			context_hash: `empty_${accountId}_${Date.now()}`,
			playlist_count: 0,
			song_count: songIds.length,
		});
		return Result.ok({ matched: 0, total: songIds.length });
	}

	// Build playlist profiles
	const playlistProfiles: MatchingPlaylistProfile[] = [];
	for (const playlist of playlists) {
		const profileResult = await profilingService.getProfile(playlist.id);
		if (Result.isOk(profileResult) && profileResult.value) {
			const p = profileResult.value;
			playlistProfiles.push({
				playlistId: p.playlistId,
				embedding: p.embedding,
				audioCentroid: p.audioCentroid as Record<string, number>,
				genreDistribution: p.genreDistribution as Record<string, number>,
			});
		}
	}

	if (playlistProfiles.length === 0) {
		return Result.ok({ matched: 0, total: songIds.length });
	}

	// Build matching songs with audio features
	const audioFeaturesResult = await audioFeatureData.getBatch(songIds);
	const audioFeaturesMap = Result.isOk(audioFeaturesResult)
		? audioFeaturesResult.value
		: new Map();

	const matchingSongs: MatchingSong[] = songsResult.value.map((song) => {
		const af = audioFeaturesMap.get(song.id);
		const audioFeatures: MatchingAudioFeatures | null = af
			? {
					energy: af.energy ?? 0,
					valence: af.valence ?? 0,
					danceability: af.danceability ?? 0,
					acousticness: af.acousticness ?? 0,
					instrumentalness: af.instrumentalness ?? 0,
					speechiness: af.speechiness ?? 0,
					liveness: af.liveness ?? 0,
					tempo: af.tempo ?? 0,
					loudness: af.loudness ?? 0,
				}
			: null;

		return {
			id: song.id,
			spotifyId: song.spotify_id,
			name: song.name,
			artists: song.artists,
			genres: song.genres,
			audioFeatures,
		};
	});

	// Compute context metadata
	let contextMeta: Awaited<ReturnType<typeof computeMatchContextMetadata>>;
	try {
		contextMeta = await computeMatchContextMetadata(
			matchingSongs,
			playlistProfiles,
		);
	} catch {
		return Result.err({ message: "Failed to compute context metadata" });
	}

	// Check for existing context (dedup)
	const existingContext = await matchingData.getMatchContextByHash(
		contextMeta.contextHash,
		accountId,
	);
	if (Result.isOk(existingContext) && existingContext.value) {
		return Result.ok({ matched: 0, total: songIds.length });
	}

	// Load exclusion set
	const exclusionSet = await loadExclusionSet(accountId);

	// Get embeddings
	const embeddingsResult = await embeddingService.getEmbeddings(songIds);
	const songEmbeddings = new Map<string, number[]>();
	if (Result.isOk(embeddingsResult)) {
		for (const [id, emb] of embeddingsResult.value) {
			const parsed =
				typeof emb.embedding === "string"
					? (JSON.parse(emb.embedding) as number[])
					: emb.embedding;
			if (Array.isArray(parsed)) {
				songEmbeddings.set(id, parsed);
			}
		}
	}

	// Run matching
	const matchingService = createMatchingService(
		embeddingService,
		profilingService,
	);
	const matchResult = await matchingService.matchBatch(
		matchingSongs,
		playlistProfiles,
		songEmbeddings,
		{ exclusionSet },
	);

	if (Result.isError(matchResult)) {
		return Result.err({ message: "Matching failed" });
	}

	const matchedSongIds = [...matchResult.value.matches.keys()];

	// Create match context
	const contextResult = await matchingData.createMatchContext({
		account_id: accountId,
		algorithm_version: MATCHING_ALGO_VERSION,
		config_hash: contextMeta.configHash,
		playlist_set_hash: contextMeta.playlistSetHash,
		candidate_set_hash: contextMeta.candidateSetHash,
		context_hash: contextMeta.contextHash,
		playlist_count: playlistProfiles.length,
		song_count: matchingSongs.length,
	});

	let contextId: string;
	if (Result.isError(contextResult)) {
		if (contextResult.error._tag === "ConstraintError") {
			const existing = await matchingData.getMatchContextByHash(
				contextMeta.contextHash,
				accountId,
			);
			if (Result.isError(existing) || !existing.value) {
				return Result.err({ message: "Failed to create match context" });
			}
			contextId = existing.value.id;
		} else {
			return Result.err({ message: "Failed to create match context" });
		}
	} else {
		contextId = contextResult.value.id;
	}

	// Insert match results
	const insertData: matchingData.InsertMatchResult[] = [];
	for (const [songId, results] of matchResult.value.matches) {
		for (const r of results) {
			insertData.push({
				context_id: contextId,
				song_id: songId,
				playlist_id: r.playlistId,
				score: r.score,
				rank: r.rank,
				factors: r.factors as unknown as Json,
			});
		}
	}

	if (insertData.length > 0) {
		const insertResult = await matchingData.insertMatchResults(insertData);
		if (Result.isOk(insertResult) && matchedSongIds.length > 0) {
			await markItemsNew(accountId, "song", matchedSongIds);
		}
	}

	return Result.ok({
		matched: matchedSongIds.length,
		total: songIds.length,
	});
}
