/**
 * Dashboard home view — the session's action hub.
 * Composition: HomeHeader → MatchReviewCTA → CreatePlaylistCTA → ActivityFeed
 */
import { useState } from "react";
import { StaggeredContent } from "@/components/ui/StaggeredContent";
import { useExtensionConnection } from "@/lib/extension/connection/useExtensionConnection";
import { hasNavigatedThisSession } from "@/lib/navigation/session-navigation";
import { ActivityFeed } from "./components/ActivityFeed";
import { DashboardSyncStatus } from "./components/DashboardSyncStatus";
import {
	ExtensionAccountBanner,
	showsReconnectBanner,
} from "./components/ExtensionAccountBanner";
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
	const { verdict } = useExtensionConnection(linkedSpotifyId);

	// One corner of the header, two mutually exclusive states — never both. A
	// broken connection has no sync to report on, so the reconnect bar takes the
	// slot outright; the last-sync line comes back the moment the verdict clears,
	// which is exactly when it has something to say (syncing…, then a timestamp).
	// A ternary rather than two conditionals so they can't both render or both
	// vanish, and so useDashboardSync is only ever subscribed once.
	const connectionCorner = showsReconnectBanner(verdict, linkedSpotifyId) ? (
		<ExtensionAccountBanner
			verdict={verdict}
			linkedSpotifyId={linkedSpotifyId}
			accountDisplayName={accountDisplayName}
		/>
	) : (
		<DashboardSyncStatus
			accountId={accountId}
			lastSyncText={lastSyncText}
			verdict={verdict}
			linkedSpotifyId={linkedSpotifyId}
		/>
	);

	return (
		<StaggeredContent
			className="mx-auto max-w-5xl"
			enabled={animateEntrance}
			staggerDelay={0.06}
			initialDelay={0.05}
		>
			<DashboardHeader handle={handle} trailing={connectionCorner} />

			<MatchReviewCTA
				reviewCount={stats.reviewCount}
				matchPreviews={matchPreviews}
				orientation={stats.matchOrientation}
			/>

			<CreatePlaylistCTA />

			<ActivityFeed activities={recentActivity} />
		</StaggeredContent>
	);
}
