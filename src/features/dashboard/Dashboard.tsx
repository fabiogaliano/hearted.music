/**
 * Dashboard home view.
 * Composition: HomeHeader → MatchReviewCTA → ActivityFeed
 */
import { useState } from "react";
import { StaggeredContent } from "@/components/ui/StaggeredContent";
import { hasNavigatedThisSession } from "@/lib/navigation/session-navigation";
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
	// The whisper fade is a "welcome" on the first page of the session. If the
	// user reached the dashboard by navigating in-app, render it plainly like
	// Liked Songs and Playlists. Frozen at mount so it never replays on re-render.
	const [animateEntrance] = useState(() => !hasNavigatedThisSession());

	return (
		<StaggeredContent
			className="mx-auto max-w-5xl"
			enabled={animateEntrance}
			staggerDelay={0.06}
			initialDelay={0.05}
		>
			<DashboardHeader accountId={accountId} stats={stats} handle={handle} />

			<MatchReviewCTA
				reviewCount={stats.reviewCount}
				matchPreviews={matchPreviews}
				orientation={stats.matchOrientation}
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
