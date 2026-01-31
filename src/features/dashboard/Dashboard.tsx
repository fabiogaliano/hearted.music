/**
 * Dashboard home view.
 * Composition: HomeHeader → MatchReviewCTA → ActivityFeed
 */
import { ActivityFeed } from "./components/ActivityFeed";
import { DashboardHeader } from "./sections/DashboardHeader";
import { MatchReviewCTA } from "./sections/MatchReviewCTA";
import type { DashboardProps } from "./types";

export function Dashboard({
	theme,
	displayName,
	recentActivity,
	matchPreviews,
	stats,
	lastSyncText,
}: DashboardProps) {
	return (
		<div className="max-w-4xl">
			<DashboardHeader
				theme={theme}
				stats={stats}
				displayName={displayName}
				lastSyncText={lastSyncText}
			/>

			<MatchReviewCTA
				theme={theme}
				reviewCount={stats.reviewCount}
				matchPreviews={matchPreviews}
			/>

			<ActivityFeed theme={theme} activities={recentActivity} />
		</div>
	);
}

export default Dashboard;
