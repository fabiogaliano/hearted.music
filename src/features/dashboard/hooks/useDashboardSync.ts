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
import { repairConnection } from "@/lib/extension/connection/repair";
import { reportSpotifyAuthSuccess } from "@/lib/extension/connection/report-failure";
import type { ConnectionVerdict } from "@/lib/extension/connection/verdict";
import {
	type ExtensionSyncState,
	requestExtensionSync,
} from "@/lib/extension/detect";
import { useExtensionSyncStatus } from "@/lib/extension/useExtensionSyncStatus";
import {
	EXTENSION_SYNC_ALREADY_RUNNING,
	EXTENSION_SYNC_COOLDOWN,
} from "../../../../shared/extension-sync-contract";

const EXTENSION_STORE_URL =
	"https://chromewebstore.google.com/detail/everything-you-ever-heart/ohaaafmgbbfohhjhogonolonpjhhfohk";

// Wrapped login URL so the token survives the accounts.spotify.com → open
// redirect, matching onboarding's InstallExtensionStep. repairConnection arms
// the eventual `continue` destination itself.
const SPOTIFY_LOGIN_URL =
	"https://accounts.spotify.com/en-GB/login?continue=https%3A%2F%2Fopen.spotify.com%2F";

const SUCCESS_LINGER_MS = 4_000;
const ACTIVE_POLL_MS = 1_500;
const IDLE_POLL_MS = 6_000;

export type DashboardSyncUiState =
	| { kind: "checking" }
	| { kind: "install-required" }
	// Pre-link accounts only (linkedSpotifyId === null) — before first sync
	// onboarding owns the connect UX and there's no banner to carry the
	// reconnect action, so the control keeps its own CTA (see deriveState).
	| { kind: "spotify-reconnect-required" }
	// Linked accounts with a non-ok verdict (spotify-disconnected / mismatch /
	// unpaired / unverifiable) — the dashboard banner is the single reconnect
	// home for all of these; the control only shows status.
	| { kind: "paused" }
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

// Internal control phase. The public UI state is *derived* from this plus the
// shared connection verdict + extension sync state, so transient transitions
// (e.g. triggering before the extension reports "syncing") never leak a stale
// CTA.
type ControlPhase =
	| "idle"
	| "triggering"
	| "cooldown"
	| "already-running"
	| "error"
	| "success";

export interface UseDashboardSyncResult {
	state: DashboardSyncUiState;
	/** Maps the current CTA to its action (install / reconnect Spotify / sync). */
	onAction: () => void;
}

export function useDashboardSync(
	accountId: string,
	verdict: ConnectionVerdict = { kind: "ok" },
	linkedSpotifyId: string | null = null,
): UseDashboardSyncResult {
	const queryClient = useQueryClient();

	const [phase, setPhase] = useState<ControlPhase>("idle");
	const [errorState, setErrorState] = useState<{
		message: string;
		action: ErrorAction;
	}>({ message: "", action: "retry" });
	const [cooldownRemaining, setCooldownRemaining] = useState(0);
	const [syncedAt, setSyncedAt] = useState(0);
	const [statusPollMs, setStatusPollMs] = useState(IDLE_POLL_MS);

	// "extension-missing" is the only verdict that means "confirmed absent";
	// "checking" means the shared connection query hasn't settled yet. Both are
	// cases where GET_STATUS polling should stay off — mirrors the old
	// `extensionInstalled === true` gate, now read off the verdict instead of a
	// private detection poll.
	const extensionInstalled =
		verdict.kind !== "checking" && verdict.kind !== "extension-missing";

	const { sync } = useExtensionSyncStatus({
		enabled: extensionInstalled,
		pollMs: statusPollMs,
	});

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

				// No structured signal here distinguishes "Spotify session actually
				// died" from any other sync failure (see the deviation log, Phase 03,
				// finding 2): the wire contract only carries a free-text message, and
				// re-probing SPOTIFY_STATUS would suffer the same local `hasToken`
				// blind spot invariant 7 already flags for the connection *poll* —
				// not better evidence, just a second read of the same unreliable
				// signal. Pushing a sticky, app-wide auth failure off that guess can
				// strand a healthy user in "reconnect Spotify" with nothing to clear
				// it, so this call site doesn't push at all; genuine
				// AUTH_REQUIRED/TOKEN_EXPIRED pushes belong at command call sites that
				// actually carry that errorCode (playlist/matching, tasks 04/05).
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
		// A completed sync is itself a Spotify command that succeeded (it read
		// liked songs/playlists through the extension's live token), so it's
		// exactly the "next Spotify command that succeeds" bound the README's
		// Risks section promises for any sticky auth failure pushed elsewhere
		// (e.g. a future playlist/matching call site).
		reportSpotifyAuthSuccess(queryClient);
	}, [fail, invalidateDashboard, queryClient]);

	// Success lingers briefly, then settles back to the derived readiness state.
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
		verdict,
		linkedSpotifyId,
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
				// Only reachable pre-link (see deriveState) — everywhere else the
				// banner is the reconnect home. repairConnection opens Spotify
				// synchronously (invariant 1), so it must fire directly from this
				// click, never behind an await.
				repairConnection({
					verdict,
					queryClient,
					spotifyLoginUrl: SPOTIFY_LOGIN_URL,
				}).catch(() => {
					// pairExtension() can reject (network, extension gone mid-flight).
					// Nothing more to do here — the next poll/focus refetch re-derives
					// the verdict; this only exists so the rejection isn't unhandled.
				});
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
				// checking / paused / triggering / syncing / already-running /
				// cooldown / success are non-actionable status states.
				break;
		}
	}, [state, verdict, queryClient, trigger]);

	return { state, onAction };
}

