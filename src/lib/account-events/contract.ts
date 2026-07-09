/**
 * Account-events shared contract — types and constants only.
 *
 * This is the single source of truth that producers, the gateway, and the
 * client hook (`useAccountEvents`) all import.  Where contract.md and
 * proposal.md disagree, contract.md wins.
 *
 * @see docs/architecture/account-events/contract.md
 */

// ── Re-exported domain types ────────────────────────────────────────────────
// Type-only imports so this module never pulls in server runtime deps.

import type { MatchOrientation } from "@/lib/domains/taste/match-review-queue/types";
import type { ActiveJobs } from "@/lib/server/jobs.functions";

/**
 * Live-frame payload for `active_jobs_snapshot`.
 * Alias of `ActiveJobs` — do not fork the shape.
 *
 * @see contract.md §3 — "its payload IS the ActiveJobs shape"
 */
export type ActiveJobsSnapshot = ActiveJobs;

export type { MatchOrientation };

// ── Durable event types (§2) ────────────────────────────────────────────────

/**
 * Discriminant union for durable events stored in `account_event`.
 * Each member maps 1-to-1 to a row `type` and an SSE `event:` field.
 */
export type AccountEventType =
	| "match_snapshot_published"
	| "match_snapshot_failed"
	| "match_deck_appended"
	| "active_jobs_changed"
	| "enrichment_completed"
	| "enrichment_stopped"
	| "billing_state_changed";

// ── Live / control frame types (§3) ────────────────────────────────────────

/**
 * Non-durable frame types. These have no `id:` in the SSE stream and are
 * never replayed on reconnect.
 */
export type LiveFrameType = "active_jobs_snapshot" | "job_progress_changed";

/** Control frames sent by the gateway before closing the stream. */
export type ControlFrameType = "token_expiring" | "error";

/** Union of every frame type that may appear on the stream. */
export type AllFrameType = AccountEventType | LiveFrameType | ControlFrameType;

// ── Payload map (§2 + §3) ──────────────────────────────────────────────────

/**
 * Maps each frame `type` to its `data` payload shape.
 *
 * Durable events (§2), live frames (§3), and control frames all share this
 * map so `AccountEventEnvelope<T>` can discriminate on `type`.
 */
export interface AccountEventPayloadMap {
	// ── Durable events ────────────────────────────────────────────────────

	match_snapshot_published: {
		orientation: MatchOrientation;
		snapshotId: string;
	};

	match_snapshot_failed: {
		orientation: MatchOrientation | null;
		snapshotId: string | null;
		reason: string;
	};

	/**
	 * Emitted when `poll-match-deck-jobs` append_sessions arm applies new
	 * cards (`outcome.kind === "applied" && appendedCount > 0`).
	 */
	match_deck_appended: {
		orientation: MatchOrientation;
		sessionId: string;
		snapshotId: string;
		appendedCount: number;
	};

	/** Wake connected clients when active-job state changed without a richer durable event. */
	active_jobs_changed: Record<string, never>;

	/** Counts mirror ProgressCounts from jobs.functions.ts. */
	enrichment_completed: {
		jobId: string;
		counts: { done: number; total: number; succeeded: number; failed: number };
	};

	enrichment_stopped: {
		jobId: string;
		reason: "user_cancelled" | "failed" | "superseded";
		counts: { done: number; total: number; succeeded: number; failed: number };
	};

	/** Payload-free: client re-reads `getBillingState()`. */
	billing_state_changed: Record<string, never>;

	// ── Live frames ───────────────────────────────────────────────────────

	/** Full running-jobs view, sent on connect/reconnect and after relevant durables. */
	active_jobs_snapshot: ActiveJobsSnapshot;

	/** Best-effort coalesced progress ticks (phase 2+). */
	job_progress_changed: {
		jobId: string;
		kind: "enrichment" | "matchSnapshotRefresh";
		progress: {
			done: number;
			total: number;
			succeeded: number;
			failed: number;
		};
	};

	// ── Control frames ──────────────────────────────────────────────────

	/** Sent before closing the stream when the event token is about to expire. */
	token_expiring: { reason: "token_expired" };

	/** Terminal server-side error; stream will close after this frame. */
	error: { code: string };
}

// ── Envelope (§1.1) ────────────────────────────────────────────────────────

/**
 * Every SSE `data:` payload is one JSON object with this envelope.
 *
 * `accountId` is intentionally absent — the stream is account-scoped by the
 * bearer token, and replay is filtered server-side by `account_id`.
 */
export interface AccountEventEnvelope<T extends AllFrameType = AllFrameType> {
	/** Discriminant. Matches the SSE `event:` field. */
	type: T;
	/** Payload schema version. Bumped only on a breaking payload change (§6). */
	v: 1;
	/** Producer-side wall clock (`account_event.created_at`) as epoch ms. */
	ts: number;
	/** Present iff durable. Equals the SSE `id:` field. Absent on live/control frames. */
	publishId?: number;
	/** Discriminated by `type`. See §2 / §3. */
	data: AccountEventPayloadMap[T];
}

export type AnyAccountEventEnvelope = {
	[T in AllFrameType]: AccountEventEnvelope<T>;
}[AllFrameType];

// ── Event token claims (§4.2) ──────────────────────────────────────────────

/**
 * JWT claims for the short-lived event-stream token.
 *
 * Signed with `ACCOUNT_EVENTS_TOKEN_SECRET` (NOT `BETTER_AUTH_SECRET`).
 * The gateway validates signature + `exp` locally.
 */
export interface EventTokenClaims {
	/** accountId — the ONLY account this stream may read. */
	sub: string;
	/** Session id. */
	sid: string;
	/** Session/token version for revoke-all. */
	ver: number;
	iat: number;
	/** iat + 5 min. */
	exp: number;
	jti: string;
}

// ── Shared constants ───────────────────────────────────────────────────────

/**
 * Postgres NOTIFY channel fired when a new `account_event` row is inserted.
 * The gateway listens on this channel to push durable events.
 */
export const NOTIFY_CHANNEL_INSERTED = "account_event_inserted" as const;

/**
 * Postgres NOTIFY channel used to wake the gateway when it should re-check
 * for events (e.g. after a batch insert or out-of-band trigger).
 */
export const NOTIFY_CHANNEL_WAKE = "account_event_wake" as const;

/**
 * SSE heartbeat interval in milliseconds.
 * The gateway sends `: ping\n\n` comment frames at this cadence.
 *
 * @see contract.md §3.1 — "every 20 s (range 15–25 s)"
 */
export const HEARTBEAT_INTERVAL_MS = 20_000;

/**
 * Header name used to transport the reconnect cursor.
 * Standard SSE `Last-Event-ID` — sent explicitly by the fetch-based client.
 */
export const CURSOR_HEADER = "last-event-id" as const;
