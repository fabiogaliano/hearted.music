/**
 * Dashboard server functions.
 *
 * getDashboardPageData is the primary entry point — a single authenticated
 * server function that fetches all dashboard data in parallel. This avoids
 * 3 separate HTTP requests (each with their own auth check) when the
 * dashboard route loads.
 *
 * Individual server functions (getDashboardStats, getRecentActivity,
 * getMatchPreviews) are kept for targeted refetches (e.g. when
 * useActiveJobs invalidates only the stats key).
 */

import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
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

// ============================================================================
// Types
// ============================================================================

export interface DashboardStats {
	totalSongs: number;
	analyzedPercent: number;
	lastSyncAt: string | null;
	newSuggestions: number;
}

export interface DashboardPageData {
	stats: DashboardStats;
	recentActivity: ActivityItem[];
	matchPreviews: MatchPreview[];
}

// ============================================================================
// Internal helpers (pure functions, take accountId explicitly)
// ============================================================================

async function fetchDashboardStats(accountId: string): Promise<DashboardStats> {
	const [totalResult, analyzedResult, lastSyncResult, statsResult] =
		await Promise.all([
			getLikedSongCount(accountId),
			getAnalyzedCountForAccount(accountId),
			getLastCompletedSync(accountId),
			getLikedSongStats(accountId),
		]);

	const totalSongs = Result.isOk(totalResult) ? totalResult.value : 0;
	const analyzedCount = Result.isOk(analyzedResult) ? analyzedResult.value : 0;
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
}

async function fetchRecentActivity(accountId: string): Promise<ActivityItem[]> {
	const [likedResult] = await Promise.allSettled([
		getRecentWithDetails(accountId, 5),
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
		(a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
	);
}

async function fetchMatchPreviews(accountId: string): Promise<MatchPreview[]> {
	const contextResult = await getLatestMatchContext(accountId);
	if (Result.isError(contextResult) || !contextResult.value) return [];

	const [undecided, newSongIds] = await Promise.all([
		getUndecidedSongs(contextResult.value.id, accountId),
		getNewItemIds(accountId, "song"),
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
}

// ============================================================================
// Page-level aggregate: one auth check, one HTTP request
// ============================================================================

/**
 * Fetches all dashboard page data in a single authenticated request.
 * Use in the route loader for initial page load.
 */
export const getDashboardPageData = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<DashboardPageData> => {
		const { session } = context;

		const [stats, recentActivity, matchPreviews] = await Promise.all([
			fetchDashboardStats(session.accountId),
			fetchRecentActivity(session.accountId),
			fetchMatchPreviews(session.accountId),
		]);

		return { stats, recentActivity, matchPreviews };
	});

// ============================================================================
// Individual server functions (for targeted refetches)
// ============================================================================

export const getDashboardStats = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<DashboardStats> => {
		return fetchDashboardStats(context.session.accountId);
	});

export const getRecentActivity = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<ActivityItem[]> => {
		return fetchRecentActivity(context.session.accountId);
	});

export const getMatchPreviews = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<MatchPreview[]> => {
		return fetchMatchPreviews(context.session.accountId);
	});
