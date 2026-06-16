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
import type { ActivityItem, MatchPreview } from "@/features/dashboard/types";
import { getAnalyzedCountForAccount } from "@/lib/domains/enrichment/content-analysis/queries";
import {
	getCount as getLikedSongCount,
	getRecentWithDetails,
} from "@/lib/domains/library/liked-songs/queries";
import { getPlaylistCount } from "@/lib/domains/library/playlists/queries";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import { getLastCompletedSync } from "@/lib/platform/jobs/sync-phase-jobs";
import { resolveMatchReviewSummary } from "@/lib/server/match-review-queue.functions";

// ============================================================================
// Types
// ============================================================================

export interface DashboardStats {
	totalSongs: number;
	analyzedPercent: number;
	lastSyncAt: string | null;
	// Renamed from hasSuggestions to pendingReviewCount to match the queue-aware
	// source. The route's stats→DashboardProps mapping is updated accordingly.
	pendingReviewCount: number;
	playlistCount: number;
}

export interface DashboardPageData {
	stats: DashboardStats;
	recentActivity: ActivityItem[];
	matchPreviews: MatchPreview[];
}

// ============================================================================
// Internal helpers (pure functions, take accountId explicitly)
// ============================================================================

async function fetchDashboardStats(
	accountId: string,
	pendingReviewCount: number,
): Promise<DashboardStats> {
	const [totalResult, analyzedResult, lastSyncResult, playlistCountResult] =
		await Promise.all([
			getLikedSongCount(accountId),
			getAnalyzedCountForAccount(accountId),
			getLastCompletedSync(accountId),
			getPlaylistCount(accountId),
		]);

	const totalSongs = Result.isOk(totalResult) ? totalResult.value : 0;
	const analyzedCount = Result.isOk(analyzedResult) ? analyzedResult.value : 0;
	const lastSync = Result.isOk(lastSyncResult) ? lastSyncResult.value : null;
	const playlistCount = Result.isOk(playlistCountResult)
		? playlistCountResult.value
		: 0;

	return {
		totalSongs,
		analyzedPercent:
			totalSongs > 0 ? Math.round((analyzedCount / totalSongs) * 100) : 0,
		lastSyncAt: lastSync?.completed_at ?? null,
		pendingReviewCount,
		playlistCount,
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

// ============================================================================
// Page-level aggregate: one auth check, one HTTP request
// ============================================================================

/**
 * Fetches all dashboard page data in a single authenticated request.
 * Use in the route loader for initial page load.
 *
 * resolveMatchReviewSummary is called once here and its result feeds BOTH
 * the CTA count (stats.pendingReviewCount) and the preview fan — no double
 * fetch within this aggregate request.
 */
export const getDashboardPageData = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<DashboardPageData> => {
		const { session } = context;

		// resolveMatchReviewSummary runs in parallel with recent activity so the
		// one summary call feeds BOTH pendingReviewCount and previewImages.
		const [summary, recentActivity] = await Promise.all([
			resolveMatchReviewSummary(session.accountId),
			fetchRecentActivity(session.accountId),
		]);

		const stats = await fetchDashboardStats(
			session.accountId,
			summary.pendingCount,
		);
		const matchPreviews: MatchPreview[] = summary.previewImages;

		return { stats, recentActivity, matchPreviews };
	});

// ============================================================================
// Individual server functions (for targeted refetches)
// ============================================================================

export const getDashboardStats = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<DashboardStats> => {
		const summary = await resolveMatchReviewSummary(context.session.accountId);
		return fetchDashboardStats(context.session.accountId, summary.pendingCount);
	});

export const getRecentActivity = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<ActivityItem[]> => {
		return fetchRecentActivity(context.session.accountId);
	});

export const getMatchPreviews = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<MatchPreview[]> => {
		const summary = await resolveMatchReviewSummary(context.session.accountId);
		return summary.previewImages;
	});
