/**
 * Shared extension-connection query — the one place that answers "can this
 * app talk to Spotify right now, as the right person?" (see
 * docs/plans/extension-connection-service/README.md). Replaces the five
 * private pollers that each saw only a slice of this picture.
 *
 * Browser-only: `sendExtensionCommand` (via detect.ts) resolves `null` under
 * SSR, so this must never be prefetched from a route loader — that would seed
 * the cache with a false "extension missing" read.
 */

import { queryOptions } from "@tanstack/react-query";
import {
	type ExtensionSpotifyProfile,
	getSpotifyAccountStatus,
	isExtensionInstalled,
} from "../detect";
import { getAuthFailedAt } from "./auth-failed-store";

export interface ExtensionConnection {
	/** PING answered. */
	installed: boolean;
	/** Usable (non-anonymous, unexpired) Spotify token captured. */
	spotifyConnected: boolean;
	/** hearted apiToken present. null = extension predates the field (unknown). */
	paired: boolean | null;
	/** Spotify identity captured by the extension. null when unavailable. */
	profile: ExtensionSpotifyProfile | null;
	/** Set when a live Spotify command came back AUTH_REQUIRED/TOKEN_EXPIRED.
	 * Outranks `spotifyConnected` — see invariant 7. Sourced from
	 * `auth-failed-store.ts`, not the poll (see that file for why) — merged in
	 * by `useExtensionConnection`, never present on the raw polled cache entry. */
	authFailedAt: number | null;
}

/** The shape the poll itself produces and stores under `extensionConnectionKey`.
 * Deliberately excludes `authFailedAt`: the poll must never be able to write
 * that field, or the lost-update race documented in auth-failed-store.ts comes
 * back. `useExtensionConnection` merges this with the store to build the
 * public `ExtensionConnection`. */
export type PolledConnection = Omit<ExtensionConnection, "authFailedAt">;

export const extensionConnectionKey = ["extension", "connection"] as const;

const NOT_INSTALLED: PolledConnection = {
	installed: false,
	spotifyConnected: false,
	paired: null,
	profile: null,
};

// A PING that answers but a SPOTIFY_STATUS that doesn't is still an installed
// extension (older build, or a background hiccup) — never the "missing"
// shape, or every surface would show an incorrect "Install extension" CTA
// to someone who already has it (invariant 6).
const INSTALLED_BUT_UNANSWERING: PolledConnection = {
	installed: true,
	spotifyConnected: false,
	paired: null,
	profile: null,
};

// Poll only while unhealthy — a healthy connection leans on
// refetchOnWindowFocus plus the failure push instead of polling forever
// (see README Risks: "Always-on polling replaces today's 'stop once
// healthy' optimization").
const UNHEALTHY_REFETCH_INTERVAL_MS = 6_000;
const STALE_TIME_MS = 3_000;

function isHealthy(
	connection: PolledConnection,
	authFailedAt: number | null,
): boolean {
	return (
		connection.installed && connection.spotifyConnected && authFailedAt === null
	);
}

// No `previous`/merge step here on purpose — see auth-failed-store.ts. The
// fetcher is a plain, stateless read: nothing it returns depends on anything
// written concurrently, so there is nothing for a concurrent write to race.
export async function fetchExtensionConnection(): Promise<PolledConnection> {
	const installed = await isExtensionInstalled();
	if (!installed) return NOT_INSTALLED;

	const status = await getSpotifyAccountStatus();
	if (status === null) return INSTALLED_BUT_UNANSWERING;

	return {
		installed: true,
		spotifyConnected: status.connected,
		paired: status.paired,
		profile: status.profile,
	};
}

export function extensionConnectionQueryOptions() {
	return queryOptions({
		queryKey: extensionConnectionKey,
		queryFn: fetchExtensionConnection,
		staleTime: STALE_TIME_MS,
		refetchOnWindowFocus: true,
		refetchInterval: (query) => {
			const data = query.state.data;
			if (!data) return UNHEALTHY_REFETCH_INTERVAL_MS;
			// Reads the sticky flag straight from its own store (not from `data`,
			// which structurally cannot carry it) so a pushed failure keeps the
			// interval alive even when the poll's own fields still look healthy.
			return isHealthy(data, getAuthFailedAt())
				? false
				: UNHEALTHY_REFETCH_INTERVAL_MS;
		},
	});
}
