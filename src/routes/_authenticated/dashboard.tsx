import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/features/dashboard/Dashboard";
import {
	dashboardPageDataQueryOptions,
	dashboardStatsQueryOptions,
	matchPreviewsQueryOptions,
	recentActivityQueryOptions,
	seedDashboardCaches,
} from "@/features/dashboard/queries";
import { formatRelativeTime } from "@/lib/shared/utils/format-time";

export const Route = createFileRoute("/_authenticated/dashboard")({
	loader: async ({ context }) => {
		const accountId = context.session.accountId;
		const pageData = await context.queryClient.ensureQueryData(
			dashboardPageDataQueryOptions(accountId),
		);
		seedDashboardCaches(context.queryClient, accountId, pageData);
	},
	component: DashboardHome,
});

function DashboardHome() {
	const { account, session } = Route.useRouteContext();

	const { data: stats } = useSuspenseQuery(
		dashboardStatsQueryOptions(session.accountId),
	);
	const { data: recentActivity } = useSuspenseQuery(
		recentActivityQueryOptions(session.accountId),
	);
	const { data: matchPreviews } = useSuspenseQuery(
		matchPreviewsQueryOptions(session.accountId),
	);

	const lastSyncText = stats.lastSyncAt
		? formatRelativeTime(stats.lastSyncAt)
		: "Never";

	return (
		<Dashboard
			accountId={session.accountId}
			handle={account?.handle ?? null}
			stats={{
				totalSongs: stats.totalSongs,
				analyzedPercent: stats.analyzedPercent,
				playlistCount: stats.playlistCount,
				reviewCount: stats.pendingReviewCount,
				matchOrientation: stats.matchOrientation,
			}}
			lastSyncText={lastSyncText}
			matchPreviews={matchPreviews}
			recentActivity={recentActivity}
		/>
	);
}
