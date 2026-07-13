/**
 * /playlists/new (index) — beat 1, the seed landing entrance.
 *
 * Blocks on the taste profile: the entrance renders its templates + library
 * count from it. The intent gate is already ensured by the parent layout, so
 * SeedStage reads both from cache on first paint.
 */

import { createFileRoute } from "@tanstack/react-router";
import { SeedLandingScreen } from "@/features/playlists/create/SeedLandingScreen";
import { tasteProfileQueryOptions } from "@/features/playlists/create/tasteProfile";

export const Route = createFileRoute("/_authenticated/playlists/new/")({
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(tasteProfileQueryOptions());
	},
	component: SeedLandingPage,
});

function SeedLandingPage() {
	const { billingState } = Route.useRouteContext();
	return <SeedLandingScreen billingState={billingState} />;
}
