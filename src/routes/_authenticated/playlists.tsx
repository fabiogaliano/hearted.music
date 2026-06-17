import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Button } from "@/components/ui/Button";
import { useStepNavigation } from "@/features/onboarding/hooks/useStepNavigation";
import {
	PlaylistPreviewTourProvider,
	usePlaylistTourReporter,
	usePlaylistTourStep,
} from "@/features/onboarding/playlistPreviewTour";
import { SpotlightOverlay } from "@/features/onboarding/SpotlightOverlay";
import { TourCoachMark } from "@/features/onboarding/TourCoachMark";
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
	return (
		<PlaylistPreviewTourProvider>
			<PlaylistsPreviewInner />
		</PlaylistPreviewTourProvider>
	);
}

function PlaylistsPreviewInner() {
	const { navigateTo, isPending } = useStepNavigation();
	const { step, targetSelector, mode, caption, padding, feather } =
		usePlaylistTourStep();
	const { explainIntent } = usePlaylistTourReporter();

	// Continue unlocks only when the guided cycle completes (step "done" = the one
	// playlist flagged and described). Gating on the step rather than a raw flag count
	// keeps the "write its intent" beat mandatory — flagging alone won't release it.
	const ready = step === "done";

	return (
		<>
			<SandboxPlaylistsCoverFlowScreen />
			<div className="theme-bg theme-border-color fixed inset-x-0 bottom-0 z-40 flex justify-end border-t px-6 py-4 md:px-12">
				<Button
					variant="primary"
					onClick={() => void navigateTo("pick-demo-song")}
					disabled={isPending || !ready}
					// Once the cycle is done, Continue is the next action — breathe the
					// same pulse as the add toggle and Save to point the user at it.
					className={ready ? "xpl-pulse" : undefined}
				>
					Continue
				</Button>
			</div>
			<SpotlightOverlay
				targetSelector={targetSelector}
				blocking={mode === "block"}
				caption={caption}
				padding={padding}
				feather={feather}
			/>
			{step === "intent-intro" && (
				<TourCoachMark
					title="What's a playlist matching intent?"
					body={[
						"It's the description your liked songs get matched to. Pick one of the examples to set it.",
					]}
					actionLabel="Got it"
					onAction={explainIntent}
				/>
			)}
		</>
	);
}
