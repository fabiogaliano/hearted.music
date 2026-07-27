/**
 * Sticky "extension unreachable" flag, kept OUTSIDE the polled connection
 * query. Mirrors auth-failed-store.ts's rationale exactly (see that file's
 * header for the full lost-update trace) but protects
 * `reportExtensionUnreachable`'s first-hand "the extension didn't answer"
 * observation instead of a live Spotify auth failure.
 *
 * Before this store existed, `reportExtensionUnreachable` wrote
 * `installed: false, spotifyConnected: false` directly onto the polled
 * `['extension','connection']` cache entry via `setQueryData`. That merge is
 * exactly the lost-update shape phase 01 eliminated for `authFailedAt`: if
 * the shared query's own background poll had a fetch already in flight when
 * the push landed, that fetch's eventual resolution REPLACES the whole cache
 * entry wholesale (TanStack Query commits a fetcher's return value verbatim,
 * it does not merge onto whatever `setQueryData` wrote in the meantime) —
 * silently erasing the forced `extension-unavailable` back to whatever
 * "healthy" data the stale, pre-push fetch produced. Moving the flag out of
 * the polled payload removes the race structurally, exactly like
 * auth-failed-store.ts: the poll's queryFn can only ever replace the
 * `extension`/`connection` cache entry, never this store, so there is no
 * shared mutable state left for the two writers to race over.
 *
 * Unlike `authFailedAt`, this flag CAN be cleared by an explicit, consumer-
 * triggered `refetch()` (see `useExtensionConnection.ts`) rather than only by
 * a narrow "known-good" event. That asymmetry is deliberate, not an
 * oversight: invariant 7 keeps `authFailedAt` sticky against confirming
 * refetches because the extension's local `hasToken` check is structurally
 * blind to a Spotify-side rejection (a dead token still reads "valid"
 * locally, forever) — no ordinary refetch can ever produce trustworthy
 * counter-evidence. A PING re-check has no such blind spot: it either answers
 * or it doesn't, so a fresh, explicitly-requested PING is exactly as
 * trustworthy as the one that originally failed.
 *
 * Browser-only, like auth-failed-store.ts: a module-level mutable singleton
 * would leak across requests in TanStack Start's long-lived SSR process if
 * ever written server-side. Unreachable server-side today (every caller is a
 * browser event handler); the guard below is defensive in case that changes.
 */

import { useSyncExternalStore } from "react";

let unreachableAt: number | null = null;
const listeners = new Set<() => void>();

export function getUnreachableAt(): number | null {
	return unreachableAt;
}

export function setUnreachableAt(value: number | null): void {
	// See file header: never let an SSR-side call mutate the shared singleton.
	if (typeof window === "undefined") return;
	if (value === unreachableAt) return;
	unreachableAt = value;
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useUnreachableAt(): number | null {
	return useSyncExternalStore(subscribe, getUnreachableAt, () => null);
}

/** Test-only: the store is a module-level singleton by design (production
 * code never needs to reset it), so tests that push a failure must reset it
 * themselves to avoid bleeding into the next test in the same file. */
export function resetUnreachableAtForTests(): void {
	unreachableAt = null;
}
