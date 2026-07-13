/**
 * /playlists/new/studio — beat 2, the studio.
 *
 * The seed chosen on the entrance arrives in router history state (studioSeed.ts)
 * and initializes the draft — it stays out of the URL, which reads a clean
 * /playlists/new/studio. Landing cold (no state, e.g. a refresh or deep link) is
 * the legitimate "from scratch" open. The intent gate is ensured by the parent
 * layout; the studio's own draft query warms the preview on mount.
 */

import { createFileRoute, useLocation } from "@tanstack/react-router";
import { StudioScreen } from "@/features/playlists/create/StudioScreen";
import type { StudioSeed } from "@/features/playlists/create/studioSeed";

const EMPTY_SEED: StudioSeed = {};

export const Route = createFileRoute("/_authenticated/playlists/new/studio")({
	component: StudioPage,
});

function StudioPage() {
	const { session, billingState } = Route.useRouteContext();
	// Stable ref: history state doesn't change under a mounted studio, and the
	// EMPTY_SEED fallback is a module constant, so re-seeding is a fresh mount
	// rather than a mid-life prop change.
	const seed = useLocation({ select: (l) => l.state.studioSeed }) ?? EMPTY_SEED;
	return (
		<StudioScreen
			accountId={session.accountId}
			billingState={billingState}
			seed={seed}
		/>
	);
}
