/**
 * /playlists/new — playlist creation route.
 *
 * Loader:
 * 1. Fire-and-forget Phase-1 enrichment kick-off (warms the library while the
 *    user configures their draft — no await; failure is non-fatal).
 * 2. ensureQueryData for the initial preview with DEFAULT_DRAFT_CONFIG so the
 *    first render is never an empty skeleton.
 *
 * The route is a sibling of playlists.$playlistRef — same parent layout, same
 * authenticated context.
 */

import { createFileRoute } from "@tanstack/react-router";
import { CreatePlaylistScreen } from "@/features/playlists/create/CreatePlaylistScreen";
import {
	DEFAULT_DRAFT_CONFIG,
	playlistDraftPreviewQueryOptions,
} from "@/features/playlists/create/queries";
import { requestLibraryPhase1Enrichment } from "@/lib/server/enrichment.functions";

export const Route = createFileRoute("/_authenticated/playlists/new")({
	loader: async ({ context }) => {
		// Phase-1 enrichment is fire-and-forget: it warms audio/genre data for the
		// preview engine while the user is looking at the creation page. We do not
		// await its result — it is idempotent and non-fatal if it fails.
		void requestLibraryPhase1Enrichment({ data: undefined });

		// Pre-warm the initial preview so the first render isn't blank. Uses the
		// default config (maxSongs 15, no intent, empty pills, empty filters v1).
		await context.queryClient.ensureQueryData(
			playlistDraftPreviewQueryOptions(DEFAULT_DRAFT_CONFIG),
		);
	},
	component: CreatePlaylistPage,
});

function CreatePlaylistPage() {
	return <CreatePlaylistScreen />;
}
