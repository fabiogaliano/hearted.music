/**
 * Sticky auth-failure flag, kept OUTSIDE the polled connection query.
 *
 * Why not a field the poll fetcher merges in (the original design): TanStack
 * Query replaces a query's entire cache entry with whatever its queryFn
 * resolves to. The original fetcher read the previous cache entry
 * synchronously at fetch start, awaited two extension round-trips, then
 * merged that snapshot back in. Any `reportSpotifyAuthFailure` push landing
 * in that window wrote to the same cache entry, then got silently
 * overwritten when the in-flight fetch resolved with its stale pre-push
 * snapshot — a lost update (README invariant 7 / Risks: "the reconnect
 * prompt never survives long enough to click").
 *
 * Keeping the flag in a store the poll never writes to makes that race
 * structurally impossible: the poll's queryFn can only ever replace the
 * `['extension','connection']` cache entry, never this one, so there is no
 * shared mutable state for the two writers to race over.
 *
 * Browser-only, like connection-state.ts: this is a module-level mutable
 * singleton. TanStack Start's SSR runs in a long-lived server process, so a
 * write here during SSR would leak one request's Spotify auth-failure state
 * into every other concurrent request's render. Never call `setAuthFailedAt`
 * (directly or via report-failure.ts) from a route loader or server
 * function. Unreachable server-side today — every caller is a browser event
 * handler and `useAuthFailedAt`'s `getServerSnapshot` is hardcoded to
 * `null` — so this is a forward trap, not a live bug; the guard below is
 * defensive in case that ever changes.
 */

import { useSyncExternalStore } from "react";

let authFailedAt: number | null = null;
const listeners = new Set<() => void>();

export function getAuthFailedAt(): number | null {
	return authFailedAt;
}

export function setAuthFailedAt(value: number | null): void {
	// See file header: never let an SSR-side call mutate the shared singleton.
	if (typeof window === "undefined") return;
	if (value === authFailedAt) return;
	authFailedAt = value;
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useAuthFailedAt(): number | null {
	return useSyncExternalStore(subscribe, getAuthFailedAt, () => null);
}

/** Test-only: the store is a module-level singleton by design (production
 * code never needs to reset it), so tests that push a failure must reset it
 * themselves to avoid bleeding into the next test in the same file. */
export function resetAuthFailedAtForTests(): void {
	authFailedAt = null;
}
