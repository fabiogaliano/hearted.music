import { queryOptions } from "@tanstack/react-query";
import { getDashboardStats } from "@/lib/server/dashboard.functions";
import { dashboardStatsKey } from "@/lib/hooks/useActiveJobs";

export const dashboardKeys = {
	all: ["dashboard"] as const,
	stats: (accountId: string) => dashboardStatsKey(accountId),
};

export function dashboardStatsQueryOptions(accountId: string) {
	return queryOptions({
		queryKey: dashboardKeys.stats(accountId),
		queryFn: () => getDashboardStats(),
		staleTime: 30_000,
	});
}
