import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Json } from "@/lib/data/database.types";
import * as audioFeatureData from "@/lib/domains/enrichment/audio-features/queries";
import { MATCHING_ALGO_VERSION } from "@/lib/domains/enrichment/embeddings/versioning";
import * as likedSongData from "@/lib/domains/library/liked-songs/queries";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import { computeMatchContextMetadata } from "@/lib/domains/taste/song-matching/cache";
import * as matchingData from "@/lib/domains/taste/song-matching/queries";
import { createMatchingService } from "@/lib/domains/taste/song-matching/service";
import type {
	MatchingAudioFeatures,
	MatchingPlaylistProfile,
	MatchingSong,
} from "@/lib/domains/taste/song-matching/types";
import type { PipelineBatch } from "../batch";
import { rerankMatches } from "../reranking";
import type { EnrichmentContext, ReadyResult } from "../types";

/**
 * Builds a set of "songId:playlistId" keys representing pairs that should be
 * skipped during matching — either because the user already made a decision
 * or because the song is already in the playlist.
 */
export async function loadExclusionSet(
	accountId: string,
): Promise<Set<string>> {
	const supabase = createAdminSupabaseClient();
	const exclusions = new Set<string>();

	// Load all match_decision rows for this account
	const { data: decisions } = await supabase
		.from("match_decision")
		.select("song_id, playlist_id")
		.eq("account_id", accountId);

	if (decisions) {
		for (const d of decisions) {
			exclusions.add(`${d.song_id}:${d.playlist_id}`);
		}
	}

	// Load playlist IDs for this account
	const { data: playlists } = await supabase
		.from("playlist")
		.select("id")
		.eq("account_id", accountId);

	if (playlists && playlists.length > 0) {
		const playlistIds = playlists.map((p) => p.id);

		// Load playlist_song rows for those playlists
		const { data: playlistSongs } = await supabase
			.from("playlist_song")
			.select("song_id, playlist_id")
			.in("playlist_id", playlistIds);

		if (playlistSongs) {
			for (const ps of playlistSongs) {
				exclusions.add(`${ps.song_id}:${ps.playlist_id}`);
			}
		}
	}

	return exclusions;
}

export async function getReadyForMatching(
	accountId: string,
	batchSongIds: string[],
): Promise<ReadyResult> {
	const pendingResult = await likedSongData.getPending(accountId);
	if (Result.isError(pendingResult)) {
		throw new Error(
			`Failed to get pending songs: ${pendingResult.error.message}`,
		);
	}

	const pendingSet = new Set(pendingResult.value.map((ls) => ls.song_id));

	const ready: string[] = [];
	const done: string[] = [];
	for (const id of batchSongIds) {
		if (pendingSet.has(id)) {
			ready.push(id);
		} else {
			done.push(id);
		}
	}

	return { ready, notReady: [], done };
}

export interface MatchingStageResult {
	total: number;
	succeeded: number;
	noMatch: number;
	matchedSongIds: string[];
	noMatchSongIds: string[];
	excludedSongIds: string[];
	skipped: boolean;
}

