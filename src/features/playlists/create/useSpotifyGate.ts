/**
 * useSpotifyGate — owns the Spotify create-gate lifecycle for the playlist
 * creation screen.
 *
 * Resolves the gate on mount (extension installed → Spotify connected) and,
 * crucially, keeps re-checking while unhealthy: a user who installs the
 * extension or reconnects Spotify in another tab and returns should recover
 * without a manual page reload. Re-checks fire on window focus and tab
 * visibility (coalesced with a short debounce, since a single return to the
 * tab often fires both), and stop entirely once the gate is `ok` so a healthy
 * session never PINGs the extension again.
 *
 * A monotonic request id guards against overlapping re-checks resolving out of
 * order: only the newest run may write state. Unmount bumps the same id so an
 * in-flight check can't setState after teardown. The gate never downgrades an
 * existing `ok` to `checking`, so the CTA never flickers on a re-check.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
	getSpotifyConnectionStatus,
	isExtensionInstalled,
} from "@/lib/extension/detect";

export type SpotifyGateState =
	| "checking"
	| "ok"
	| "extension-unavailable"
	| "reconnect-required";

export type SpotifyGateFailure = "extension-unavailable" | "reconnect-required";

// A single return to the tab often dispatches `focus` and `visibilitychange`
// back to back; collapse them into one PING pair.
const RECHECK_DEBOUNCE_MS = 200;

export interface SpotifyGate {
	gateState: SpotifyGateState;
	/** Re-run the gate detection now; resolves once the check settles. */
	recheck: () => Promise<void>;
	/**
	 * Force a failure state observed first-hand by a create attempt (the gate
	 * was `ok` at submit but auth expired mid-flight, or the extension went
	 * away). Invalidates any in-flight background check so it can't overwrite it.
	 */
	reportGateFailure: (failure: SpotifyGateFailure) => void;
}

export function useSpotifyGate(): SpotifyGate {
	const [gateState, setGateState] = useState<SpotifyGateState>("checking");
	const requestIdRef = useRef(0);

	const runCheck = useCallback(async () => {
		const requestId = ++requestIdRef.current;
		const installed = await isExtensionInstalled();
		if (requestId !== requestIdRef.current) return;
		if (!installed) {
			setGateState("extension-unavailable");
			return;
		}
		const connected = await getSpotifyConnectionStatus();
		if (requestId !== requestIdRef.current) return;
		setGateState(connected ? "ok" : "reconnect-required");
	}, []);

	useEffect(() => {
		void runCheck();
		return () => {
			// Invalidate any in-flight check so a late resolution can't write state
			// after the screen unmounts.
			requestIdRef.current++;
		};
	}, [runCheck]);

	useEffect(() => {
		if (gateState === "ok") return;

		let debounce: ReturnType<typeof setTimeout> | null = null;
		const scheduleRecheck = () => {
			if (debounce) clearTimeout(debounce);
			debounce = setTimeout(() => {
				debounce = null;
				void runCheck();
			}, RECHECK_DEBOUNCE_MS);
		};
		const onFocus = () => scheduleRecheck();
		const onVisibility = () => {
			if (document.visibilityState === "visible") scheduleRecheck();
		};

		window.addEventListener("focus", onFocus);
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			if (debounce) clearTimeout(debounce);
			window.removeEventListener("focus", onFocus);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [gateState, runCheck]);

	const reportGateFailure = useCallback((failure: SpotifyGateFailure) => {
		requestIdRef.current++;
		setGateState(failure);
	}, []);

	return { gateState, recheck: runCheck, reportGateFailure };
}
