/**
 * Match review queue DB operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 * All mapping between camelCase domain types and snake_case rows happens here.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Json } from "@/lib/data/database.types";
import type { DbError } from "@/lib/shared/errors/database";
import { ConstraintError, DatabaseError } from "@/lib/shared/errors/database";
import {
	fromSupabaseMany,
	fromSupabaseMaybe,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";
import type {
	MatchReviewQueueItem,
	MatchReviewQueueItemRow,
	MatchReviewSession,
	MatchReviewSessionRow,
	MatchReviewSessionSnapshotRow,
	QueueItemLifecycleState,
	QueueItemResolution,
	QueueItemState,
	SessionStatus,
} from "./types";

/**
 * Narrows a raw DB string to QueueItemLifecycleState. Throws if the DB emits
 * a value that violates the CHECK constraint — this would mean a migration ran
 * without updating this narrowing (prevents silent data corruption).
 */
function toLifecycleState(s: string): QueueItemLifecycleState {
	if (s === "pending" || s === "active" || s === "resolved") return s;
	throw new Error(`Unexpected queue_item_lifecycle_state from DB: ${s}`);
}

function mapSessionRow(row: MatchReviewSessionRow): MatchReviewSession {
	return {
		id: row.id,
		accountId: row.account_id,
		status: row.status as SessionStatus,
		strictnessPreset: row.strictness_preset,
		strictnessMinScore: row.strictness_min_score,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		completedAt: row.completed_at,
	};
}

function mapItemRow(row: MatchReviewQueueItemRow): MatchReviewQueueItem {
	return {
		id: row.id,
		sessionId: row.session_id,
		accountId: row.account_id,
		// song_id is always set for song-orientation items (enforced by the
		// exactly-one-subject CHECK); playlist items use this mapper only on
		// the song-mode path today.
		songId: row.song_id as string,
		sourceSnapshotId: row.source_snapshot_id,
		position: row.position,
		state: toLifecycleState(row.state),
		resolution: row.resolution as QueueItemResolution | null,
		sourceScore: row.source_fit_score,
		wasNewAtEnqueue: row.was_new_at_enqueue,
		presentedAt: row.presented_at,
		resolvedAt: row.resolved_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/**
 * Inserts a new match review session.
 *
 * The unique partial index `idx_match_review_session_one_active` (WHERE status =
 * 'active') means two concurrent inserts for the same account will produce a
 * unique constraint violation (code 23505). The service layer treats that as a
 * "already active" signal and falls back to fetching the existing session.
 */
export async function insertMatchReviewSession(
	accountId: string,
	strictnessPreset: string,
	strictnessMinScore: number,
): Promise<Result<MatchReviewSession, DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseSingle(
		supabase
			.from("match_review_session")
			.insert({
				account_id: accountId,
				status: "active",
				strictness_preset: strictnessPreset,
				strictness_min_score: strictnessMinScore,
			})
			.select()
			.single(),
	);
	if (Result.isError(result)) return result;
	return Result.ok(mapSessionRow(result.value));
}

/**
 * Fetches the active session for an account. Returns null when none exists.
 */
export async function fetchActiveSession(
	accountId: string,
): Promise<Result<MatchReviewSession | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMaybe(
		supabase
			.from("match_review_session")
			.select("*")
			.eq("account_id", accountId)
			.eq("status", "active")
			.maybeSingle(),
	);
	if (Result.isError(result)) return result;
	return Result.ok(result.value ? mapSessionRow(result.value) : null);
}

/**
 * Marks an active session completed. The `.eq("status", "active")` guard makes
 * the transition conditional so two concurrent rollovers can't double-complete:
 * the first writer wins and the loser matches no row (returns null). Used by the
 * lazy pass-rollover path — a caught-up session is completed so a fresh pass can
 * re-offer skipped songs without colliding with the one-active partial index.
 *
 * Returns Result.ok(null) when no active row matched (already completed/raced).
 */
export async function completeSession(
	sessionId: string,
	accountId: string,
): Promise<Result<MatchReviewSession | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	const now = new Date().toISOString();
	const result = await fromSupabaseMaybe(
		supabase
			.from("match_review_session")
			.update({
				status: "completed",
				completed_at: now,
				updated_at: now,
			})
			.eq("id", sessionId)
			.eq("account_id", accountId)
			.eq("status", "active")
			.select()
			.maybeSingle(),
	);
	if (Result.isError(result)) return result;
	return Result.ok(result.value ? mapSessionRow(result.value) : null);
}

