import { Result } from "better-result";
import * as likedSongData from "@/lib/domains/library/liked-songs/queries";
import * as matchingData from "@/lib/domains/taste/song-matching/queries";
import * as audioFeatureData from "@/lib/domains/enrichment/audio-features/queries";
import { MATCHING_ALGO_VERSION } from "@/lib/domains/enrichment/embeddings/versioning";
import type { Json } from "@/lib/data/database.types";
import { computeMatchContextMetadata } from "@/lib/domains/taste/song-matching/cache";
import { createMatchingService } from "@/lib/domains/taste/song-matching/service";
import type {
	MatchingSong,
	MatchingPlaylistProfile,
	MatchingAudioFeatures,
} from "@/lib/domains/taste/song-matching/types";
import type { PipelineBatch } from "../batch";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import type { EnrichmentContext, ReadyResult } from "../types";

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

export async function runMatching(
	ctx: EnrichmentContext,
	batch: PipelineBatch,
	playlists: Playlist[],
): Promise<{ total: number; succeeded: number; failed: number }> {
	if (playlists.length === 0) {
		return { total: 0, succeeded: 0, failed: 0 };
	}

	let readiness: ReadyResult;
	try {
		readiness = await getReadyForMatching(ctx.accountId, batch.songIds);
	} catch {
		return {
			total: batch.songIds.length,
			succeeded: 0,
			failed: batch.songIds.length,
		};
	}

	if (readiness.ready.length === 0) {
		return { total: 0, succeeded: 0, failed: 0 };
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
		return { total: 0, succeeded: 0, failed: 0 };
	}

	let identity: Awaited<ReturnType<typeof computeMatchContextMetadata>>;
	try {
		identity = await computeMatchContextMetadata(
			matchingSongs,
			playlistProfiles,
		);
	} catch {
		return {
			total: matchingSongs.length,
			succeeded: 0,
			failed: matchingSongs.length,
		};
	}

	const existingContext = await matchingData.getMatchContextByHash(
		identity.contextHash,
		ctx.accountId,
	);
	if (Result.isOk(existingContext) && existingContext.value) {
		return { total: 0, succeeded: 0, failed: 0 };
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
		);

		if (Result.isOk(matchResult)) {
			const succeeded = matchResult.value.stats.matched;
			const failed = matchResult.value.stats.failed;

			const contextResult = await matchingData.createMatchContext({
				account_id: ctx.accountId,
				algorithm_version: MATCHING_ALGO_VERSION,
				config_hash: identity.configHash,
				playlist_set_hash: identity.playlistSetHash,
				candidate_set_hash: identity.candidateSetHash,
				context_hash: identity.contextHash,
				playlist_count: playlistProfiles.length,
				song_count: matchingSongs.length,
			});

			let contextId: string;
			if (Result.isError(contextResult)) {
				if (contextResult.error._tag === "ConstraintError") {
					const existingContextResult =
						await matchingData.getMatchContextByHash(
							identity.contextHash,
							ctx.accountId,
						);
					if (
						Result.isError(existingContextResult) ||
						!existingContextResult.value
					) {
						return {
							total: matchingSongs.length,
							succeeded: 0,
							failed: matchingSongs.length,
						};
					}
					contextId = existingContextResult.value.id;
				} else {
					return {
						total: matchingSongs.length,
						succeeded: 0,
						failed: matchingSongs.length,
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
					failed: matchingSongs.length - succeeded,
				};
			}

			return { total: matchingSongs.length, succeeded, failed };
		}

		return {
			total: matchingSongs.length,
			succeeded: 0,
			failed: matchingSongs.length,
		};
	} catch {
		return {
			total: matchingSongs.length,
			succeeded: 0,
			failed: matchingSongs.length,
		};
	}
}
