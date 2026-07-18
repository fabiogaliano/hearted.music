/**
 * Dashboard home view — the session's action hub.
 * Composition: HomeHeader → MatchReviewCTA → CreatePlaylistCTA → ActivityFeed
 */
import { useState } from "react";
import { StaggeredContent } from "@/components/ui/StaggeredContent";
import { useExtensionAccountConflict } from "@/lib/extension/useExtensionAccountConflict";
import { hasNavigatedThisSession } from "@/lib/navigation/session-navigation";
import { ActivityFeed } from "./components/ActivityFeed";
import { DashboardSyncStatus } from "./components/DashboardSyncStatus";
import { ExtensionAccountBanner } from "./components/ExtensionAccountBanner";
import { CreatePlaylistCTA } from "./sections/CreatePlaylistCTA";
import { DashboardHeader } from "./sections/DashboardHeader";
import { MatchReviewCTA } from "./sections/MatchReviewCTA";
import type { DashboardProps } from "./types";

export function Dashboard({
	accountId,
	handle,
	linkedSpotifyId,
	accountDisplayName,
	recentActivity,
	matchPreviews,
	stats,
	lastSyncText,
}: DashboardProps) {
	// The whisper fade is a "welcome" on the first page of the session. If the
	// user reached the dashboard by navigating in-app, render it plainly like
	// Liked Songs and Playlists. Frozen at mount so it never replays on re-render.
	const [animateEntrance] = useState(() => !hasNavigatedThisSession());
	const { check: accountCheck, recheck } =
		useExtensionAccountConflict(linkedSpotifyId);
	const conflict =
		accountCheck.kind === "conflict" ? accountCheck.conflict : null;

	return (
		<StaggeredContent
			className="mx-auto max-w-5xl"
			enabled={animateEntrance}
			staggerDelay={0.06}
			initialDelay={0.05}
		>
			<DashboardHeader accountId={accountId} stats={stats} handle={handle} />

			<ExtensionAccountBanner
				conflict={conflict}
				accountDisplayName={accountDisplayName}
				recheck={recheck}
			/>

			<MatchReviewCTA
				reviewCount={stats.reviewCount}
				matchPreviews={matchPreviews}
				orientation={stats.matchOrientation}
			/>

			<CreatePlaylistCTA />

			<ActivityFeed
				activities={recentActivity}
				trailing={
					<DashboardSyncStatus
						accountId={accountId}
						lastSyncText={lastSyncText}
						accountCheck={accountCheck}
					/>
				}
			/>
		</StaggeredContent>
	);
}
