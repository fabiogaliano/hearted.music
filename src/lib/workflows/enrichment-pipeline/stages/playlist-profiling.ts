import { Result } from "better-result";
import * as playlistData from "@/lib/data/playlists";
import * as songData from "@/lib/data/song";
import { emitProgress } from "@/lib/jobs/progress/helpers";
import { runTrackedStageJob } from "../job-runner";
import type { EnrichmentContext, EnrichmentStageResult } from "../types";

export async function runPlaylistProfilingStage(
	ctx: EnrichmentContext,
): Promise<EnrichmentStageResult> {
	console.log("[pipeline] Stage 4: playlist_profiling");

	const playlistsResult = await playlistData.getDestinationPlaylists(
		ctx.accountId,
	);
	if (Result.isError(playlistsResult)) {
		throw new Error(
			`Failed to get destination playlists: ${playlistsResult.error.message}`,
		);
	}

	const playlists = playlistsResult.value;
	if (playlists.length === 0) {
		return { stage: "playlist_profiling", status: "skipped" };
	}

	// Store for Stage 5 to reuse without a second DB call
	ctx.destinationPlaylists = playlists;

	const { jobId, succeeded, failed } = await runTrackedStageJob({
		accountId: ctx.accountId,
		stage: "playlist_profiling",
		work: async (jobId) => {
			let succeeded = 0;
			let failed = 0;

			for (let i = 0; i < playlists.length; i++) {
				const playlist = playlists[i];

				const playlistSongsResult = await playlistData.getPlaylistSongs(
					playlist.id,
				);
				if (Result.isError(playlistSongsResult)) {
					failed++;
					emitProgress(jobId, {
						total: playlists.length,
						done: i + 1,
						succeeded,
						failed,
					});
					continue;
				}

				const songIds = playlistSongsResult.value.map((ps) => ps.song_id);
				const songsResult = await songData.getByIds(songIds);
				if (Result.isError(songsResult)) {
					failed++;
					emitProgress(jobId, {
						total: playlists.length,
						done: i + 1,
						succeeded,
						failed,
					});
					continue;
				}

				const profileResult = await ctx.profilingService.computeProfile(
					playlist.id,
					songsResult.value,
				);
				if (Result.isOk(profileResult)) {
					succeeded++;
				} else {
					failed++;
				}

				emitProgress(jobId, {
					total: playlists.length,
					done: i + 1,
					succeeded,
					failed,
				});
			}

			return { total: playlists.length, succeeded, failed, result: undefined };
		},
	});

	return {
		stage: "playlist_profiling",
		status: "completed",
		jobId,
		succeeded,
		failed,
	};
}
