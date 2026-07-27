/**
 * The one repair gesture every reconnect affordance calls. Does whatever the
 * current verdict needs in a single synchronous call so `window.open` stays
 * inside the click gesture (see README invariant 1) — repair branches on the
 * already-known verdict instead of re-checking first, because awaiting a
 * status re-check before opening Spotify would spend the gesture and get the
 * popup blocked.
 */

import type { QueryClient } from "@tanstack/react-query";
import { pairExtension } from "../connect";
import { expectLoginReturn } from "../detect";
import { buildArmedSpotifyUrl } from "../reconnect-link";
import { setAuthFailedAt } from "./auth-failed-store";
import { extensionConnectionKey } from "./connection-state";
import type { ConnectionVerdict } from "./verdict";

export interface RepairConnectionInput {
	verdict: ConnectionVerdict;
	queryClient: QueryClient;
	/** Spotify login URL to arm. Callers pass their surface's URL (dashboard
	 * uses the accounts.spotify.com login wrapper; inline links use
	 * open.spotify.com — both flow through buildArmedSpotifyUrl). */
	spotifyLoginUrl: string;
}

/**
 * Returns the in-flight pairing promise (already resolved when no pairing was
 * needed) so callers can drive a pending affordance — task 03's banner keeps
 * its `repairing` disabled state off this return value instead of dropping it
 * the way a `void` return would. The function body itself is synchronous: it
 * never `await`s before opening Spotify, it only ever returns a promise that
 * something else settles.
 */
export function repairConnection({
	verdict,
	queryClient,
	spotifyLoginUrl,
}: RepairConnectionInput): Promise<void> {
	// mismatch's fix is "sign in as the right account"; the caveat that this
	// login URL alone can't force a *different* account (browser session still
	// wins) is inherited, not solved here — see 02-repair-action.md.
	const needsSpotifyLogin =
		verdict.kind === "spotify-disconnected" || verdict.kind === "mismatch";
	if (needsSpotifyLogin) {
		const armToken = crypto.randomUUID();
		void expectLoginReturn(armToken).catch(() => {});
		window.open(
			buildArmedSpotifyUrl(spotifyLoginUrl, armToken),
			"_blank",
			"noopener,noreferrer",
		);
		// The user is acting on the prompt right now; leaving the sticky flag
		// set would pin the verdict at spotify-disconnected forever even after a
		// successful re-login (README Risks: "a stale sticky failure that never
		// clears").
		setAuthFailedAt(null);
	}

	// Silent re-pair: harmless if already paired (just re-mints), and exactly
	// what heals the fresh-install case where both credentials are empty.
	// Deliberately excludes `mismatch` — pairing can't fix a wrong Spotify
	// identity, only the login step above can (invariant 2).
	const needsPairing =
		verdict.kind === "unpaired" ||
		verdict.kind === "spotify-disconnected" ||
		verdict.kind === "unverifiable";
	if (needsPairing) {
		return pairExtension()
			.finally(() => {
				queryClient.invalidateQueries({ queryKey: extensionConnectionKey });
			})
			.then(() => undefined);
	}

	return Promise.resolve();
}
