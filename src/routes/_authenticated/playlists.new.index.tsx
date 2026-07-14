/**
 * /playlists/new (index) — beat 1, the seed landing entrance.
 *
 * Blocks on the taste profile: the entrance renders its ideas + library
 * count from it. The intent gate is already ensured by the parent layout, so
 * IdeasBoard reads both from cache on first paint.
 */

import { createFileRoute } from "@tanstack/react-router";
import { IdeasScreen } from "@/features/playlists/create/IdeasScreen";
import { tasteProfileQueryOptions } from "@/features/playlists/create/tasteProfile";

export const Route = createFileRoute("/_authenticated/playlists/new/")({
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(tasteProfileQueryOptions());
		// The board's per-visit shuffle is seeded here, in the loader, so a hard
		// load mints it on the server and serializes it to the client — server and
		// client then compute the same shuffleIdeas draw, no hydration mismatch.
		// The loader re-runs on every reload/navigation, so the board reshuffles
		// each time while staying stable in-page.
		return { ideaShuffleSeed: Math.floor(Math.random() * 0xffffffff) };
	},
	component: IdeasPage,
});

function IdeasPage() {
	const { billingState } = Route.useRouteContext();
	const { ideaShuffleSeed } = Route.useLoaderData();
	return (
		<IdeasScreen
			billingState={billingState}
			ideaShuffleSeed={ideaShuffleSeed}
		/>
	);
}