/**
 * Returns the highest position already in the session, or -1 when the queue is
 * empty. The service adds 1 to get the next append start position.
 */
export async function fetchMaxPosition(
	sessionId: string,
): Promise<Result<number, DbError>> {
	const supabase = createAdminSupabaseClient();
	// Supabase doesn't expose a typed aggregate RPC here, so we sort desc +
	// limit 1 and extract the position — one row is all we need.
	const result = await fromSupabaseMaybe(
		supabase
			.from("match_review_queue_item")
			.select("position")
			.eq("session_id", sessionId)
			.order("position", { ascending: false })
			.limit(1)
			.maybeSingle(),
	);
	if (Result.isError(result)) return result;
	return Result.ok(result.value?.position ?? -1);
}

export interface QueueItemInsert {
	sessionId: string;
	accountId: string;
	songId: string;
	sourceSnapshotId: string;
	position: number;
	sourceScore: number;
	wasNewAtEnqueue: boolean;
}

/**
 * Batch-inserts song-orientation queue items via an RPC that targets the
 * partial unique index `idx_match_review_queue_item_session_song_subject`
 * (WHERE orientation = 'song'). PostgREST cannot target partial indexes via
 * `onConflict` column lists, so we use an explicit SQL path. Duplicate
 * (session_id, song_id) rows are silently skipped (ON CONFLICT DO NOTHING),
 * making concurrent same-snapshot appends safe without a ConstraintError.
 */
export async function insertQueueItems(
	items: QueueItemInsert[],
): Promise<Result<void, DbError>> {
	if (items.length === 0) {
		return Promise.resolve(Result.ok<void, DbError>(undefined));
	}

	const sessionId = items[0].sessionId;
	const accountId = items[0].accountId;
	const supabase = createAdminSupabaseClient();
	const { error } = await supabase.rpc("insert_queue_song_items", {
		p_session_id: sessionId,
		p_account_id: accountId,
		p_items: items.map((item) => ({
			song_id: item.songId,
			source_snapshot_id: item.sourceSnapshotId,
			position: item.position,
			source_fit_score: item.sourceScore,
			was_new_at_enqueue: item.wasNewAtEnqueue,
		})),
	});

	if (error) {
		if (error.code === "23505") {
			return Result.err(
				new ConstraintError("unique", error.details ?? error.message),
			);
		}
		if (error.code === "23503") {
			return Result.err(
				new ConstraintError("foreign_key", error.details ?? error.message),
			);
		}
		if (error.code === "23514") {
			return Result.err(
				new ConstraintError("check", error.details ?? error.message),
			);
		}
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}
	return Result.ok(undefined);
}

/**
 * Returns all queue items for a session, ordered by position ascending.
 */
export async function fetchQueueItems(
	sessionId: string,
): Promise<Result<MatchReviewQueueItem[], DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMany(
		supabase
			.from("match_review_queue_item")
			.select("*")
			.eq("session_id", sessionId)
			.order("position", { ascending: true }),
	);
	if (Result.isError(result)) return result;
	return Result.ok(result.value.map(mapItemRow));
}

/**
 * Returns the song_ids already present in the session so the append path can
 * exclude them without loading full item rows.
 */
export async function fetchQueuedSongIds(
	sessionId: string,
): Promise<Result<Set<string>, DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMany(
		supabase
			.from("match_review_queue_item")
			.select("song_id")
			.eq("session_id", sessionId),
	);
	if (Result.isError(result)) return result;
	return Result.ok(
		new Set(
			result.value
				.map((r) => r.song_id)
				.filter((id): id is string => id !== null),
		),
	);
}

/**
 * Counts queue items that are not yet resolved.
 * Drives the dashboard CTA badge and the caught-up detection.
 */
export async function countUnresolvedItems(
	sessionId: string,
): Promise<Result<number, DbError>> {
	const supabase = createAdminSupabaseClient();
	// Supabase count via head:true returns count in the response header.
	const { count, error } = await supabase
		.from("match_review_queue_item")
		.select("id", { count: "exact", head: true })
		.eq("session_id", sessionId)
		.in("state", ["pending", "active"]);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}
	return Result.ok(count ?? 0);
}

