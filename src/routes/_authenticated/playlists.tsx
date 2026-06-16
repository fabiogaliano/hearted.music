import { createFileRoute, Outlet } from "@tanstack/react-router";
import { PlaylistsCoverFlowScreen } from "@/features/playlists/PlaylistsCoverFlowScreen";
import { playlistManagementQueryOptions } from "@/features/playlists/queries";

export const Route = createFileRoute("/_authenticated/playlists")({
	loader: async ({ context }) => {
		const accountId = context.session.accountId;
		await context.queryClient.ensureQueryData(
			playlistManagementQueryOptions(accountId),
		);
	},
	component: PlaylistsPage,
});

function PlaylistsPage() {
	const { session, onboardingSession } = Route.useRouteContext();

	// During the flag-playlists onboarding step the user previews this real screen
	// in preview chrome (routed here by the _authenticated guard). Phase 3 swaps in
	// canned sandbox data and the continue affordance; for now the branch only marks
	// where that preview-only UI will mount.
	const isPlaylistPreview = onboardingSession.status === "flag-playlists";

	return (
		<>
			<PlaylistsCoverFlowScreen accountId={session.accountId} />
			{isPlaylistPreview ? (
				// Phase 3 replaces this no-op slot with the preview banner + the
				// continue-to-demo affordance (and swaps in canned sandbox data).
				<div data-onboarding-preview="flag-playlists" hidden />
			) : null}
			<Outlet />
		</>
	);
}
