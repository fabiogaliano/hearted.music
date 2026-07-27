/**
 * Pure derivation from `ExtensionConnection` to the UI-facing verdict. Kept
 * free of React/Query so the ordering rules are trivially unit-testable.
 * Ordering carried over from useExtensionAccountConflict.ts (see README
 * invariants 2, 3, 6, 7 for why each rule outranks the next).
 */

import type { ExtensionSpotifyProfile } from "../detect";
import type { ExtensionConnection } from "./connection-state";

export type ConnectionVerdict =
	| { kind: "checking" }
	| { kind: "extension-missing" }
	| { kind: "spotify-disconnected" }
	| { kind: "mismatch"; extensionProfile: ExtensionSpotifyProfile }
	| { kind: "unpaired" }
	| { kind: "unverifiable" }
	| { kind: "ok" };

export function deriveConnectionVerdict(
	connection: ExtensionConnection | undefined,
	linkedSpotifyId: string | null,
): ConnectionVerdict {
	if (connection === undefined) return { kind: "checking" };
	if (!connection.installed) return { kind: "extension-missing" };
	// A live command failure beats the poll's local-expiry check (invariant 7).
	if (!connection.spotifyConnected || connection.authFailedAt !== null) {
		return { kind: "spotify-disconnected" };
	}
	// Identity check isn't required pre-link; must sit after the two checks
	// above so callers passing `null` (e.g. the studio gate) still get
	// extension-missing/spotify-disconnected instead of a blanket "ok".
	if (linkedSpotifyId === null) return { kind: "ok" };
	if (connection.profile && connection.profile.spotifyId !== linkedSpotifyId) {
		// Mismatch outranks unpaired (invariant 2): pairing is silently
		// repairable, a wrong Spotify session is not.
		return { kind: "mismatch", extensionProfile: connection.profile };
	}
	if (connection.paired === false) return { kind: "unpaired" };
	// paired === null (old extension) or profile === null (hiccup) is
	// "unverifiable", never conflated with the explicit unpaired disconnect
	// (invariant 6).
	if (connection.paired !== true || connection.profile === null) {
		return { kind: "unverifiable" };
	}
	return { kind: "ok" };
}
