import { useCallback, useEffect, useReducer, useState } from "react";
import {
	type ExtensionSpotifyProfile,
	getSpotifyAccountStatus,
	isExtensionInstalled,
} from "./detect";

const CONFLICT_POLL_MS = 6_000;

export type ExtensionAccountConflict =
	| { kind: "spotify-mismatch"; extensionProfile: ExtensionSpotifyProfile }
	| { kind: "unpaired" };

export type ExtensionAccountCheck =
	| { kind: "not-required" }
	| { kind: "checking" }
	| { kind: "verified" }
	| { kind: "unavailable" }
	| { kind: "conflict"; conflict: ExtensionAccountConflict };

export interface ExtensionAccountConflictResult {
	check: ExtensionAccountCheck;
	/** Re-run the check immediately (e.g. right after re-pairing) instead of
	 * waiting out the poll interval. */
	recheck: () => void;
}

/**
 * Watches the extension for the two account-identity conflicts worth surfacing
 * proactively instead of letting a sync fail after uploading a whole library:
 *  - the browser's Spotify session belongs to a different account than the one
 *    this hearted library is linked to (the backend rejects that upload), and
 *  - the extension lost its hearted pairing (e.g. popup-side disconnect).
 *
 * Scoped to accounts that have already linked Spotify (`linkedSpotifyId` set):
 * before first sync, onboarding owns the connect UX and a banner is noise.
 * Mismatch outranks unpaired — pairing is silently repairable, the wrong
 * Spotify session is not.
 */
export function useExtensionAccountConflict(
	linkedSpotifyId: string | null,
): ExtensionAccountConflictResult {
	const [check, setCheck] = useState<ExtensionAccountCheck>(() =>
		linkedSpotifyId === null ? { kind: "not-required" } : { kind: "checking" },
	);
	const [checkNonce, recheck] = useReducer((n: number) => n + 1, 0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: checkNonce isn't read in the body — its presence is what re-runs the check on demand when recheck() fires (e.g. right after re-pairing).
	useEffect(() => {
		if (linkedSpotifyId === null) {
			setCheck({ kind: "not-required" });
			return;
		}

		setCheck({ kind: "checking" });
		let cancelled = false;
		const runCheck = async () => {
			const installed = await isExtensionInstalled();
			if (cancelled) return;
			if (!installed) {
				setCheck({ kind: "unavailable" });
				return;
			}
			const status = await getSpotifyAccountStatus();
			if (cancelled) return;
			if (status === null) {
				setCheck({ kind: "unavailable" });
				return;
			}
			if (status.profile && status.profile.spotifyId !== linkedSpotifyId) {
				setCheck({
					kind: "conflict",
					conflict: {
						kind: "spotify-mismatch",
						extensionProfile: status.profile,
					},
				});
				return;
			}
			if (status.paired === false) {
				setCheck({ kind: "conflict", conflict: { kind: "unpaired" } });
				return;
			}
			if (status.paired !== true || status.profile === null) {
				setCheck({ kind: "unavailable" });
				return;
			}
			setCheck({ kind: "verified" });
		};

		void runCheck();
		const id = setInterval(() => void runCheck(), CONFLICT_POLL_MS);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [linkedSpotifyId, checkNonce]);

	return { check, recheck: useCallback(() => recheck(), []) };
}
