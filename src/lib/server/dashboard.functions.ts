/** Uses parallel fetching to eliminate request waterfalls. */

import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { requireAuthSession } from "@/lib/platform/auth/auth.server";
import { getLastCompletedSync } from "@/lib/data/jobs";
import {
	getCount as getLikedSongCount,
	getRecentWithDetails,
	getStats as getLikedSongStats,
} from "@/lib/domains/library/liked-songs/queries";
import { getAnalyzedCountForAccount } from "@/lib/domains/enrichment/content-analysis/queries";
import type { ActivityItem } from "@/features/dashboard/types";

export interface DashboardStats {
	totalSongs: number;
	analyzedPercent: number;
	lastSyncAt: string | null;
	newSuggestions: number;
}

export const getDashboardStats = createServerFn({ method: "GET" }).handler(
	async (): Promise<DashboardStats> => {
		const { session } = await requireAuthSession();

		const [totalResult, analyzedResult, lastSyncResult, statsResult] =
			await Promise.all([
				getLikedSongCount(session.accountId),
				getAnalyzedCountForAccount(session.accountId),
				getLastCompletedSync(session.accountId),
				getLikedSongStats(session.accountId),
			]);

		const totalSongs = Result.isOk(totalResult) ? totalResult.value : 0;
		const analyzedCount = Result.isOk(analyzedResult)
			? analyzedResult.value
			: 0;
		const lastSync = Result.isOk(lastSyncResult) ? lastSyncResult.value : null;
		const newSuggestions = Result.isOk(statsResult)
			? Number(statsResult.value.new_suggestions)
			: 0;

		return {
			totalSongs,
			analyzedPercent:
				totalSongs > 0 ? Math.round((analyzedCount / totalSongs) * 100) : 0,
			lastSyncAt: lastSync?.completed_at ?? null,
			newSuggestions,
		};
	},
);

/** Currently returns liked songs only; will merge match/analyze events later. */
export const getRecentActivity = createServerFn({ method: "GET" }).handler(
	async (): Promise<ActivityItem[]> => {
		const { session } = await requireAuthSession();

		const [likedResult] = await Promise.allSettled([
			getRecentWithDetails(session.accountId, 5),
		]);

		const likedActivities: ActivityItem[] =
			likedResult.status === "fulfilled" && Result.isOk(likedResult.value)
				? likedResult.value.value.map((liked) => ({
						type: "liked" as const,
						id: liked.id,
						timestamp: liked.liked_at,
						songId: liked.song.id,
						songName: liked.song.name,
						artistName: liked.song.artists[0] ?? "Unknown Artist",
						imageUrl: liked.song.image_url,
					}))
				: [];

		return likedActivities.sort(
			(a, b) =>
				new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
		);
	},
);
