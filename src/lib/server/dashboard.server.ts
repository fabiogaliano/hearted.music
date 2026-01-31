/** Uses parallel fetching to eliminate request waterfalls. */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { Result } from "better-result";
import { requireSession } from "@/lib/auth/session";
import { getLastCompletedSync } from "@/lib/data/jobs";
import {
	getCount as getLikedSongCount,
	getRecentWithDetails,
} from "@/lib/data/liked-song";
import { getAnalyzedCountForAccount } from "@/lib/data/song-analysis";
import type { ActivityItem } from "@/features/dashboard/types";

export interface DashboardStats {
	totalSongs: number;
	analyzedPercent: number;
	lastSyncAt: string | null;
}

export const getDashboardStats = createServerFn({ method: "GET" }).handler(
	async (): Promise<DashboardStats> => {
		const request = getRequest();
		const session = requireSession(request);

		const [totalResult, analyzedResult, lastSyncResult] = await Promise.all([
			getLikedSongCount(session.accountId),
			getAnalyzedCountForAccount(session.accountId),
			getLastCompletedSync(session.accountId),
		]);

		const totalSongs = Result.isOk(totalResult) ? totalResult.value : 0;
		const analyzedCount = Result.isOk(analyzedResult)
			? analyzedResult.value
			: 0;
		const lastSync = Result.isOk(lastSyncResult) ? lastSyncResult.value : null;

		return {
			totalSongs,
			analyzedPercent:
				totalSongs > 0 ? Math.round((analyzedCount / totalSongs) * 100) : 0,
			lastSyncAt: lastSync?.completed_at ?? null,
		};
	},
);

/** Currently returns liked songs only; will merge match/analyze events later. */
export const getRecentActivity = createServerFn({ method: "GET" }).handler(
	async (): Promise<ActivityItem[]> => {
		const request = getRequest();
		const session = requireSession(request);

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
