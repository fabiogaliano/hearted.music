import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/features/dashboard/Dashboard";
import {
	dashboardStatsQueryOptions,
	matchPreviewsQueryOptions,
	recentActivityQueryOptions,
} from "@/features/dashboard/queries";
import { useActiveJobs } from "@/lib/hooks/useActiveJobs";
import { useSmoothProgress } from "@/lib/hooks/useSmoothProgress";
import { formatRelativeTime } from "@/lib/shared/utils/format-time";

export const Route = createFileRoute("/_authenticated/dashboard")({
	loader: async ({ context }) => {
		const accountId = context.session.accountId;
		await Promise.all([
			context.queryClient.ensureQueryData(
				dashboardStatsQueryOptions(accountId),
			),
			context.queryClient.ensureQueryData(
				recentActivityQueryOptions(accountId),
			),
			context.queryClient.ensureQueryData(matchPreviewsQueryOptions(accountId)),
		]);
	},
	component: DashboardHome,
});

function DashboardHome() {
	const { account, session } = Route.useRouteContext();
	const displayName = account?.display_name ?? account?.email ?? null;

	const { data: stats } = useSuspenseQuery(
		dashboardStatsQueryOptions(session.accountId),
	);
	const { data: recentActivity } = useSuspenseQuery(
		recentActivityQueryOptions(session.accountId),
	);
	const { data: matchPreviews } = useSuspenseQuery(
		matchPreviewsQueryOptions(session.accountId),
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
