/**
 * /playlists/new/studio — beat 2, the studio.
 *
 * The seed chosen on the entrance arrives in router history state (studioSeed.ts)
 * and initializes the draft — it stays out of the URL, which reads a clean
 * /playlists/new/studio. Landing cold (no state, e.g. a refresh or deep link) is
 * the legitimate "from scratch" open. The intent gate is ensured by the parent
 * layout.
 *
 * The loader starts the draft preview under the exact query key the draft hook
 * mounts with (seed config, no pins yet — artist resolution is async, so the
 * hook's first key always has pinnedSongIds: []). It deliberately does not await
 * that query: the studio shell can render immediately, while the router's Query
 * SSR integration dehydrates the pending query and streams its result into the
 * client cache. The screen's useQuery owns loading, retry, and error states.
 */

import { createFileRoute, useLocation } from "@tanstack/react-router";
import { intentEligibilityQueryOptions } from "@/features/playlists/create/intentEligibility";
import {
	DEFAULT_DRAFT_CONFIG,
	playlistDraftPreviewQueryOptions,
} from "@/features/playlists/create/queries";
import { StudioScreen } from "@/features/playlists/create/StudioScreen";
import {
	type StudioSeed,
	studioSeedToDraftInit,
} from "@/features/playlists/create/studioSeed";

const EMPTY_SEED: StudioSeed = {};

export const Route = createFileRoute("/_authenticated/playlists/new/studio")({
	loader: async ({ context, location }) => {
		const seed = location.state.studioSeed ?? EMPTY_SEED;
		// Parent and child loaders run in parallel. This duplicate ensure is deduped
		// by Query, while keeping the child correct when its loader runs in isolation.
		const gatePromise = context.queryClient
			.ensureQueryData(intentEligibilityQueryOptions())
			.catch(() => null);

		// A seeded intent is the only preview input that depends on eligibility.
		// Keep that case serial so untrusted history state cannot bypass the gate;
		// every other seed can start its preview immediately.
		const gate = seed.intent === undefined ? null : await gatePromise;
		const init = studioSeedToDraftInit(seed, gate?.allowed ?? false);
		void context.queryClient.prefetchQuery(
			playlistDraftPreviewQueryOptions({
				...DEFAULT_DRAFT_CONFIG,
				intent: init.intent,
				genrePills: init.genrePills ?? DEFAULT_DRAFT_CONFIG.genrePills,
				matchFilters: init.matchFilters ?? DEFAULT_DRAFT_CONFIG.matchFilters,
			}),
		);
	},
	component: StudioPage,
});

function StudioPage() {
	const { session, billingState, account } = Route.useRouteContext();
	// Stable ref: history state doesn't change under a mounted studio, and the
	// EMPTY_SEED fallback is a module constant, so re-seeding is a fresh mount
	// rather than a mid-life prop change.
	const seed = useLocation({ select: (l) => l.state.studioSeed }) ?? EMPTY_SEED;
	return (
		<StudioScreen
			accountId={session.accountId}
			billingState={billingState}
			seed={seed}
			// Same account.spotify_id Dashboard.tsx threads for its own mismatch
			// protection (see useSpotifyGate.ts) — required so the gate can
			// actually detect a mismatched extension account instead of silently
			// short-circuiting to "ok".
			linkedSpotifyId={account?.spotify_id ?? null}
			accountDisplayName={account?.display_name ?? null}
		/>
	);
}