/**
 * Advances a queue item to the 'active' lifecycle state and records presented_at.
 *
 * The `.in("state", ["pending", "active"])` guard makes the transition
 * conditional: only an unresolved card may become active. A resolved item —
 * or one that raced with finish/dismiss — is NOT updated, so a stale navigation
 * can never resurrect a decided card. 'active' is kept in the allowed set so
 * re-presenting an already-active item stays idempotent.
 *
 * Returns Result.ok(null) when no eligible row matched (resolved, raced, or
 * foreign): maybeSingle yields no row without erroring, so the caller can treat
 * "no-op" distinctly from a genuine DB failure without leaking ownership detail.
 *
 * accountId scopes the UPDATE so no pre-check bypass can write to a foreign item.
 */
export async function updateQueueItemPresented(
	itemId: string,
	accountId: string,
	now: string,
): Promise<Result<MatchReviewQueueItem | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMaybe(
		supabase
			.from("match_review_queue_item")
			.update({
				state: "active",
				presented_at: now,
				updated_at: now,
			})
			.eq("id", itemId)
			.eq("account_id", accountId)
			.in("state", ["pending", "active"])
			.select()
			.maybeSingle(),
	);
	if (Result.isError(result)) return result;
	return Result.ok(result.value ? mapItemRow(result.value) : null);
}

/**
 * Resolves a queue item and records the outcome in the resolution column.
 *
 * The state column always becomes 'resolved' (B9-C); the `_legacyState`
 * parameter is kept for caller compatibility until a later story removes it.
 *
 * The `.in("state", ["pending", "active"])` guard makes the transition
 * conditional: the first concurrent writer wins and the second writer matches
 * no row without erroring. The caller can treat Result.ok(null) as a lost race.
 *
 * accountId scopes the UPDATE so no pre-check bypass can write to a foreign item.
 */
export async function updateQueueItemResolved(
	itemId: string,
	accountId: string,
	_legacyState: Extract<
		QueueItemState,
		"completed" | "skipped" | "unavailable"
	>,
	resolution: QueueItemResolution,
	now: string,
): Promise<Result<MatchReviewQueueItem | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMaybe(
		supabase
			.from("match_review_queue_item")
			.update({
				state: "resolved",
				resolution,
				resolved_at: now,
				updated_at: now,
			})
			.eq("id", itemId)
			.eq("account_id", accountId)
			.in("state", ["pending", "active"])
			.select()
			.maybeSingle(),
	);
	if (Result.isError(result)) return result;
	return Result.ok(result.value ? mapItemRow(result.value) : null);
}

const ADD_QUEUE_ITEM_DECISION_ATOMIC_STATUSES = [
	"added",
	"not_found",
	"already_resolved",
	"not_entitled",
	"foreign_playlist",
] as const;

export type AddQueueItemDecisionAtomicStatus =
	(typeof ADD_QUEUE_ITEM_DECISION_ATOMIC_STATUSES)[number];

function isAddQueueItemDecisionAtomicStatus(
	value: string | null,
): value is AddQueueItemDecisionAtomicStatus {
	return ADD_QUEUE_ITEM_DECISION_ATOMIC_STATUSES.some(
		(status) => status === value,
	);
}

/**
 * Writes an added decision under the queue-row lock. If finish/dismiss already
 * resolved the item, the RPC returns already_resolved and writes no decision.
 */
export async function addQueueItemDecisionAtomically(
	itemId: string,
	accountId: string,
	playlistId: string,
	servedRank: number | null,
): Promise<Result<AddQueueItemDecisionAtomicStatus, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc(
		"add_match_review_item_decision_atomic",
		{
			p_item_id: itemId,
			p_account_id: accountId,
			p_playlist_id: playlistId,
			p_served_rank: servedRank ?? undefined,
		},
	);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	if (!isAddQueueItemDecisionAtomicStatus(data)) {
		return Result.err(
			new DatabaseError({
				code: "unexpected_rpc_result",
				message:
					"add_match_review_item_decision_atomic returned an unknown status.",
			}),
		);
	}

	return Result.ok(data);
}

const DISMISS_QUEUE_ITEM_ATOMIC_STATUSES = [
	"dismissed",
	"not_found",
	"already_resolved",
	"invalid_input",
] as const;

export type DismissQueueItemAtomicStatus =
	(typeof DISMISS_QUEUE_ITEM_ATOMIC_STATUSES)[number];

export interface DismissQueueItemAtomicDecision {
	playlistId: string;
	servedRank: number | null;
}

function isDismissQueueItemAtomicStatus(
	value: string | null,
): value is DismissQueueItemAtomicStatus {
	return DISMISS_QUEUE_ITEM_ATOMIC_STATUSES.some((status) => status === value);
}

/**
 * Resolves an item as dismissed and writes dismissed decisions in one DB
 * transaction. The RPC first locks and resolves the queue row; if another finish
 * or dismiss already won, it returns already_resolved and writes no decisions.
 */
