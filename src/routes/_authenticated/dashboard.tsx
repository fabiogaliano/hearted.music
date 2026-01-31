import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/features/dashboard/Dashboard";
import {
	getDashboardStats,
	getRecentActivity,
} from "@/lib/server/dashboard.server";
import { formatRelativeTime } from "@/lib/shared/utils/format-time";
import { getTheme } from "@/lib/theme/useTheme";
import { DEFAULT_THEME } from "@/lib/theme/types";

export const Route = createFileRoute("/_authenticated/dashboard")({
	loader: async () => {
		const [stats, recentActivity] = await Promise.all([
			getDashboardStats(),
			getRecentActivity(),
		]);
		return { stats, recentActivity };
	},
	component: DashboardHome,
});

function DashboardHome() {
	const { theme: themeColor, account } = Route.useRouteContext();
	const { stats, recentActivity } = Route.useLoaderData();
	const theme = getTheme(themeColor ?? DEFAULT_THEME);
	const displayName = account?.display_name ?? account?.email ?? null;

	const lastSyncText = stats.lastSyncAt
		? formatRelativeTime(stats.lastSyncAt)
		: "Never";

	const mockMatchPreviews = [
		{
			id: 1,
			image: "https://i.scdn.co/image/ab67616d0000b2738863bc11d2aa12b54f5aeb36",
		},
		{
			id: 2,
			image: "https://i.scdn.co/image/ab67616d0000b273bd26ede1ae69327010d49946",
		},
		{
			id: 3,
			image: "https://i.scdn.co/image/ab67616d0000b273712701c5e263efc8726b1464",
		},
	];

	return (
		<Dashboard
			theme={theme}
			displayName={displayName}
			stats={{
				totalSongs: stats.totalSongs,
				analyzedPercent: stats.analyzedPercent,
				matchedCount: 421,
				playlistCount: 4,
				reviewCount: 5,
			}}
			lastSyncText={lastSyncText}
			matchPreviews={mockMatchPreviews}
			recentActivity={recentActivity}
		/>
	);
}
