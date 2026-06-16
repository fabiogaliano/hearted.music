import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Button } from "@/components/ui/Button";
import { useStepNavigation } from "@/features/onboarding/hooks/useStepNavigation";
import { PlaylistsCoverFlowScreen } from "@/features/playlists/PlaylistsCoverFlowScreen";
import { playlistManagementQueryOptions } from "@/features/playlists/queries";
import { SandboxPlaylistsCoverFlowScreen } from "@/features/playlists/SandboxPlaylistsCoverFlowScreen";

export const Route = createFileRoute("/_authenticated/playlists")({
	loader: async ({ context }) => {
		// The flag-playlists preview renders a local sandbox screen, so the real
		// playlist-management data is never read — skip the fetch entirely.
		if (context.onboardingSession.status === "flag-playlists") return;
		await context.queryClient.ensureQueryData(
			playlistManagementQueryOptions(context.session.accountId),
		);
	},
	component: PlaylistsPage,
});

function PlaylistsPage() {
	const { session, onboardingSession } = Route.useRouteContext();

	if (onboardingSession.status === "flag-playlists") {
		return <PlaylistsPreview />;
	}

	return (
		<>
			<PlaylistsCoverFlowScreen accountId={session.accountId} />
			<Outlet />
		</>
	);
}

// The flag-playlists onboarding step rehearsed on the real screen: canned
// playlists with local-only actions, plus a continue affordance that advances to
// the demo song picker. Nothing here persists — it's a rehearsal, so the local
// sandbox state is discarded on continue.
function PlaylistsPreview() {
	const { navigateTo, isPending } = useStepNavigation();

	return (
		<>
			<SandboxPlaylistsCoverFlowScreen />
			<div className="theme-bg theme-border-color fixed inset-x-0 bottom-0 z-40 flex justify-end border-t px-6 py-4 md:px-12">
				<Button
					variant="primary"
					onClick={() => void navigateTo("pick-demo-song")}
					disabled={isPending}
				>
					{/* TODO(copy): continue-to-demo label */}
					TODO(copy)
				</Button>
			</div>
		</>
	);
}
