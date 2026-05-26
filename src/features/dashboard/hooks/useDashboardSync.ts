/**
 * Dashboard sync orchestration.
 *
 * Drives the inline header sync control through a single discriminated UI state
 * so the component never reasons about booleans. Reuses the existing extension
 * messaging path: detection (PING + Spotify), pairing (CONNECT), an awaited
 * TRIGGER_SYNC, and GET_STATUS polling as the live progress truth. No SSE, no
 * server progress endpoint — phase_job_ids is intentionally untouched.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { dashboardKeys } from "@/features/dashboard/queries";
import { pairExtension } from "@/lib/extension/connect";
import {
	type ExtensionSyncState,
	getSpotifyConnectionStatus,
	isExtensionInstalled,
	requestExtensionSync,
} from "@/lib/extension/detect";
import { useExtensionSyncStatus } from "@/lib/extension/useExtensionSyncStatus";
import {
	EXTENSION_SYNC_ALREADY_RUNNING,
	EXTENSION_SYNC_COOLDOWN,
} from "../../../../shared/extension-sync-contract";

const EXTENSION_STORE_URL =
	"https://chromewebstore.google.com/detail/everything-you-ever-heart/ohaaafmgbbfohhjhogonolonpjhhfohk";

const SUCCESS_LINGER_MS = 4_000;
const DETECT_POLL_MS = 4_000;
const ACTIVE_POLL_MS = 1_500;
const IDLE_POLL_MS = 6_000;

export type DashboardSyncUiState =
	| { kind: "checking" }
	| { kind: "install-required" }
	| { kind: "reconnect-required" }
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
export type ErrorAction = "retry" | "reconnect" | "install";

// Internal control phase. The public UI state is *derived* from this plus live
// detection + extension sync state, so transient transitions (e.g. triggering
// before the extension reports "syncing") never leak a stale CTA.
type ControlPhase =
	| "idle"
	| "triggering"
	| "cooldown"
	| "already-running"
	| "error"
	| "success";

export interface UseDashboardSyncResult {
	state: DashboardSyncUiState;
	/** Maps the current CTA to its action (install / reconnect / sync / retry). */
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

	const { sync, hasToken } = useExtensionSyncStatus({
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
		// Keep a low-frequency GET_STATUS poll alive while installed so the
		// control can reflect pairing state and last-sync metadata even while
		// idle, then raise the cadence whenever a sync is actively running.
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

	const trigger = useCallback(async () => {
		setPhase("triggering");
		const result = await requestExtensionSync();

		if (result === null) {
			fail(
				"We couldn't reach the extension. Reconnect and try again.",
				"reconnect",
			);
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

				fail(
					backendFailure.message ??
						`Sync couldn't finish: backend HTTP ${backendFailure.status}`,
					"retry",
				);
				return;
			}

			fail(result.error, "retry");
			return;
		}

		setSyncedAt(Date.now());
		setPhase("success");
		invalidateDashboard();
	}, [fail, invalidateDashboard]);

	const reconnect = useCallback(async () => {
		setPhase("triggering");
		const paired = await pairExtension();
		if (!paired.ok) {
			fail("Couldn't reconnect the extension. Try again.", "reconnect");
			return;
		}
		await trigger();
	}, [fail, trigger]);

	// Success state lingers briefly, then settles back to a fresh ready state.
	useEffect(() => {
		if (phase !== "success") return;
		const timer = setTimeout(() => setPhase("idle"), SUCCESS_LINGER_MS);
		return () => clearTimeout(timer);
	}, [phase]);

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
		hasToken,
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
			case "reconnect-required":
				void reconnect();
				break;
			case "ready":
				void trigger();
				break;
			case "error":
				if (state.action === "install") {
					window.open(EXTENSION_STORE_URL, "_blank", "noopener,noreferrer");
				} else if (state.action === "reconnect") {
					void reconnect();
				} else {
					void trigger();
				}
				break;
			default:
				// checking / triggering / syncing / already-running / cooldown /
				// success are non-actionable status states.
				break;
		}
	}, [state, reconnect, trigger]);

	return { state, onAction };
}

function deriveState(input: {
	phase: ControlPhase;
	extensionInstalled: boolean | null;
	spotifyConnected: boolean;
	hasToken: boolean;
	sync: ExtensionSyncState | null;
	errorState: { message: string; action: ErrorAction };
	cooldownRemaining: number;
	syncedAt: number;
}): DashboardSyncUiState {
	const {
		phase,
		extensionInstalled,
		spotifyConnected,
		hasToken,
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

	// Idle: the CTA reflects what's missing to be able to sync.
	if (extensionInstalled === null) {
		return { kind: "checking" };
	}
	if (!extensionInstalled) {
		return { kind: "install-required" };
	}
	if (!hasToken || !spotifyConnected) {
		return { kind: "reconnect-required" };
	}
	// Installed, paired, connected — if a sync is already live, show its
	// extension-reported phase/progress instead of collapsing it to a generic
	// lockout message.
	if (sync?.status === "syncing") {
		return { kind: "syncing", sync };
	}
	return { kind: "ready", lastSyncAt: sync?.lastSyncAt ?? null };
}
