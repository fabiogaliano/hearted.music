/**
 * When the account-events client mints a token, opens the stream, waits, or
 * stays quiet. Pure: `useAccountEvents` owns the transport and feeds every
 * outcome back in as an event, with the clock and jitter as inputs.
 *
 * The constraints come from the 2026-10-17 outage: a client that re-minted on
 * every attempt, kept trying in hidden tabs and retried a failing mint within
 * 30 s held the app server over its CPU limit for ~28 hours.
 */

import type { ConnectionState } from "@/lib/hooks/useAccountEvents";

// A token this close to expiry could lapse before the gateway checks it.
export const TOKEN_REUSE_MARGIN_MS = 30_000;

// The mint is an app-server request; when it fails the app server is the
// thing in trouble, so retries are spaced in minutes, not seconds.
export const MINT_RETRY_FLOOR_MS = 60_000;
export const MINT_RETRY_CAP_MS = 5 * 60_000;

// Stream failures cost only the gateway, so they keep the short schedule.
export const STREAM_RETRY_FLOOR_MS = 2_000;
const STREAM_BACKOFF_BASE_MS = 1_000;
const STREAM_BACKOFF_CAP_MS = 30_000;
const RETRY_AFTER_JITTER_CAP_MS = 5_000;

export interface EventToken {
	value: string;
	expiresAtMs: number;
}

export type ReconnectPhase =
	| { kind: "minting" }
	| { kind: "opening"; token: string }
	| { kind: "connected" }
	| { kind: "waiting"; untilMs: number }
	// Hidden tab: nothing runs until it is visible again, and not before
	// `notBeforeMs`, so tab switching cannot skip a pending back-off.
	| { kind: "paused"; notBeforeMs: number }
	| { kind: "forbidden" };

export interface ReconnectState {
	phase: ReconnectPhase;
	token: EventToken | null;
	hidden: boolean;
	mintFailures: number;
	streamFailures: number;
	tokenRejections: number;
}

/** `random` is a uniform [0, 1) sample, injected so the jitter is testable. */
export type ReconnectEvent =
	| { type: "visibility_changed"; hidden: boolean; nowMs: number }
	| { type: "timer_fired"; nowMs: number }
	| { type: "mint_succeeded"; token: EventToken; nowMs: number }
	| { type: "mint_failed"; nowMs: number; random: number }
	| { type: "stream_opened" }
	| { type: "token_rejected"; nowMs: number; random: number }
	| { type: "token_expiring"; nowMs: number }
	| { type: "forbidden" }
	| {
			type: "stream_failed";
			nowMs: number;
			random: number;
			retryAfterMs?: number;
	  };

// Starts paused so the first visibility_changed decides whether to connect:
// a tab opened in the background stays quiet until it is shown.
export const initialReconnectState: ReconnectState = {
	phase: { kind: "paused", notBeforeMs: 0 },
	token: null,
	hidden: true,
	mintFailures: 0,
	streamFailures: 0,
	tokenRejections: 0,
};

function connectNow(state: ReconnectState, nowMs: number): ReconnectState {
	if (state.hidden) {
		return { ...state, phase: { kind: "paused", notBeforeMs: nowMs } };
	}
	const { token } = state;
	if (token && nowMs < token.expiresAtMs - TOKEN_REUSE_MARGIN_MS) {
		return { ...state, phase: { kind: "opening", token: token.value } };
	}
	return { ...state, token: null, phase: { kind: "minting" } };
}

function retryAt(state: ReconnectState, untilMs: number): ReconnectState {
	if (state.hidden) {
		return { ...state, phase: { kind: "paused", notBeforeMs: untilMs } };
	}
	return { ...state, phase: { kind: "waiting", untilMs } };
}

function mintRetryDelayMs(failures: number, random: number): number {
	const ceiling = Math.min(
		MINT_RETRY_CAP_MS,
		MINT_RETRY_FLOOR_MS * 2 ** failures,
	);
	return MINT_RETRY_FLOOR_MS + random * (ceiling - MINT_RETRY_FLOOR_MS);
}

