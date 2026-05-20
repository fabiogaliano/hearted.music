/**
 * Dashboard home view.
 * Composition: HomeHeader → MatchReviewCTA → ActivityFeed
 */
import { StaggeredContent } from "@/features/onboarding/components/StaggeredContent";
import { ActivityFeed } from "./components/ActivityFeed";
import { DashboardHeader } from "./sections/DashboardHeader";
import { MatchReviewCTA } from "./sections/MatchReviewCTA";
import type { DashboardProps } from "./types";

export function Dashboard({
	accountId,
	displayName,
	recentActivity,
	matchPreviews,
	stats,
	lastSyncText,
}: DashboardProps) {
	return (
		<StaggeredContent
			className="mx-auto max-w-4xl"
			staggerDelay={0.06}
			initialDelay={0.05}
		>
			<DashboardHeader
				accountId={accountId}
				stats={stats}
				displayName={displayName}
				lastSyncText={lastSyncText}
			/>

			<MatchReviewCTA
				reviewCount={stats.reviewCount}
				matchPreviews={matchPreviews}
			/>

			<ActivityFeed activities={recentActivity} />
		</StaggeredContent>
	);
}
