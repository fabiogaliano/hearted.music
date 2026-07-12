/**
 * /playlists/new — playlist creation route.
 *
 * Loader:
 * 1. Fire-and-forget Phase-1 enrichment kick-off (warms the library while the
 *    user configures their draft — no await; failure is non-fatal).
 * 2. Block on what the seed landing (beat 1) actually shows: the taste profile
 *    (its templates + library count) and the intent gate (its locked treatment).
 * 3. Prefetch the studio's initial preview (beat 2) WITHOUT awaiting — it isn't
 *    on screen until the user seeds, and PreviewList has its own loading state,
 *    so a slow preview engine never blocks landing on the page.
 *
 * The route is a sibling of playlists.$playlistRef — same parent layout, same
 * authenticated context.
 */

import { createFileRoute } from "@tanstack/react-router";
import { CreatePlaylistScreen } from "@/features/playlists/create/CreatePlaylistScreen";
import { intentEligibilityQueryOptions } from "@/features/playlists/create/intentEligibility";
import {
	DEFAULT_DRAFT_CONFIG,
	playlistDraftPreviewQueryOptions,
} from "@/features/playlists/create/queries";
import { tasteProfileQueryOptions } from "@/features/playlists/create/tasteProfile";
import { requestLibraryPhase1Enrichment } from "@/lib/server/enrichment.functions";

export const Route = createFileRoute("/_authenticated/playlists/new")({
	loader: async ({ context }) => {
		// Phase-1 enrichment is fire-and-forget: it warms audio/genre data for the
		// preview engine while the user is looking at the creation page. We do not
		// await its result — it is idempotent and non-fatal if it fails.
		void requestLibraryPhase1Enrichment({ data: undefined });

		// Beat 2's preview is prefetched but not awaited — the seed landing is
		// what paints first, so the preview engine's latency must not gate it.
		void context.queryClient.prefetchQuery(
			playlistDraftPreviewQueryOptions(DEFAULT_DRAFT_CONFIG),
		);

		// Block only on what the seed landing renders: the taste profile (its
		// templates + count) and the intent gate (its locked treatment).
		await Promise.all([
			context.queryClient.ensureQueryData(tasteProfileQueryOptions()),
			context.queryClient.ensureQueryData(intentEligibilityQueryOptions()),
		]);
	},
	component: CreatePlaylistPage,
});

function CreatePlaylistPage() {
	// Pull accountId and billingState from the authenticated route context —
	// they are pre-loaded in beforeLoad and available synchronously.
	const { session, billingState } = Route.useRouteContext();
	return (
		<CreatePlaylistScreen
			accountId={session.accountId}
			billingState={billingState}
		/>
	);
}