export async function dismissQueueItemAtomically(
	itemId: string,
	accountId: string,
	decisions: DismissQueueItemAtomicDecision[],
): Promise<Result<DismissQueueItemAtomicStatus, DbError>> {
	const decisionsJson: Json = decisions.map((decision) => ({
		playlist_id: decision.playlistId,
		served_rank: decision.servedRank,
	}));
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc(
		"dismiss_match_review_item_atomic",
		{
			p_item_id: itemId,
			p_account_id: accountId,
			p_decisions: decisionsJson,
		},
	);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	if (!isDismissQueueItemAtomicStatus(data)) {
		return Result.err(
			new DatabaseError({
				code: "unexpected_rpc_result",
				message: "dismiss_match_review_item_atomic returned an unknown status.",
			}),
		);
	}

	return Result.ok(data);
}

const FINISH_QUEUE_ITEM_ATOMIC_STATUSES = [
	"completed_added",
	"skipped",
	"not_found",
	"already_resolved",
] as const;

export type FinishQueueItemAtomicStatus =
	(typeof FINISH_QUEUE_ITEM_ATOMIC_STATUSES)[number];

function isFinishQueueItemAtomicStatus(
	value: string | null,
): value is FinishQueueItemAtomicStatus {
	return FINISH_QUEUE_ITEM_ATOMIC_STATUSES.some((status) => status === value);
}

/**
 * Resolves a queue item under the row lock. Because add also takes this lock
 * before writing, finish's add-count and resolution are serialized with add.
 */
export async function finishQueueItemAtomically(
	itemId: string,
	accountId: string,
): Promise<Result<FinishQueueItemAtomicStatus, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc(
		"finish_match_review_item_atomic",
		{
			p_item_id: itemId,
			p_account_id: accountId,
		},
	);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	if (!isFinishQueueItemAtomicStatus(data)) {
		return Result.err(
			new DatabaseError({
				code: "unexpected_rpc_result",
				message: "finish_match_review_item_atomic returned an unknown status.",
			}),
		);
	}

	return Result.ok(data);
}

/**
 * Returns the set of snapshot IDs already applied to this session.
 * The append path uses this to skip snapshots it has already processed.
 */
export async function fetchAppliedSnapshotIds(
	sessionId: string,
): Promise<Result<Set<string>, DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMany(
		supabase
			.from("match_review_session_snapshot")
			.select("snapshot_id")
			.eq("session_id", sessionId),
	);
	if (Result.isError(result)) return result;
	return Result.ok(new Set(result.value.map((r) => r.snapshot_id)));
}

/**
 * Records that a snapshot has been applied to the session.
 * The composite primary key (session_id, snapshot_id) makes a duplicate insert
 * fail with a unique constraint violation — the service treats that as a safe
 * no-op (already idempotent).
 */
export async function insertSessionSnapshot(
	sessionId: string,
	snapshotId: string,
	appendedItemCount: number,
): Promise<Result<MatchReviewSessionSnapshotRow, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("match_review_session_snapshot")
			.insert({
				session_id: sessionId,
				snapshot_id: snapshotId,
				appended_item_count: appendedItemCount,
			})
			.select()
			.single(),
	);
}

/**
 * Marks account_item_newness.is_new = false for a single song.
 * Called when an item is presented so newness is cleared durably, not on
 * unload. Best-effort: a failure here must not fail the presented transition.
 */
export async function clearSongNewness(
	accountId: string,
	songId: string,
	now: string,
): Promise<void> {
	const supabase = createAdminSupabaseClient();
	await supabase.from("account_item_newness").upsert(
		{
			account_id: accountId,
			item_id: songId,
			item_type: "song" as const,
			is_new: false,
			viewed_at: now,
		},
		{ onConflict: "account_id,item_id,item_type" },
	);
}

/**
 * Returns song IDs for the first N pending items in the session, in queue
 * order. Drives the dashboard CTA preview images without loading full rows.
 */
export async function fetchPendingSongIds(
	sessionId: string,
	limit: number,
): Promise<Result<string[], DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMany(
		supabase
			.from("match_review_queue_item")
			.select("song_id")
			.eq("session_id", sessionId)
			.in("state", ["pending", "active"])
			.order("position", { ascending: true })
			.limit(limit),
	);
	if (Result.isError(result)) return result;
	return Result.ok(
		result.value
			.map((r) => r.song_id)
			.filter((id): id is string => id !== null),
	);
}