export async function runMatching(
	ctx: EnrichmentContext,
	batch: PipelineBatch,
	playlists: Playlist[],
	exclusionSet?: Set<string>,
): Promise<MatchingStageResult> {
	const skippedResult: MatchingStageResult = {
		total: 0,
		succeeded: 0,
		noMatch: 0,
		matchedSongIds: [],
		noMatchSongIds: [],
		excludedSongIds: [],
		skipped: true,
	};

	if (playlists.length === 0) {
		return skippedResult;
	}

	let readiness: ReadyResult;
	try {
		readiness = await getReadyForMatching(ctx.accountId, batch.songIds);
	} catch {
		return {
			total: batch.songIds.length,
			succeeded: 0,
			noMatch: batch.songIds.length,
			matchedSongIds: [],
			noMatchSongIds: batch.songIds,
			excludedSongIds: [],
			skipped: false,
		};
	}

	if (readiness.ready.length === 0) {
		return skippedResult;
	}

	const readySet = new Set(readiness.ready);
	const songsForMatching = batch.songs.filter((s) => readySet.has(s.id));
	const songIds = songsForMatching.map((s) => s.id);

	const audioFeaturesResult = await audioFeatureData.getBatch(songIds);
	const audioFeaturesMap = Result.isOk(audioFeaturesResult)
		? audioFeaturesResult.value
		: new Map();

	const matchingSongs: MatchingSong[] = songsForMatching.map((song) => {
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

	const playlistProfiles: MatchingPlaylistProfile[] = [];
	for (const playlist of playlists) {
		const profileResult = await ctx.profilingService.getProfile(playlist.id);
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

	if (playlistProfiles.length === 0 || matchingSongs.length === 0) {
		return skippedResult;
	}

	let contextMeta: Awaited<ReturnType<typeof computeMatchContextMetadata>>;
	try {
		contextMeta = await computeMatchContextMetadata(
			matchingSongs,
			playlistProfiles,
			{},
			exclusionSet,
		);
	} catch {
		return {
			total: matchingSongs.length,
			succeeded: 0,
			noMatch: matchingSongs.length,
			matchedSongIds: [],
			noMatchSongIds: songIds,
			excludedSongIds: [],
			skipped: false,
		};
	}

	const existingContext = await matchingData.getMatchContextByHash(
		contextMeta.contextHash,
		ctx.accountId,
	);
	if (Result.isOk(existingContext) && existingContext.value) {
		return skippedResult;
	}

	const embeddingsResult = await ctx.embeddingService.getEmbeddings(songIds);
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

	const matchingService = createMatchingService(
		ctx.embeddingService,
		ctx.profilingService,
	);

	try {
		const matchResult = await matchingService.matchBatch(
			matchingSongs,
			playlistProfiles,
			songEmbeddings,
			exclusionSet ? { exclusionSet } : undefined,
		);

		if (Result.isOk(matchResult)) {
			// Rerank matches per playlist using cross-encoder
			if (ctx.rerankerService) {
				await rerankMatches(
					matchResult.value.matches,
					matchingSongs,
					playlists,
					ctx.rerankerService,
				);
			}

			const succeeded = matchResult.value.stats.matched;
			const noMatchCount = matchResult.value.stats.noMatch;
			const matchedSongIds = [...matchResult.value.matches.keys()];
			const noMatchSongIds = matchResult.value.noMatch;
			const excludedSongIds = matchResult.value.excluded;

			const contextResult = await matchingData.createMatchContext({
				account_id: ctx.accountId,
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
					const existingContextResult =
						await matchingData.getMatchContextByHash(
							contextMeta.contextHash,
							ctx.accountId,
						);
					if (
						Result.isError(existingContextResult) ||
						!existingContextResult.value
					) {
						return {
							total: matchingSongs.length,
							succeeded: 0,
							noMatch: matchingSongs.length,
							matchedSongIds: [],
							noMatchSongIds: songIds,
							excludedSongIds: [],
							skipped: false,
						};
					}
					contextId = existingContextResult.value.id;
				} else {
					return {
						total: matchingSongs.length,
						succeeded: 0,
						noMatch: matchingSongs.length,
						matchedSongIds: [],
						noMatchSongIds: songIds,
						excludedSongIds: [],
						skipped: false,
					};
				}
			} else {
				contextId = contextResult.value.id;
			}

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

			const insertResult = await matchingData.insertMatchResults(insertData);
			if (
				Result.isError(insertResult) &&
				insertResult.error._tag !== "ConstraintError"
			) {
				return {
					total: matchingSongs.length,
					succeeded,
					noMatch: matchingSongs.length - succeeded,
					matchedSongIds,
					noMatchSongIds,
					excludedSongIds,
					skipped: false,
				};
			}

			return {
				total: matchingSongs.length,
				succeeded,
				noMatch: noMatchCount,
				matchedSongIds,
				noMatchSongIds,
				excludedSongIds,
				skipped: false,
			};
		}

		return {
			total: matchingSongs.length,
			succeeded: 0,
			noMatch: matchingSongs.length,
			matchedSongIds: [],
			noMatchSongIds: songIds,
			excludedSongIds: [],
			skipped: false,
		};
	} catch {
		return {
			total: matchingSongs.length,
			succeeded: 0,
			noMatch: matchingSongs.length,
			matchedSongIds: [],
			noMatchSongIds: songIds,
			excludedSongIds: [],
			skipped: false,
		};
	}
}
