import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import {
	getDashboardPageData,
	getDashboardStats,
	getRecentActivity,
	getMatchPreviews,
	type DashboardPageData,
} from "@/lib/server/dashboard.functions";

export const dashboardKeys = {
	all: ["dashboard"] as const,
	pageData: (accountId: string) =>
		["dashboard", "page-data", accountId] as const,
	stats: (accountId: string) => ["dashboard", "stats", accountId] as const,
	recentActivity: (accountId: string) =>
		["dashboard", "recent-activity", accountId] as const,
	matchPreviews: (accountId: string) =>
		["dashboard", "match-previews", accountId] as const,
};

/**
 * Aggregate query: fetches all dashboard data in a single authenticated
 * server request. Use in the route loader to avoid 3 separate RPCs.
 */
export function dashboardPageDataQueryOptions(accountId: string) {
	return queryOptions({
		queryKey: dashboardKeys.pageData(accountId),
		queryFn: () => getDashboardPageData(),
		staleTime: 30_000,
	});
}

/**
 * After the aggregate query resolves, seed the individual query caches
 * so components using useSuspenseQuery on individual keys get data
 * synchronously. useActiveJobs can still invalidate individual keys.
 */
export function seedDashboardCaches(
	queryClient: QueryClient,
	accountId: string,
	data: DashboardPageData,
) {
	queryClient.setQueryData(dashboardKeys.stats(accountId), data.stats);
	queryClient.setQueryData(
		dashboardKeys.recentActivity(accountId),
		data.recentActivity,
	);
	queryClient.setQueryData(
		dashboardKeys.matchPreviews(accountId),
		data.matchPreviews,
	);
}

/**
 * Individual query options — used by components (useSuspenseQuery) and
 * as fallback queryFn when useActiveJobs invalidates a single key.
 */
export function dashboardStatsQueryOptions(accountId: string) {
	return queryOptions({
		queryKey: dashboardKeys.stats(accountId),
		queryFn: () => getDashboardStats(),
		staleTime: 30_000,
	});
}

export function recentActivityQueryOptions(accountId: string) {
	return queryOptions({
		queryKey: dashboardKeys.recentActivity(accountId),
		queryFn: () => getRecentActivity(),
		staleTime: 30_000,
	});
}

export function matchPreviewsQueryOptions(accountId: string) {
	return queryOptions({
		queryKey: dashboardKeys.matchPreviews(accountId),
		queryFn: () => getMatchPreviews(),
		staleTime: 30_000,
	});
}