function deriveState(input: {
	phase: ControlPhase;
	verdict: ConnectionVerdict;
	linkedSpotifyId: string | null;
	sync: ExtensionSyncState | null;
	errorState: { message: string; action: ErrorAction };
	cooldownRemaining: number;
	syncedAt: number;
}): DashboardSyncUiState {
	const {
		phase,
		verdict,
		linkedSpotifyId,
		sync,
		errorState,
		cooldownRemaining,
		syncedAt,
	} = input;

	// A broken, identity-verified connection on a linked account (mismatch /
	// unpaired / spotify-disconnected / unverifiable) outranks every phase, not
	// just the readiness fallback at the bottom of this function. These are
	// exactly the verdicts the dashboard banner renders its own Reconnect CTA
	// for (see ExtensionAccountBanner) — if a stale phase like "error" won
	// instead, the control would show a second, competing affordance (its own
	// Retry) right below the banner's, and that Retry would be doomed: the
	// connection is genuinely broken, so retrying can't succeed. Extension-
	// missing is deliberately excluded — the banner never renders for it (it's
	// a setup CTA, not a reconnect one), so there's no second affordance for a
	// stale phase to collide with, and it keeps behaving like the
	// pre-migration code (a stale phase can still show through it; see
	// DECISIONS.md Phase 03, finding 1).
	const brokenForLinkedAccount =
		linkedSpotifyId !== null &&
		verdict.kind !== "ok" &&
		verdict.kind !== "checking" &&
		verdict.kind !== "extension-missing";
	if (brokenForLinkedAccount) {
		return { kind: "paused" };
	}

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

	// Idle: readiness comes straight from the shared verdict — the same two
	// gates onboarding's setup trail checks (extension found, Spotify
	// connected), now unified with the identity checks (mismatch/unpaired/
	// unverifiable) that used to be a separate poll.
	if (verdict.kind === "checking") {
		return { kind: "checking" };
	}
	if (verdict.kind === "extension-missing") {
		return { kind: "install-required" };
	}
	if (verdict.kind !== "ok") {
		// Only reachable pre-link (linkedSpotifyId === null) — the same verdicts
		// for a linked account were already handled by brokenForLinkedAccount
		// above, unconditionally on phase. Pre-link accounts have no banner
		// (onboarding owns that UX before first sync), so the control keeps the
		// one reconnect CTA it's always had.
		return { kind: "spotify-reconnect-required" };
	}
	// ok — if a sync is already live, show its extension-reported phase/progress
	// instead of collapsing it to a generic lockout message.
	if (sync?.status === "syncing") {
		return { kind: "syncing", sync };
	}
	return { kind: "ready", lastSyncAt: sync?.lastSyncAt ?? null };
}
