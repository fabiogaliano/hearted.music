/**
 * Dashboard sync orchestration.
 *
 * Drives the inline sync control through a single discriminated UI state so the
 * component never reasons about booleans. Mirrors the onboarding flow: the only
 * thing the user ever has to fix is the Spotify session (the Spotify token
 * expires; re-auth by opening Spotify so the extension recaptures it). The
 * hearted apiToken (CONNECT) never expires, so it's not a user-facing step —
 * pairExtension only runs silently if a sync is rejected for bad auth. Uses
 * GET_STATUS polling as the live progress truth; phase_job_ids is untouched.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { dashboardKeys } from "@/features/dashboard/queries";
import { pairExtension } from "@/lib/extension/connect";
import {
	type ExtensionSyncState,
	expectLoginReturn,
	getSpotifyConnectionStatus,
	isExtensionInstalled,
	requestExtensionSync,
} from "@/lib/extension/detect";
import { buildArmedSpotifyUrl } from "@/lib/extension/reconnect-link";
import { useExtensionSyncStatus } from "@/lib/extension/useExtensionSyncStatus";
import {
	EXTENSION_SYNC_ALREADY_RUNNING,
	EXTENSION_SYNC_COOLDOWN,
} from "../../../../shared/extension-sync-contract";

const EXTENSION_STORE_URL =
	"https://chromewebstore.google.com/detail/everything-you-ever-heart/ohaaafmgbbfohhjhogonolonpjhhfohk";

// Wrapped login URL so the token survives the accounts.spotify.com → open
// redirect, matching onboarding's InstallExtensionStep. buildArmedSpotifyUrl
// arms the eventual `continue` destination.
const SPOTIFY_LOGIN_URL =
	"https://accounts.spotify.com/en-GB/login?continue=https%3A%2F%2Fopen.spotify.com%2F";

const SUCCESS_LINGER_MS = 4_000;
const DETECT_POLL_MS = 4_000;
const ACTIVE_POLL_MS = 1_500;
const IDLE_POLL_MS = 6_000;

export type DashboardSyncUiState =
	| { kind: "checking" }
	| { kind: "install-required" }
	| { kind: "spotify-reconnect-required" }
	| { kind: "ready"; lastSyncAt: number | null }
	| { kind: "triggering" }
	| { kind: "syncing"; sync: ExtensionSyncState }
	| { kind: "cooldown"; retryAfterSeconds: number }
	| { kind: "already-running" }
	| {
			kind: "error";
			message: string;
			retryable: boolean;
			action: ErrorAction;
	  }
	| { kind: "success"; syncedAt: number };

/** Which recovery CTA an error should surface, by detected cause. */
export type ErrorAction = "retry" | "install";

// Internal control phase. The public UI state is *derived* from this plus live
// detection + extension sync state, so transient transitions (e.g. triggering
// before the extension reports "syncing") never leak a stale CTA.
type ControlPhase =
	| "idle"
	| "triggering"
	| "needs-spotify"
	| "cooldown"
	| "already-running"
	| "error"
	| "success";

export interface UseDashboardSyncResult {
	state: DashboardSyncUiState;
	/** Maps the current CTA to its action (install / reconnect Spotify / sync). */
	onAction: () => void;
}

