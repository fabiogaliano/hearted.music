import { Result } from "better-result";
import * as playlistData from "@/lib/domains/library/playlists/queries";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import * as songData from "@/lib/domains/library/songs/queries";
import { emitProgress } from "@/lib/platform/jobs/progress/helpers";
import { runTrackedStageJob } from "../job-runner";
import type { EnrichmentContext, EnrichmentStageResult } from "../types";

export interface PlaylistProfilingOutput {
	readonly result: EnrichmentStageResult;
	readonly playlists: Playlist[];
}

export async function runPlaylistProfilingStage(
	ctx: EnrichmentContext,
): Promise<PlaylistProfilingOutput> {
	console.log("[pipeline] Stage 4: playlist_profiling");

	let playlists: Playlist[];
	try {
		const playlistsResult = await playlistData.getDestinationPlaylists(
			ctx.accountId,
		);
		if (Result.isError(playlistsResult)) {
			throw new Error(
				`Failed to get destination playlists: ${playlistsResult.error.message}`,
			);
		}
		playlists = playlistsResult.value;
	} catch (error) {
		return {
			result: {
				stage: "playlist_profiling",
				status: "failed",
				jobId: null,
				error: error instanceof Error ? error.message : String(error),
			},
			playlists: [],
		};
	}

	if (playlists.length === 0) {
		return {
			result: {
				stage: "playlist_profiling",
				status: "skipped",
				reason: "no destination playlists",
			},
			playlists: [],
		};
	}

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
		result: {
			stage: "playlist_profiling",
			status: "completed",
			jobId,
			succeeded,
			failed,
		},
		playlists,
	};
}
