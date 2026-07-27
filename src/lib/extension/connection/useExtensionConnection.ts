/**
 * Thin selector over the shared connection query — consumers read a verdict,
 * not raw fields, so the ordering rules in verdict.ts stay the single source
 * of truth across every surface (dashboard, studio gate, liked
 * songs/matching, onboarding, settings).
 */

import { useQuery } from "@tanstack/react-query";
import { useAuthFailedAt } from "./auth-failed-store";
import {
	type ExtensionConnection,
	extensionConnectionQueryOptions,
} from "./connection-state";
import { setUnreachableAt, useUnreachableAt } from "./unreachable-store";
import { type ConnectionVerdict, deriveConnectionVerdict } from "./verdict";

export interface UseExtensionConnectionResult {
	connection: ExtensionConnection | undefined;
	verdict: ConnectionVerdict;
	/** Re-run the check now instead of waiting out the poll interval (e.g.
	 * right after repair, or a "check again" affordance). Also clears a sticky
	 * `reportExtensionUnreachable` override — see the inline comment below. */
	refetch: () => Promise<unknown>;
}

export function useExtensionConnection(
	linkedSpotifyId: string | null,
): UseExtensionConnectionResult {
	const query = useQuery(extensionConnectionQueryOptions());
	// authFailedAt/unreachableAt are merged in here, not read off `query.data`
	// — they live in their own stores precisely so the poll can never clobber
	// them (see auth-failed-store.ts / unreachable-store.ts). This is the one
	// place all three are combined into the public `ExtensionConnection` shape
	// every consumer expects.
	const authFailedAt = useAuthFailedAt();
	const unreachableAt = useUnreachableAt();
	const connection: ExtensionConnection | undefined = query.data && {
		...query.data,
		// A first-hand "didn't answer" observation outranks whatever the poll's
		// own installed/spotifyConnected fields say, for as long as it's sticky
		// — mirrors how authFailedAt outranks spotifyConnected per invariant 7.
		installed: unreachableAt !== null ? false : query.data.installed,
		spotifyConnected:
			unreachableAt !== null ? false : query.data.spotifyConnected,
		authFailedAt,
	};
	return {
		connection,
		verdict: deriveConnectionVerdict(connection, linkedSpotifyId),
		refetch: () => {
			// Clears the sticky "unreachable" override right before asking for
			// fresh evidence — mirrors repair.ts clearing authFailedAt right
			// before opening the Spotify login popup: a deliberate,
			// consumer-triggered recheck (e.g. the studio's "Check again") is
			// exactly the "next observation" this flag should defer to. Unlike
			// authFailedAt (kept sticky against confirming refetches by
			// invariant 7 — the extension's local hasToken check can't disprove
			// a Spotify-side rejection), a PING re-check has no such blind spot:
			// it's exactly as trustworthy as the one that originally failed, so
			// there's no reason to keep distrusting it once someone explicitly
			// asks again. `refetch()` defaults to `cancelRefetch: true`, so this
			// always starts a brand-new fetch (never reuses one that began
			// before the clear) — it can't reopen the lost-update race
			// unreachable-store.ts exists to prevent, which is specifically
			// about the AMBIENT background poll's in-flight fetch, not an
			// explicit, consumer-triggered one.
			setUnreachableAt(null);
			return query.refetch();
		},
	};
}