function streamRetryDelayMs(
	failures: number,
	random: number,
	retryAfterMs: number | undefined,
): number {
	if (retryAfterMs !== undefined) {
		return (
			retryAfterMs + random * Math.min(RETRY_AFTER_JITTER_CAP_MS, retryAfterMs)
		);
	}
	const ceiling = Math.min(
		STREAM_BACKOFF_CAP_MS,
		STREAM_BACKOFF_BASE_MS * 2 ** (failures - 1),
	);
	return Math.max(STREAM_RETRY_FLOOR_MS, random * ceiling);
}

export function reconnectPolicy(
	state: ReconnectState,
	event: ReconnectEvent,
): ReconnectState {
	const { phase } = state;
	if (phase.kind === "forbidden") return state;

	switch (event.type) {
		case "visibility_changed": {
			const next = { ...state, hidden: event.hidden };
			if (event.hidden && phase.kind === "waiting") {
				return {
					...next,
					phase: { kind: "paused", notBeforeMs: phase.untilMs },
				};
			}
			if (!event.hidden && phase.kind === "paused") {
				return event.nowMs >= phase.notBeforeMs
					? connectNow(next, event.nowMs)
					: retryAt(next, phase.notBeforeMs);
			}
			// An in-flight mint or open finishes; its outcome pauses if still hidden.
			return next;
		}
		case "timer_fired":
			return phase.kind === "waiting" ? connectNow(state, event.nowMs) : state;
		case "mint_succeeded": {
			if (phase.kind !== "minting") return state;
			const next = { ...state, token: event.token, mintFailures: 0 };
			if (state.hidden) {
				return { ...next, phase: { kind: "paused", notBeforeMs: event.nowMs } };
			}
			// Opened without the expiry check: a fresh token judged expired (a
			// short-lived token, a skewed clock) would otherwise re-mint at once,
			// forever.
			return { ...next, phase: { kind: "opening", token: event.token.value } };
		}
		case "mint_failed": {
			if (phase.kind !== "minting") return state;
			const mintFailures = state.mintFailures + 1;
			return retryAt(
				{ ...state, mintFailures },
				event.nowMs + mintRetryDelayMs(mintFailures, event.random),
			);
		}
		case "stream_opened":
			if (phase.kind !== "opening") return state;
			return {
				...state,
				phase: { kind: "connected" },
				streamFailures: 0,
				tokenRejections: 0,
			};
		case "token_rejected": {
			if (phase.kind !== "opening") return state;
			const tokenRejections = state.tokenRejections + 1;
			const next = { ...state, token: null, tokenRejections };
			// One rejection is an expired token: re-mint at once. Repeated ones
			// mean fresh tokens are refused too, so each retry is another mint
			// and gets the mint schedule.
			if (tokenRejections === 1) return connectNow(next, event.nowMs);
			return retryAt(
				next,
				event.nowMs + mintRetryDelayMs(tokenRejections - 1, event.random),
			);
		}
		case "token_expiring":
			if (phase.kind !== "connected") return state;
			return connectNow({ ...state, token: null }, event.nowMs);
		case "forbidden":
			return { ...state, phase: { kind: "forbidden" } };
		case "stream_failed": {
			if (phase.kind !== "opening" && phase.kind !== "connected") return state;
			const streamFailures = state.streamFailures + 1;
			return retryAt(
				{ ...state, streamFailures },
				event.nowMs +
					streamRetryDelayMs(streamFailures, event.random, event.retryAfterMs),
			);
		}
	}
}

export function connectionStateOf(phase: ReconnectPhase): ConnectionState {
	switch (phase.kind) {
		case "minting":
		case "opening":
			return "connecting";
		case "connected":
			return "connected";
		case "waiting":
			return "error";
		case "paused":
			return "disconnected";
		case "forbidden":
			return "forbidden";
	}
}
