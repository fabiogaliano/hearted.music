/**
 * Dashboard home view.
 * Composition: HomeHeader → MatchReviewCTA → ActivityFeed
 */
import { StaggeredContent } from "@/components/ui/StaggeredContent";
import { ActivityFeed } from "./components/ActivityFeed";
import { DashboardSyncStatus } from "./components/DashboardSyncStatus";
import { DashboardHeader } from "./sections/DashboardHeader";
import { MatchReviewCTA } from "./sections/MatchReviewCTA";
import type { DashboardProps } from "./types";

export function Dashboard({
	accountId,
	handle,
	recentActivity,
	matchPreviews,
	stats,
	lastSyncText,
}: DashboardProps) {
	return (
		<StaggeredContent
			className="mx-auto max-w-5xl"
			staggerDelay={0.06}
			initialDelay={0.05}
		>
			<DashboardHeader accountId={accountId} stats={stats} handle={handle} />

			<MatchReviewCTA
				reviewCount={stats.reviewCount}
				matchPreviews={matchPreviews}
			/>

			<ActivityFeed
				activities={recentActivity}
				trailing={
					<DashboardSyncStatus
						accountId={accountId}
						lastSyncText={lastSyncText}
					/>
				}
			/>
		</StaggeredContent>
	);
}
