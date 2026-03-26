import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/features/dashboard/Dashboard";
import { dashboardStatsQueryOptions } from "@/features/dashboard/queries";
import { useActiveJobs } from "@/lib/hooks/useActiveJobs";
import { useSmoothProgress } from "@/lib/hooks/useSmoothProgress";
import {
	getMatchPreviews,
	getRecentActivity,
} from "@/lib/server/dashboard.functions";
import { formatRelativeTime } from "@/lib/shared/utils/format-time";

export const Route = createFileRoute("/_authenticated/dashboard")({
	loader: async ({ context }) => {
		const [, recentActivity, matchPreviews] = await Promise.all([
			context.queryClient.ensureQueryData(
				dashboardStatsQueryOptions(context.session.accountId),
			),
			getRecentActivity(),
			getMatchPreviews(),
		]);
		return { recentActivity, matchPreviews };
	},
	component: DashboardHome,
});

function DashboardHome() {
	const { account, session } = Route.useRouteContext();
	const { recentActivity, matchPreviews } = Route.useLoaderData();
	const displayName = account?.display_name ?? account?.email ?? null;

	const { data: stats } = useSuspenseQuery(
		dashboardStatsQueryOptions(session.accountId),
	);

	const { isEnrichmentRunning, enrichmentProgress } = useActiveJobs(
		session.accountId,
	);

	const rawPercent = enrichmentProgress
		? enrichmentProgress.total > 0
			? Math.round((enrichmentProgress.done / enrichmentProgress.total) * 100)
			: 0
		: stats.analyzedPercent;
	const smoothAnalyzedPercent = useSmoothProgress(
		rawPercent,
		!isEnrichmentRunning && rawPercent >= 100,
	);

	const lastSyncText = stats.lastSyncAt
		? formatRelativeTime(stats.lastSyncAt)
		: "Never";

	return (
		<Dashboard
			displayName={displayName}
			stats={{
				totalSongs: stats.totalSongs,
				analyzedPercent: stats.analyzedPercent,
				matchedCount: 421,
				playlistCount: 4,
				reviewCount: stats.newSuggestions,
			}}
			isEnrichmentRunning={isEnrichmentRunning}
			smoothAnalyzedPercent={Math.floor(smoothAnalyzedPercent)}
			lastSyncText={lastSyncText}
			matchPreviews={matchPreviews}
			recentActivity={recentActivity}
		/>
	);
}
