import { createHash } from "node:crypto";
import { Result } from "better-result";
import * as likedSongData from "@/lib/data/liked-song";
import * as matchingData from "@/lib/data/matching";
import * as audioFeatureData from "@/lib/data/song-audio-feature";
import type { Json } from "@/lib/data/database.types";
import { createMatchingService } from "@/lib/capabilities/matching/service";
import type {
	MatchingSong,
	MatchingPlaylistProfile,
	MatchingAudioFeatures,
} from "@/lib/capabilities/matching/types";
import { runTrackedStageJob } from "../job-runner";
import type { EnrichmentContext, EnrichmentStageResult } from "../types";

function sha256Hex(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

export async function runMatchingStage(
	ctx: EnrichmentContext,
): Promise<EnrichmentStageResult> {
	console.log("[pipeline] Stage 5: matching");

	const pendingResult = await likedSongData.getPending(ctx.accountId);
	if (Result.isError(pendingResult)) {
		throw new Error(
			`Failed to get pending songs: ${pendingResult.error.message}`,
		);
	}

	const batchSet = new Set(ctx.selectedBatchSongIds);
	const pendingSongs = pendingResult.value.filter((ls) =>
		batchSet.has(ls.song_id),
	);

	if (pendingSongs.length === 0) {
		return { stage: "matching", status: "skipped" };
	}

	const playlists = ctx.destinationPlaylists;
	if (playlists.length === 0) {
		return { stage: "matching", status: "skipped" };
	}

	const pendingSongIds = new Set(pendingSongs.map((ps) => ps.song_id));
	const songsForMatching = ctx.selectedBatchSongs.filter((s) =>
		pendingSongIds.has(s.id),
	);
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
		return { stage: "matching", status: "skipped" };
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

	const { jobId, succeeded, failed } = await runTrackedStageJob({
		accountId: ctx.accountId,
		stage: "matching",
		work: async (jobId) => {
			const matchResult = await matchingService.matchBatch(
				matchingSongs,
				playlistProfiles,
				songEmbeddings,
				{ jobId },
			);

			if (Result.isOk(matchResult)) {
				const succeeded = matchResult.value.stats.matched;
				const failed = matchResult.value.stats.failed;

				const playlistSetHash = sha256Hex(
					playlists
						.map((p) => p.id)
						.sort()
						.join(","),
				);
				const candidateSetHash = sha256Hex([...songIds].sort().join(","));
				const contextHash = sha256Hex(
					`pipeline-${ctx.accountId}-${Date.now()}`,
				);

				const contextResult = await matchingData.createMatchContext({
					account_id: ctx.accountId,
					algorithm_version: "pipeline_v1",
					config_hash: contextHash,
					playlist_set_hash: playlistSetHash,
					candidate_set_hash: candidateSetHash,
					context_hash: contextHash,
					playlist_count: playlistProfiles.length,
					song_count: matchingSongs.length,
				});

				if (Result.isOk(contextResult)) {
					const contextId = contextResult.value.id;
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

					await matchingData.insertMatchResults(insertData);
				}

				return {
					total: matchingSongs.length,
					succeeded,
					failed,
					result: undefined,
				};
			}

			return {
				total: matchingSongs.length,
				succeeded: 0,
				failed: matchingSongs.length,
				result: undefined,
			};
		},
	});

	return { stage: "matching", status: "completed", jobId, succeeded, failed };
}
