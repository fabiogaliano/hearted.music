import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/features/dashboard/Dashboard";
import {
	getDashboardStats,
	getMatchPreviews,
	getRecentActivity,
} from "@/lib/server/dashboard.functions";
import { formatRelativeTime } from "@/lib/shared/utils/format-time";

export const Route = createFileRoute("/_authenticated/dashboard")({
	loader: async () => {
		const [stats, recentActivity, matchPreviews] = await Promise.all([
			getDashboardStats(),
			getRecentActivity(),
			getMatchPreviews(),
		]);
		return { stats, recentActivity, matchPreviews };
	},
	component: DashboardHome,
});

function DashboardHome() {
	const { account } = Route.useRouteContext();
	const { stats, recentActivity, matchPreviews } = Route.useLoaderData();
	const displayName = account?.display_name ?? account?.email ?? null;

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
			lastSyncText={lastSyncText}
			matchPreviews={matchPreviews}
			recentActivity={recentActivity}
		/>
	);
}
