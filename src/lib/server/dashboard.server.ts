/**
 * Server functions for dashboard data loading.
 *
 * Aggregates stats from multiple data sources for the dashboard home view.
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { Result } from "better-result";
import { requireSession } from "@/lib/auth/session";
import {
	getCount as getLikedSongCount,
	getPending,
} from "@/lib/data/liked-song";
import {
	getPlaylistCount,
	getDestinationPlaylists,
} from "@/lib/data/playlists";
import { getAnalyzedCount } from "@/lib/data/song-analysis";
import { getOrCreatePreferences } from "@/lib/data/preferences";
import { getAccountById } from "@/lib/data/accounts";
import type {
	DashboardLoaderData,
	RecentActivityItem,
} from "@/features/dashboard/types";
import { DashboardError } from "@/lib/shared/errors/domain/dashboard";

/**
 * Gets recent activity items (matched songs) for an account.
 * Currently returns empty array - will be populated when matching flow is implemented.
 * The activity feed shows an empty state which is acceptable per design.
 */
async function getRecentActivity(
	_accountId: string,
): Promise<Result<RecentActivityItem[], Error>> {
	return Result.ok([]);
}

/**
 * Gets all dashboard data for the authenticated user.
 * Loads stats, playlists, and recent activity in parallel.
 */
export const getDashboardData = createServerFn({ method: "GET" }).handler(
	async (): Promise<DashboardLoaderData> => {
		const request = getRequest();
		const session = requireSession(request);

		const [
			prefsResult,
			totalSongsResult,
			pendingSongsResult,
			playlistCountResult,
			destinationPlaylistsResult,
			analyzedCountResult,
			activityResult,
			accountResult,
		] = await Promise.all([
			getOrCreatePreferences(session.accountId),
			getLikedSongCount(session.accountId),
			getPending(session.accountId),
			getPlaylistCount(session.accountId),
			getDestinationPlaylists(session.accountId),
			getAnalyzedCount(session.accountId),
			getRecentActivity(session.accountId),
			getAccountById(session.accountId),
		]);

		if (Result.isError(prefsResult)) {
			throw new DashboardError("load_preferences", prefsResult.error);
		}
		if (Result.isError(totalSongsResult)) {
			throw new DashboardError("load_total_songs", totalSongsResult.error);
		}
		if (Result.isError(pendingSongsResult)) {
			throw new DashboardError("load_pending_songs", pendingSongsResult.error);
		}
		if (Result.isError(playlistCountResult)) {
			throw new DashboardError(
				"load_playlist_count",
				playlistCountResult.error,
			);
		}
		if (Result.isError(destinationPlaylistsResult)) {
			throw new DashboardError(
				"load_destination_playlists",
				destinationPlaylistsResult.error,
			);
		}
		if (Result.isError(analyzedCountResult)) {
			throw new DashboardError(
				"load_analyzed_count",
				analyzedCountResult.error,
			);
		}
		if (Result.isError(activityResult)) {
			throw new DashboardError("load_activity", activityResult.error);
		}
		if (Result.isError(accountResult)) {
			throw new DashboardError("load_account", accountResult.error);
		}

		const totalSongs = totalSongsResult.value;
		const analyzedCount = analyzedCountResult.value;
		const analyzedPercent =
			totalSongs > 0 ? Math.round((analyzedCount / totalSongs) * 100) : 0;
		const matchedCount = activityResult.value.length;

		const playlists = destinationPlaylistsResult.value.map((p) => ({
			id: p.id,
			name: p.name,
			songCount: p.song_count,
			imageUrl: p.image_url,
		}));

		const userName = accountResult.value?.display_name ?? "there";

		return {
			theme: prefsResult.value.theme,
			stats: {
				totalSongs,
				analyzedPercent,
				matchedCount,
				playlistCount: playlistCountResult.value,
				newSongsCount: pendingSongsResult.value.length,
			},
			playlists,
			recentActivity: activityResult.value,
			userName,
		};
	},
);
