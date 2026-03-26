/**
 * Dashboard home view.
 * Composition: HomeHeader → MatchReviewCTA → ActivityFeed
 */
import { ActivityFeed } from "./components/ActivityFeed";
import { DashboardHeader } from "./sections/DashboardHeader";
import { MatchReviewCTA } from "./sections/MatchReviewCTA";
import type { DashboardProps } from "./types";

export function Dashboard({
	displayName,
	recentActivity,
	matchPreviews,
	stats,
	isEnrichmentRunning,
	smoothAnalyzedPercent,
	lastSyncText,
}: DashboardProps) {
	return (
		<div className="max-w-4xl">
			<DashboardHeader
				stats={stats}
				isEnrichmentRunning={isEnrichmentRunning}
				smoothAnalyzedPercent={smoothAnalyzedPercent}
				displayName={displayName}
				lastSyncText={lastSyncText}
			/>

			<MatchReviewCTA
				reviewCount={stats.reviewCount}
				matchPreviews={matchPreviews}
			/>

			<ActivityFeed activities={recentActivity} />
		</div>
	);
}

export default Dashboard;
