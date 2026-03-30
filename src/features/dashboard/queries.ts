import { queryOptions } from "@tanstack/react-query";
import {
	getDashboardStats,
	getMatchPreviews,
	getRecentActivity,
} from "@/lib/server/dashboard.functions";

export const dashboardKeys = {
	all: ["dashboard"] as const,
	stats: (accountId: string) => ["dashboard", "stats", accountId] as const,
	recentActivity: (accountId: string) =>
		["dashboard", "recent-activity", accountId] as const,
	matchPreviews: (accountId: string) =>
		["dashboard", "match-previews", accountId] as const,
};

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
