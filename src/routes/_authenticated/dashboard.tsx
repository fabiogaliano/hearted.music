import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/features/dashboard/Dashboard";
import {
	dashboardPageDataQueryOptions,
	dashboardStatsQueryOptions,
	matchPreviewsQueryOptions,
	recentActivityQueryOptions,
	seedDashboardCaches,
} from "@/features/dashboard/queries";
import { formatRelativeTime } from "@/lib/shared/utils/format-time";

export const Route = createFileRoute("/_authenticated/dashboard")({
	loader: async ({ context }) => {
		const accountId = context.session.accountId;
		const pageData = await context.queryClient.ensureQueryData(
			dashboardPageDataQueryOptions(accountId),
		);
		seedDashboardCaches(context.queryClient, accountId, pageData);
	},
	component: DashboardHome,
});

function DashboardHome() {
	const { account, session } = Route.useRouteContext();

	const { data: stats } = useSuspenseQuery(
		dashboardStatsQueryOptions(session.accountId),
	);
	const { data: recentActivity } = useSuspenseQuery(
		recentActivityQueryOptions(session.accountId),
	);
	const { data: matchPreviews } = useSuspenseQuery(
		matchPreviewsQueryOptions(session.accountId),
	);

	// Carries its own verb: this sits beside a "Sync new songs" button, where a
	// bare "2 hours ago" leaves the reader to guess what happened then.
	//
	// null, not a phrase, when no sync has completed. It's tempting to write
	// "Nothing synced yet" there, but lastSyncAt is null for three different
	// situations — a sync in flight right now, one that failed, and a genuine
	// never — and that phrase asserts the third while usually meaning the first:
	// onboarding advances on the extension's own "done", which it sets on the 202
	// from /api/extension/sync, before the worker has claimed the job. With
	// nothing true to say about all three, the row says nothing and shows only
	// the action.
	const lastSyncText = stats.lastSyncAt
		? `Synced ${formatRelativeTime(stats.lastSyncAt)}`
		: null;

	return (
		<Dashboard
			accountId={session.accountId}
			handle={account?.handle ?? null}
			linkedSpotifyId={account?.spotify_id ?? null}
			accountDisplayName={account?.display_name ?? null}
			stats={{
				totalSongs: stats.totalSongs,
				analyzedPercent: stats.analyzedPercent,
				playlistCount: stats.playlistCount,
				reviewCount: stats.pendingReviewCount,
				matchOrientation: stats.matchOrientation,
			}}
			lastSyncText={lastSyncText}
			matchPreviews={matchPreviews}
			recentActivity={recentActivity}
		/>
	);
}
