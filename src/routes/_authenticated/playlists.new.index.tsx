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
	},
	component: IdeasPage,
});

function IdeasPage() {
	const { billingState } = Route.useRouteContext();
	return <IdeasScreen billingState={billingState} />;
}
