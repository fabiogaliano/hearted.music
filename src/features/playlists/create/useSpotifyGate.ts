/**
 * useSpotifyGate — owns the Spotify create-gate lifecycle for the playlist
 * creation screen.
 *
 * Thin selector over the shared connection state (see
 * docs/plans/extension-connection-service/04-studio-gate.md): all detection —
 * PING/SPOTIFY_STATUS, polling cadence, window-focus re-checks — lives in
 * `useExtensionConnection` / the shared `['extension','connection']` query
 * now. This hook only maps that verdict onto the gate's own vocabulary and
 * forwards `refetch`/push calls under its existing public contract, so
 * `StudioScreen`/`CreateBar`/the prompts don't change beyond the mismatch
 * addition below.
 *
 * `linkedSpotifyId` is threaded through from the caller (the studio route's
 * `account.spotify_id`, same field Dashboard.tsx already uses for its own
 * mismatch protection) — see the deviation log for why the original plan's
 * "pass null, the gate doesn't do identity checks" was wrong: with
 * `linkedSpotifyId === null`, `deriveConnectionVerdict` short-circuits to
 * `ok` as soon as the extension is installed+connected, silently skipping the
 * mismatch/unpaired/unverifiable checks entirely. That meant a studio submit
 * with the browser extension signed into a DIFFERENT Spotify account than the
 * one hearted has linked would sail through the gate as "ok", create the
 * playlist on Spotify under whichever account the extension's live token
 * belongs to, and then fail the follow-up DB-side rootlist add for the
 * intended account — an orphaned playlist on the wrong Spotify account, with
 * no DB trace.
 *
 * Anti-flicker (README invariant 4): a settled `ok` must never downgrade to
 * `checking` on a background re-check. This falls out of TanStack Query for
 * free, not from anything bespoke here — `query.data` stays populated with
 * the previous result for the whole duration of a refetch, so `verdict`
 * (derived from `data`, never from `isFetching`) only changes when a *new*
 * result actually lands. Reading `query.isFetching` anywhere in this
 * selector would reintroduce the flicker; don't add it.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
	reportExtensionUnreachable,
	reportSpotifyAuthFailure,
} from "@/lib/extension/connection/report-failure";
import { useExtensionConnection } from "@/lib/extension/connection/useExtensionConnection";
import type { ConnectionVerdict } from "@/lib/extension/connection/verdict";
import type { ExtensionSpotifyProfile } from "@/lib/extension/detect";

/**
 * A discriminated union, not a bare state string + a separately-nullable
 * profile: the old shape let `gateState === "account-mismatch"` and
 * `mismatchProfile === null` co-occur in a caller's types even though
 * gateStatusForVerdict below never actually produces that pairing, so
 * CreateBar had to carry a runtime fallback for an "impossible" case that
 * fallback then got wrong (it re-paired via ReconnectPrompt — see invariant
 * 2). Tying `mismatchProfile` to the `"account-mismatch"` arm here makes that
 * pairing the only one the type checker allows, so CreateBar can't
 * accidentally reach the profile without also being in that state.
 */
export type SpotifyGateStatus =
	| { gateState: "checking" }
	| { gateState: "ok" }
	| { gateState: "extension-unavailable" }
	| { gateState: "reconnect-required" }
	| {
			gateState: "account-mismatch";
			/** The Spotify identity the extension is actually signed in as, for
			 * the "wrong account" copy. */
			mismatchProfile: ExtensionSpotifyProfile;
	  };

export type SpotifyGateFailure = "extension-unavailable" | "reconnect-required";

export interface SpotifyGate {
	gate: SpotifyGateStatus;
	/** Re-run the gate detection now; resolves once the check settles. */
	recheck: () => Promise<void>;
	/**
	 * Force a failure state observed first-hand by a create attempt (the gate
	 * was `ok` at submit but auth expired mid-flight, or the extension went
	 * away). Pushes synchronously into the shared connection state — the
	 * whole app learns, not just this screen — instead of merely invalidating,
	 * which would leave the gate rendering stale `ok` off cached data until
	 * the next fetch lands (defeating the point of a first-hand report).
	 * `reconnect-required` is also the case invariant 7 exists for: the gate
	 * was `ok` at submit and auth died mid-flight, so the extension's local
	 * `hasToken` check is precisely what lied — without the sticky
	 * `authFailedAt` this pushes into, the next poll would re-report
	 * `hasToken: true` and the gate would snap back to `ok` with the publish
	 * still broken.
	 *
	 * There is deliberately no "account-mismatch" failure kind here: a
	 * mismatch is derived purely from the connection verdict (comparing the
	 * extension's live profile against `linkedSpotifyId`), never observed as a
	 * command failure mid-flight, so there's nothing for a create attempt to
	 * report first-hand.
	 */
	reportGateFailure: (failure: SpotifyGateFailure) => void;
}

function gateStatusForVerdict(verdict: ConnectionVerdict): SpotifyGateStatus {
	switch (verdict.kind) {
		case "checking":
			return { gateState: "checking" };
		case "extension-missing":
			return { gateState: "extension-unavailable" };
		case "spotify-disconnected":
			return { gateState: "reconnect-required" };
		case "mismatch":
			// Invariant 2: mismatch outranks unpaired, and — unlike unpaired,
			// which the studio can safely ignore (see the case below) — a
			// mismatch is not silently repairable and must block publishing.
			return {
				gateState: "account-mismatch",
				mismatchProfile: verdict.extensionProfile,
			};
		case "unpaired":
		case "unverifiable":
			// Both are pairing-adjacent states (the hearted apiToken, not the
			// Spotify session) and pairing only gates extension→backend sync
			// upload, never the extension→Spotify commands the studio issues —
			// server-function DB writes ride the app session cookie, not the
			// pairing (see README's "Server-function DB writes... ride the app
			// session, not the pairing"). Neither blocks the studio from
			// correctly publishing to the RIGHT Spotify account, so both stay
			// "ok" here even though they're now genuinely reachable verdicts
			// (with a real linkedSpotifyId threaded in, unlike before).
			return { gateState: "ok" };
		case "ok":
			return { gateState: "ok" };
		default:
			verdict satisfies never;
			return { gateState: "ok" };
	}
}

export function useSpotifyGate(linkedSpotifyId: string | null): SpotifyGate {
	const queryClient = useQueryClient();
	const { verdict, refetch } = useExtensionConnection(linkedSpotifyId);

	// Query serializes fetches itself (no overlapping-request race to guard
	// against the way the old hand-rolled requestId did), so `recheck` is just
	// a thin wrapper adapting `refetch`'s `Promise<unknown>` back to the
	// gate's existing `Promise<void>` contract.
	const recheck = useCallback(async () => {
		await refetch();
	}, [refetch]);

	const reportGateFailure = useCallback(
		(failure: SpotifyGateFailure) => {
			if (failure === "reconnect-required") {
				reportSpotifyAuthFailure(queryClient);
			} else {
				reportExtensionUnreachable(queryClient);
			}
		},
		[queryClient],
	);

	return {
		gate: gateStatusForVerdict(verdict),
		recheck,
		reportGateFailure,
	};
}
