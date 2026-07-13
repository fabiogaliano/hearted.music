/**
 * /playlists/new — layout for the two-beat creation flow.
 *
 * The flow is split across two routes that share this layout: the entrance
 * (beat 1, the index route → IdeasScreen) and the studio (beat 2,
 * playlists.new.studio → StudioScreen). This layout owns only what BOTH beats
 * need on entry, whichever they land on first (including a deep link straight
 * to the studio):
 *
 * 1. Fire-and-forget Phase-1 enrichment kick-off — warms audio/genre data for
 *    the preview engine while the user configures a draft. No await; idempotent
 *    and non-fatal if it fails.
 * 2. The intent gate — the entrance renders its locked/unlocked treatment, and
 *    the studio gates the seeded intent + the IntentEditor on it.
 *
 * The taste profile (entrance-only) and the seeded preview prefetch (studio-
 * only) live on the respective child loaders, so neither beat blocks on data
 * the other one owns.
 */

import { createFileRoute, Outlet } from "@tanstack/react-router";
import { intentEligibilityQueryOptions } from "@/features/playlists/create/intentEligibility";
import { requestLibraryPhase1Enrichment } from "@/lib/server/enrichment.functions";

export const Route = createFileRoute("/_authenticated/playlists/new")({
	loader: async ({ context }) => {
		void requestLibraryPhase1Enrichment({ data: undefined });
		await context.queryClient.ensureQueryData(intentEligibilityQueryOptions());
	},
	component: () => <Outlet />,
});
