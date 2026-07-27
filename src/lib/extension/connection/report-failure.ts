/**
 * The push channel: any surface that observes a live Spotify command fail or
 * succeed writes straight into the shared connection state instead of
 * waiting for the next poll tick.
 *
 * `reportSpotifyAuthFailure` also invalidates the connection query, which
 * used to be forbidden (README invariant 7 / Risks): the old design kept
 * `authFailedAt` inside the polled cache entry, so a confirming refetch would
 * read `hasToken` from the extension's local, Spotify-unaware validity check,
 * flip `spotifyConnected` back, and erase the sticky flag within ~200ms —
 * before the user could click the prompt. `authFailedAt` now lives entirely
 * in its own store (auth-failed-store.ts), which the poll's queryFn never
 * touches, so a confirming refetch can no longer erase it — it only ever
 * refreshes `spotifyConnected`/`paired`/`profile`, and the verdict already
 * ignores `spotifyConnected` once `authFailedAt` is set (verdict.ts rule 3 is
 * an OR). The invalidate is also what resumes polling when the query was
 * idle-and-healthy (`refetchInterval: false`) at the moment the push lands:
 * `invalidateQueries` dispatches an `invalidate` event synchronously, and
 * every subscribed QueryObserver reacts by recomputing and rearming
 * `refetchInterval` unconditionally (query-core's `onQueryUpdate` calls
 * `#updateTimers()` for every dispatch, not just successful fetches). Do not
 * delete this call to "simplify" the function — without it, a push landing
 * while the query is idle-and-healthy never resumes the poll, silently
 * reintroducing the bug this whole module exists to prevent (see
 * connection-state.test.ts's "resumes an idle poll on a push" test).
 */

import type { QueryClient } from "@tanstack/react-query";
import { setAuthFailedAt } from "./auth-failed-store";
import {
	extensionConnectionKey,
	type PolledConnection,
} from "./connection-state";
import { setUnreachableAt } from "./unreachable-store";

export function reportSpotifyAuthFailure(queryClient: QueryClient): void {
	// The sticky flag write is unconditional — it lives in its own store (see
	// auth-failed-store.ts), so unlike the merge below it never needs a prior
	// cache entry to land on. This also resolves the phase-01 forward risk
	// noted in DECISIONS.md: a live command failing on a page that never
	// mounted the connection query no longer loses the push.
	setAuthFailedAt(Date.now());
	// Optimistic, best-effort: gives an instant `spotifyConnected: false` read
	// for any code that inspects the raw field (the verdict doesn't need this —
	// it already keys off `authFailedAt`, not this merge) while the invalidate
	// below is still in flight. A no-op without a prior cache entry.
	queryClient.setQueryData<PolledConnection>(
		extensionConnectionKey,
		(prev) => prev && { ...prev, spotifyConnected: false },
	);
	// Load-bearing — see module header: rearms `refetchInterval` for every
	// subscribed observer and refreshes paired/profile.
	queryClient.invalidateQueries({ queryKey: extensionConnectionKey });
}

/** Clears a sticky `authFailedAt` — call wherever a Spotify command returns
 * ok, so the flag can't outlive the problem it flagged. `queryClient` is
 * accepted (and unused) purely so this stays call-site-compatible with
 * `reportSpotifyAuthFailure`/`reportExtensionUnreachable` for tasks 02-06. */
export function reportSpotifyAuthSuccess(_queryClient: QueryClient): void {
	setAuthFailedAt(null);
}

/** First-hand "the extension didn't answer" observation (e.g. the studio
 * gate's PING failing outright). Writes synchronously so the surface doesn't
 * keep rendering a stale `installed: true` while an invalidate-triggered
 * refetch is still in flight.
 *
 * The sticky write goes to `unreachable-store.ts`, not the polled cache
 * entry — same reasoning as `reportSpotifyAuthFailure`'s `authFailedAt`
 * (see that store's header): a fetch already in flight when this push lands
 * would otherwise resolve afterward with stale "healthy" data and silently
 * clobber this observation, because TanStack Query replaces a query's cache
 * entry wholesale on fetch commit rather than merging onto it. The
 * `setQueryData` merge below is kept as a purely optimistic, non-load-bearing
 * cosmetic update (same pattern `reportSpotifyAuthFailure` uses for
 * `spotifyConnected`) — `useExtensionConnection` is what actually forces
 * `installed`/`spotifyConnected` false for as long as the store is sticky. */
export function reportExtensionUnreachable(queryClient: QueryClient): void {
	setUnreachableAt(Date.now());
	queryClient.setQueryData<PolledConnection>(
		extensionConnectionKey,
		(prev) => prev && { ...prev, installed: false, spotifyConnected: false },
	);
	// Load-bearing for the same reason as reportSpotifyAuthFailure's
	// invalidate (see this module's header): rearms `refetchInterval` for any
	// observer that was idle-and-healthy when this push landed. Safe to add
	// here for the same reason it's safe there — the sticky store write above
	// already makes the verdict correct synchronously (useExtensionConnection
	// reads it via useSyncExternalStore, not gated on any query state), so
	// this invalidate can only ever refresh cosmetic fields, never race away
	// the observation itself.
	queryClient.invalidateQueries({ queryKey: extensionConnectionKey });
}
