/**
 * Home view for dashboard
 *
 * Main dashboard landing showing stats, new songs CTA,
 * matching playlists overview, and activity feed.
 */

import { useRouteContext } from "@tanstack/react-router";
import { themes } from "@/lib/theme/colors";
import { DEFAULT_THEME } from "@/lib/theme/types";
import { HomeHeader } from "../components/HomeHeader";
import { NewSongsCTA } from "../components/NewSongsCTA";
import { MatchingPlaylistsSection } from "../components/MatchingPlaylistsSection";
import { ActivityFeed } from "../components/ActivityFeed";

export function HomeView() {
	const { dashboardData } = useRouteContext({
		from: "/_authenticated/dashboard",
	});
	const theme = themes[dashboardData.theme ?? DEFAULT_THEME];

	return (
		<div className="max-w-4xl">
			<HomeHeader
				theme={theme}
				stats={dashboardData.stats}
				userName={dashboardData.userName}
			/>

			<NewSongsCTA
				theme={theme}
				newSongsCount={dashboardData.stats.newSongsCount}
				recentActivity={dashboardData.recentActivity}
			/>

			<MatchingPlaylistsSection
				theme={theme}
				playlists={dashboardData.playlists}
			/>

			<ActivityFeed theme={theme} activities={dashboardData.recentActivity} />
		</div>
	);
}
