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
import { getNewItemIds } from "@/lib/domains/library/liked-songs/status-queries";
import { getLatestMatchContext } from "@/lib/domains/taste/song-matching/queries";
import { getUndecidedSongs } from "@/lib/server/matching.functions";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { ActivityItem, MatchPreview } from "@/features/dashboard/types";

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

		return likedActivities.toSorted(
			(a, b) =>
				new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
		);
	},
);

/** First 3 songs the user would see on /match, used for album art previews. */
export const getMatchPreviews = createServerFn({ method: "GET" }).handler(
	async (): Promise<MatchPreview[]> => {
		const { session } = await requireAuthSession();

		const contextResult = await getLatestMatchContext(session.accountId);
		if (Result.isError(contextResult) || !contextResult.value) return [];

		const [undecided, newSongIds] = await Promise.all([
			getUndecidedSongs(contextResult.value.id, session.accountId),
			getNewItemIds(session.accountId, "song"),
		]);

		if (Result.isError(newSongIds) || undecided.length === 0) return [];

		const newSet = new Set(newSongIds.value);
		const sorted = undecided.toSorted((a, b) => {
			const aNew = newSet.has(a.songId) ? 1 : 0;
			const bNew = newSet.has(b.songId) ? 1 : 0;
			if (aNew !== bNew) return bNew - aNew;
			if (b.maxScore !== a.maxScore) return b.maxScore - a.maxScore;
			return a.songId.localeCompare(b.songId);
		});

		const topIds = sorted.slice(0, 3).map((s) => s.songId);

		const supabase = createAdminSupabaseClient();
		const { data, error } = await supabase
			.from("song")
			.select("id, image_url")
			.in("id", topIds);

		if (error || !data) return [];

		const imageMap = new Map(data.map((s) => [s.id, s.image_url]));
		return topIds
			.map((id, i) => {
				const image = imageMap.get(id);
				return image ? { id: i + 1, image } : null;
			})
			.filter((p): p is MatchPreview => p !== null);
	},
);