export function useDashboardSync(accountId: string): UseDashboardSyncResult {
	const queryClient = useQueryClient();

	const [phase, setPhase] = useState<ControlPhase>("idle");
	const [extensionInstalled, setExtensionInstalled] = useState<boolean | null>(
		null,
	);
	const [spotifyConnected, setSpotifyConnected] = useState(false);
	const [errorState, setErrorState] = useState<{
		message: string;
		action: ErrorAction;
	}>({ message: "", action: "retry" });
	const [cooldownRemaining, setCooldownRemaining] = useState(0);
	const [syncedAt, setSyncedAt] = useState(0);
	const [statusPollMs, setStatusPollMs] = useState(IDLE_POLL_MS);

	const { sync } = useExtensionSyncStatus({
		enabled: extensionInstalled === true,
		pollMs: statusPollMs,
	});

	useEffect(() => {
		let cancelled = false;
		const check = async () => {
			const installed = await isExtensionInstalled();
			if (cancelled) return;
			setExtensionInstalled(installed);
			if (!installed) {
				setSpotifyConnected(false);
				return;
			}
			const connected = await getSpotifyConnectionStatus();
			if (!cancelled) setSpotifyConnected(connected);
		};
		void check();
		const id = setInterval(() => void check(), DETECT_POLL_MS);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, []);

	useEffect(() => {
		// Keep a low-frequency GET_STATUS poll alive while installed so the control
		// can reflect last-sync metadata even while idle, then raise the cadence
		// whenever a sync is actively running.
		const nextPollMs =
			phase === "triggering" || sync?.status === "syncing"
				? ACTIVE_POLL_MS
				: IDLE_POLL_MS;
		setStatusPollMs((current) =>
			current === nextPollMs ? current : nextPollMs,
		);
	}, [phase, sync?.status]);

	const invalidateDashboard = useCallback(() => {
		// Refresh the surfaces a sync can change. Fires once per completed sync
		// (from the awaited result), so there's no invalidation loop.
		queryClient.invalidateQueries({
			queryKey: dashboardKeys.pageData(accountId),
		});
		queryClient.invalidateQueries({ queryKey: dashboardKeys.stats(accountId) });
		queryClient.invalidateQueries({
			queryKey: dashboardKeys.recentActivity(accountId),
		});
		queryClient.invalidateQueries({
			queryKey: dashboardKeys.matchPreviews(accountId),
		});
	}, [queryClient, accountId]);

	const fail = useCallback((message: string, action: ErrorAction) => {
		setErrorState({ message, action });
		setPhase("error");
	}, []);

	const failSync = useCallback(
		async (message: string) => {
			// A dead Spotify session has no dedicated failure code, so check it
			// directly at failure time — the background SPOTIFY_STATUS poll lags and
			// would briefly mis-route. If Spotify is the cause, point there; a
			// generic Retry would just fail the same way. Otherwise offer Retry.
			const spotifyOk = await getSpotifyConnectionStatus();
			if (!spotifyOk) {
				setSpotifyConnected(false);
				setPhase("needs-spotify");
				return;
			}
			fail(message, "retry");
		},
		[fail],
	);

	const trigger = useCallback(async () => {
		setPhase("triggering");
		let result = await requestExtensionSync();

		// One silent re-pair + retry if the backend rejects our auth: the apiToken
		// (set during onboarding, normally permanent) may have been revoked or
		// cleared. pairExtension re-mints it; the Spotify session is untouched.
		if (
			result !== null &&
			!result.ok &&
			result.source === "backend" &&
			(result.backendFailure.status === 401 ||
				result.backendFailure.status === 403)
		) {
			const paired = await pairExtension();
			if (paired.ok) {
				result = await requestExtensionSync();
			}
		}

		if (result === null) {
			fail("We couldn't reach the extension. Try again.", "retry");
			return;
		}

		if (!result.ok) {
			if (result.source === "backend") {
				const { backendFailure } = result;
				if (
					backendFailure.status === 429 &&
					backendFailure.code === EXTENSION_SYNC_COOLDOWN &&
					backendFailure.retryAfterSeconds !== null
				) {
					setCooldownRemaining(backendFailure.retryAfterSeconds);
					setPhase("cooldown");
					return;
				}
				if (
					backendFailure.status === 429 &&
					backendFailure.code === EXTENSION_SYNC_ALREADY_RUNNING
				) {
					setPhase("already-running");
					return;
				}

				await failSync(
					backendFailure.message ??
						`Sync couldn't finish: backend HTTP ${backendFailure.status}`,
				);
				return;
			}

			await failSync(result.error);
			return;
		}

		setSyncedAt(Date.now());
		setPhase("success");
		invalidateDashboard();
	}, [fail, failSync, invalidateDashboard]);

	const reconnectSpotify = useCallback(() => {
		// The Spotify session expired — re-auth by opening Spotify so the extension
		// content script recaptures the token, exactly as onboarding's "log in to
		// Spotify" step does. Fire-and-open synchronously so the popup stays
		// attributed to this click.
		const armToken = crypto.randomUUID();
		void expectLoginReturn(armToken).catch(() => {});
		window.open(
			buildArmedSpotifyUrl(SPOTIFY_LOGIN_URL, armToken),
			"_blank",
			"noopener,noreferrer",
		);
	}, []);

	// Success lingers briefly, then settles back to the derived readiness state.
	useEffect(() => {
		if (phase !== "success") return;
		const timer = setTimeout(() => setPhase("idle"), SUCCESS_LINGER_MS);
		return () => clearTimeout(timer);
	}, [phase]);

	// Once Spotify reconnects (detected by the SPOTIFY_STATUS poll), drop the
	// needs-spotify lockout so the control settles back to ready/Sync.
	useEffect(() => {
		if (phase === "needs-spotify" && spotifyConnected) {
			setPhase("idle");
		}
	}, [phase, spotifyConnected]);

	// Cooldown counts down once per second, then returns to ready.
	useEffect(() => {
		if (phase !== "cooldown") return;
		if (cooldownRemaining <= 0) {
			setPhase("idle");
			return;
		}
		const timer = setTimeout(
			() => setCooldownRemaining((seconds) => seconds - 1),
			1_000,
		);
		return () => clearTimeout(timer);
	}, [phase, cooldownRemaining]);

	const sawLiveSyncWhileLockedRef = useRef(false);

	// When a sync reported elsewhere stops, drop the passive lockout state so the
	// control settles back to whatever the latest readiness state is. Keep the
	// passive lockout if we never observed live progress in this tab — that covers
	// an active-sync 429 caused by work running somewhere the extension can't
	// report.
	useEffect(() => {
		if (phase !== "already-running") {
			sawLiveSyncWhileLockedRef.current = false;
			return;
		}
		if (sync?.status === "syncing") {
			sawLiveSyncWhileLockedRef.current = true;
			return;
		}
		if (!sawLiveSyncWhileLockedRef.current) {
			return;
		}
		sawLiveSyncWhileLockedRef.current = false;
		setPhase("idle");
	}, [phase, sync]);

	const state = deriveState({
		phase,
		extensionInstalled,
		spotifyConnected,
		sync,
		errorState,
		cooldownRemaining,
		syncedAt,
	});

	const onAction = useCallback(() => {
		switch (state.kind) {
			case "install-required":
				window.open(EXTENSION_STORE_URL, "_blank", "noopener,noreferrer");
				break;
			case "spotify-reconnect-required":
				reconnectSpotify();
				break;
			case "ready":
				void trigger();
				break;
			case "error":
				if (state.action === "install") {
					window.open(EXTENSION_STORE_URL, "_blank", "noopener,noreferrer");
				} else {
					void trigger();
				}
				break;
			default:
				// checking / triggering / syncing / already-running / cooldown /
				// success are non-actionable status states.
				break;
		}
	}, [state, reconnectSpotify, trigger]);

	return { state, onAction };
}

function deriveState(input: {
	phase: ControlPhase;
	extensionInstalled: boolean | null;
	spotifyConnected: boolean;
	sync: ExtensionSyncState | null;
	errorState: { message: string; action: ErrorAction };
	cooldownRemaining: number;
	syncedAt: number;
}): DashboardSyncUiState {
	const {
		phase,
		extensionInstalled,
		spotifyConnected,
		sync,
		errorState,
		cooldownRemaining,
		syncedAt,
	} = input;

	if (phase === "error") {
		return {
			kind: "error",
			message: errorState.message,
			retryable: true,
			action: errorState.action,
		};
	}
	// A failed sync resolves its own cause (failSync checks Spotify directly), so
	// this phase is already the verified "Spotify is the problem" verdict.
	if (phase === "needs-spotify") {
		return { kind: "spotify-reconnect-required" };
	}
	if (phase === "cooldown") {
		return { kind: "cooldown", retryAfterSeconds: cooldownRemaining };
	}
	if (phase === "success") {
		return { kind: "success", syncedAt };
	}
	if (phase === "already-running") {
		return sync?.status === "syncing"
			? { kind: "syncing", sync }
			: { kind: "already-running" };
	}
	if (phase === "triggering") {
		// Show live progress the moment the extension reports it; otherwise the
		// command is still starting up.
		return sync?.status === "syncing"
			? { kind: "syncing", sync }
			: { kind: "triggering" };
	}

	// Idle: the CTA reflects what's missing to be able to sync — the same two
	// gates onboarding's setup trail checks (extension found, Spotify connected).
	if (extensionInstalled === null) {
		return { kind: "checking" };
	}
	if (!extensionInstalled) {
		return { kind: "install-required" };
	}
	if (!spotifyConnected) {
		return { kind: "spotify-reconnect-required" };
	}
	// Installed and Spotify-connected — if a sync is already live, show its
	// extension-reported phase/progress instead of collapsing it to a generic
	// lockout message.
	if (sync?.status === "syncing") {
		return { kind: "syncing", sync };
	}
	return { kind: "ready", lastSyncAt: sync?.lastSyncAt ?? null };
}
