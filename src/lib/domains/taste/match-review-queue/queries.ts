/**
 * Match review queue DB operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 * All mapping between camelCase domain types and snake_case rows happens here.
 */

import { Result } from "better-result";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { parseStoredMatchFilters } from "@/lib/domains/taste/match-filters/schemas";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import type { DbError } from "@/lib/shared/errors/database";
import { ConstraintError, DatabaseError } from "@/lib/shared/errors/database";
import { chunkedRead } from "@/lib/shared/utils/chunked-read";
import {
	fromSupabaseMany,
	fromSupabaseMaybe,
	fromSupabaseRpc,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";
import type {
	MatchOrientation,
	MatchReviewQueueItem,
	MatchReviewQueueItemDto,
	MatchReviewQueueItemRow,
	MatchReviewSession,
	MatchReviewSessionRow,
	MatchReviewSessionSnapshotRow,
	MatchReviewSubject,
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

/**
 * Narrows a raw DB string to MatchOrientation. Throws if the DB emits a value
 * outside the CHECK constraint — indicates an unapplied migration.
 */
function toOrientation(s: string): MatchOrientation {
	if (s === "song" || s === "playlist") return s;
	throw new Error(`Unexpected match_orientation from DB: ${s}`);
}

/**
 * The subset of match_review_queue_item columns mapItemToDto consumes. Typing the
 * mapper to exactly these lets fetchQueueItems narrow its `select` to the DTO
 * columns (P1) while a full `*` row (fetchOwnedQueueItem) still satisfies it —
 * structural subtyping means a wider row is assignable to the narrower shape.
 */
type MatchReviewQueueItemDtoColumns = Pick<
	MatchReviewQueueItemRow,
	| "id"
	| "session_id"
	| "account_id"
	| "orientation"
	| "song_id"
	| "playlist_id"
	| "source_snapshot_id"
	| "position"
	| "state"
	| "resolution"
	| "source_fit_score"
	| "was_new_at_enqueue"
	| "presented_at"
	| "resolved_at"
	| "visible_pairs_captured_at"
	| "created_at"
	| "updated_at"
>;

/**
 * Maps the orientation + nullable subject columns from a DB row to the
 * MatchReviewSubject discriminated union. Throws instead of returning an
 * invalid/optional shape so callers never encounter missing-subject ambiguity
 * in exported DTOs (MSR-18 acceptance criterion: invalid rows are errors).
 */
function toMatchReviewSubject(
	row: Pick<
		MatchReviewQueueItemRow,
		"id" | "orientation" | "song_id" | "playlist_id"
	>,
): MatchReviewSubject {
	const orientation = toOrientation(row.orientation);
	if (orientation === "song") {
		if (!row.song_id) {
			throw new Error(
				`Queue item ${row.id} has orientation 'song' but song_id is null`,
			);
		}
		return { orientation: "song", songId: row.song_id };
	}
	if (!row.playlist_id) {
		throw new Error(
			`Queue item ${row.id} has orientation 'playlist' but playlist_id is null`,
		);
	}
	return { orientation: "playlist", playlistId: row.playlist_id };
}

function mapSessionRow(row: MatchReviewSessionRow): MatchReviewSession {
	return {
		id: row.id,
		accountId: row.account_id,
		orientation: toOrientation(row.orientation),
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
 * Maps a DB row to the orientation-aware MatchReviewQueueItemDto using a
 * MatchReviewSubject discriminated union. Throws for invalid/missing subject
 * rows rather than exposing optional fields — callers always get a valid shape
 * or a hard error (MSR-18 B3/E8).
 */
export function mapItemToDto(
	row: MatchReviewQueueItemDtoColumns,
): MatchReviewQueueItemDto {
	return {
		id: row.id,
		sessionId: row.session_id,
		accountId: row.account_id,
		subject: toMatchReviewSubject(row),
		sourceSnapshotId: row.source_snapshot_id,
		position: row.position,
		state: toLifecycleState(row.state),
		resolution: row.resolution as QueueItemResolution | null,
		sourceScore: row.source_fit_score,
		wasNewAtEnqueue: row.was_new_at_enqueue,
		presentedAt: row.presented_at,
		resolvedAt: row.resolved_at,
		visiblePairsCapturedAt: row.visible_pairs_captured_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/**
 * Inserts a new match review session for the given orientation.
 *
 * The unique partial index `idx_match_review_session_one_active_per_orientation`
 * (WHERE status = 'active') allows one active session per (account, orientation).
 * Two concurrent inserts for the same account AND orientation produce a unique
 * constraint violation (code 23505); the service layer falls back to fetching
 * the existing session. Song-mode and playlist-mode sessions are independent.
 */
export async function insertMatchReviewSession(
	accountId: string,
	strictnessPreset: string,
	strictnessMinScore: number,
	orientation: MatchOrientation,
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
				orientation,
			})
			.select()
			.single(),
	);
	if (Result.isError(result)) return result;
	return Result.ok(mapSessionRow(result.value));
}

/**
 * Fetches the active session for a given (account, orientation) pair.
 * Returns null when no active session exists for that orientation.
 *
 * Each orientation has its own active session slot enforced by the partial
 * unique index `idx_match_review_session_one_active_per_orientation`
 * (WHERE status = 'active'), so song-mode and playlist-mode sessions are
 * fetched and managed independently.
 */
export async function fetchActiveSession(
	accountId: string,
	orientation: MatchOrientation,
): Promise<Result<MatchReviewSession | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMaybe(
		supabase
			.from("match_review_session")
			.select("*")
			.eq("account_id", accountId)
			.eq("orientation", orientation)
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

export interface PlaylistQueueItemInsert {
	sessionId: string;
	accountId: string;
	playlistId: string;
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
 * Batch-inserts playlist-orientation queue items via an RPC that targets the
 * partial unique index `idx_match_review_queue_item_session_playlist_subject`
 * (WHERE orientation = 'playlist'). The playlist counterpart to
 * insertQueueItems: rows carry orientation='playlist', playlist_id set, and
 * song_id NULL (the exactly-one-subject CHECK). Duplicate (session_id,
 * playlist_id) rows are silently skipped (ON CONFLICT DO NOTHING) so concurrent
 * same-snapshot appends stay idempotent without a ConstraintError.
 */
export async function insertQueuePlaylistItems(
	items: PlaylistQueueItemInsert[],
): Promise<Result<void, DbError>> {
	if (items.length === 0) {
		return Promise.resolve(Result.ok<void, DbError>(undefined));
	}

	const sessionId = items[0].sessionId;
	const accountId = items[0].accountId;
	const supabase = createAdminSupabaseClient();
	const { error } = await supabase.rpc("insert_queue_playlist_items", {
		p_session_id: sessionId,
		p_account_id: accountId,
		p_items: items.map((item) => ({
			playlist_id: item.playlistId,
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
 *
 * Maps via mapItemToDto so each item carries a MatchReviewSubject discriminated
 * union — playlist-mode rows (song_id NULL) stay orientation-safe instead of
 * being forced through the song-only legacy shape.
 */
export async function fetchQueueItems(
	sessionId: string,
): Promise<Result<MatchReviewQueueItemDto[], DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMany(
		supabase
			.from("match_review_queue_item")
			// Explicit column list rather than `*`: this read runs on every /match
			// entry AND every queue refetch (P1). The list is exactly the set
			// mapItemToDto consumes — narrowing further would need a separate
			// lightweight mapper, and under-selecting would silently null a DTO field.
			.select(
				"id, session_id, account_id, orientation, song_id, playlist_id, source_snapshot_id, position, state, resolution, source_fit_score, was_new_at_enqueue, presented_at, resolved_at, visible_pairs_captured_at, created_at, updated_at",
			)
			.eq("session_id", sessionId)
			.order("position", { ascending: true }),
	);
	if (Result.isError(result)) return result;
	return Result.ok(result.value.map(mapItemToDto));
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
 * Returns the playlist_ids already present in the session so the playlist-mode
 * append path can exclude them. Playlist counterpart to fetchQueuedSongIds.
 */
export async function fetchQueuedPlaylistIds(
	sessionId: string,
): Promise<Result<Set<string>, DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMany(
		supabase
			.from("match_review_queue_item")
			.select("playlist_id")
			.eq("session_id", sessionId),
	);
	if (Result.isError(result)) return result;
	return Result.ok(
		new Set(
			result.value
				.map((r) => r.playlist_id)
				.filter((id): id is string => id !== null),
		),
	);
}

/**
 * Returns the subset of the given playlist IDs that still belong to the account,
 * in one query. Used by the playlist-mode append path to drop subjects whose
 * review playlist was deleted or transferred before enqueuing them (Finding 1).
 */
export async function fetchOwnedPlaylistIds(
	accountId: string,
	playlistIds: readonly string[],
): Promise<Result<Set<string>, DbError>> {
	if (playlistIds.length === 0) return Result.ok(new Set());
	const supabase = createAdminSupabaseClient();
	// Chunk the `.in()` ids so the query string stays under the URI-length limit;
	// merge the surviving ids into one Set (duplicates collapse naturally).
	const rowsResult = await chunkedRead(playlistIds, (batch) =>
		fromSupabaseMany(
			supabase
				.from("playlist")
				.select("id")
				.eq("account_id", accountId)
				.in("id", batch),
		),
	);
	if (Result.isError(rowsResult)) return rowsResult;
	const owned = new Set<string>();
	for (const row of rowsResult.value) owned.add(row.id);
	return Result.ok(owned);
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
	"invalid_target",
	"not_visible",
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
 * Writes an added decision under the queue-row lock using the captured visible
 * pair as the source of ranks. If finish/dismiss already resolved the item, the
 * RPC returns already_resolved and writes no decision.
 *
 * Orientation-aware: pass suggestionPlaylistId for song-orientation items (subject
 * is song, suggestion is playlist) and suggestionSongId for playlist-orientation
 * items (subject is playlist, suggestion is song). Supplying the wrong side
 * returns invalid_target; a pair not in the captured visible set returns not_visible.
 */
export async function addQueueItemDecisionAtomically(
	itemId: string,
	accountId: string,
	suggestionSongId: string | null,
	suggestionPlaylistId: string | null,
): Promise<Result<AddQueueItemDecisionAtomicStatus, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc(
		"add_match_review_item_decision_atomic",
		{
			p_item_id: itemId,
			p_account_id: accountId,
			p_suggestion_song_id: suggestionSongId ?? undefined,
			p_suggestion_playlist_id: suggestionPlaylistId ?? undefined,
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

/**
 * One row of the playlist-card read model: a captured visible pair joined to
 * its song row, with post-capture dismissed pairs already excluded. Rows come
 * back in display order (fit_score DESC, model_rank ASC, stable id — C12), so
 * callers must not re-sort.
 */
export interface QueueItemSongSuggestionRow {
	songId: string;
	name: string;
	artists: string[];
	albumName: string | null;
	imageUrl: string | null;
	spotifyId: string;
	genres: string[];
	fitScore: number;
	visibleRank: number;
	modelRank: number;
	/** Post-dismissal total for the item — identical on every row of a page. */
	totalActiveCount: number;
}

/**
 * Cursor into the keyset-paged suggestion read. Mirrors the RPC's total order
 * (fit_score DESC, model_rank ASC, song_id ASC) — song_id is unique per item,
 * so the triple is a strict total order and a dismissed cursor row is
 * harmless (the WHERE compares sort-key values, not row existence).
 */
export interface QueueItemSongSuggestionCursor {
	fitScore: number;
	modelRank: number;
	songId: string;
}

// Loose row schema: validates only the fields readQueueItemSongSuggestions
// maps below, so an RPC column addition doesn't need a schema update here.
const QueueItemSongSuggestionRpcRowSchema = z.looseObject({
	song_id: z.string(),
	name: z.string(),
	artists: z.array(z.string()),
	album_name: z.string().nullable().optional(),
	image_url: z.string().nullable().optional(),
	spotify_id: z.string(),
	genres: z.array(z.string()),
	fit_score: z.number(),
	visible_rank: z.number(),
	model_rank: z.number(),
	total_active_count: z.number(),
});
const QueueItemSongSuggestionRpcRowsSchema = z.array(
	QueueItemSongSuggestionRpcRowSchema,
);

/**
 * Reads a playlist-orientation card's suggestion list from the captured
 * authority in ONE round trip: visible pairs ⋈ song, dismissed anti-join,
 * ordering and paging all inside Postgres. No id set leaves the database, so
 * this read cannot hit the URI-length limit regardless of capture size (the
 * 414 class that chunkedRead only mitigates call-site by call-site).
 *
 * `options.after` is a keyset cursor rather than an offset — offsets drift
 * mid-review because the dismissed anti-join removes rows server-side, which
 * would otherwise skip or repeat rows on a paged card.
 *
 * Returns zero rows for both an empty capture and an all-dismissed capture —
 * disambiguate with countCapturedVisiblePairs.
 */
export async function readQueueItemSongSuggestions(
	itemId: string,
	accountId: string,
	options: { limit?: number; after?: QueueItemSongSuggestionCursor } = {},
): Promise<Result<QueueItemSongSuggestionRow[], DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseRpc(
		QueueItemSongSuggestionRpcRowsSchema,
		supabase.rpc("read_match_review_item_song_suggestions", {
			p_item_id: itemId,
			p_account_id: accountId,
			p_limit: options.limit,
			p_after_fit_score: options.after?.fitScore,
			p_after_model_rank: options.after?.modelRank,
			p_after_song_id: options.after?.songId,
		}),
	);

	if (Result.isError(result)) return result;

	return Result.ok(
		result.value.map((row) => ({
			songId: row.song_id,
			name: row.name,
			artists: row.artists,
			albumName: row.album_name ?? null,
			imageUrl: row.image_url ?? null,
			spotifyId: row.spotify_id,
			genres: row.genres,
			fitScore: row.fit_score,
			visibleRank: row.visible_rank,
			modelRank: row.model_rank,
			totalActiveCount: row.total_active_count,
		})),
	);
}

/**
 * Counts an item's captured visible pairs (pre-dismissal). Used to tell an
 * empty capture (no-visible-suggestions card) apart from a capture whose
 * suggestions were all row-dismissed after presentation (ready card, empty list).
 */
export async function countCapturedVisiblePairs(
	itemId: string,
	accountId: string,
): Promise<Result<number, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { count, error } = await supabase
		.from("match_review_item_visible_pair")
		.select("*", { count: "exact", head: true })
		.eq("queue_item_id", itemId)
		.eq("account_id", accountId);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok(count ?? 0);
}

const DISMISS_QUEUE_ITEM_ATOMIC_STATUSES = [
	"dismissed",
	"not_found",
	"already_resolved",
	// Returned when match_review_item_visible_pair has no rows for the item —
	// presentMatchReviewItem must capture pairs before dismiss can proceed (MSR-27).
	"no_captured_pairs",
] as const;

const DISMISS_QUEUE_ITEM_SUGGESTION_ATOMIC_STATUSES = [
	"dismissed",
	"not_found",
	"already_resolved",
	"not_entitled",
	"foreign_playlist",
	"invalid_target",
	"not_visible",
	"already_added",
] as const;

export type DismissQueueItemSuggestionAtomicStatus =
	(typeof DISMISS_QUEUE_ITEM_SUGGESTION_ATOMIC_STATUSES)[number];

function isDismissQueueItemSuggestionAtomicStatus(
	value: string | null,
): value is DismissQueueItemSuggestionAtomicStatus {
	return DISMISS_QUEUE_ITEM_SUGGESTION_ATOMIC_STATUSES.some(
		(status) => status === value,
	);
}

export type DismissQueueItemAtomicStatus =
	(typeof DISMISS_QUEUE_ITEM_ATOMIC_STATUSES)[number];

function isDismissQueueItemAtomicStatus(
	value: string | null,
): value is DismissQueueItemAtomicStatus {
	return DISMISS_QUEUE_ITEM_ATOMIC_STATUSES.some((status) => status === value);
}

/**
 * Resolves an item as dismissed and writes dismissed decisions in one DB
 * transaction. Decisions are derived from captured visible pair rows in
 * match_review_item_visible_pair — the caller no longer supplies decisions.
 *
 * Returns no_captured_pairs if presentMatchReviewItem has not yet run for the
 * item; the TypeScript caller maps this to derive-failed so the item stays
 * pending and the dismiss can be retried after presentation.
 */
export async function dismissQueueItemAtomically(
	itemId: string,
	accountId: string,
): Promise<Result<DismissQueueItemAtomicStatus, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc(
		"dismiss_match_review_item_atomic",
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

/**
 * Writes a dismissed decision for one captured suggestion pair without resolving
 * the queue item. Orientation-aware: pass suggestionPlaylistId for song items and
 * suggestionSongId for playlist items.
 */
export async function dismissQueueItemSuggestionAtomically(
	itemId: string,
	accountId: string,
	suggestionSongId: string | null,
	suggestionPlaylistId: string | null,
): Promise<Result<DismissQueueItemSuggestionAtomicStatus, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc(
		"dismiss_match_review_item_suggestion_atomic",
		{
			p_item_id: itemId,
			p_account_id: accountId,
			p_suggestion_song_id: suggestionSongId ?? undefined,
			p_suggestion_playlist_id: suggestionPlaylistId ?? undefined,
		},
	);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	if (!isDismissQueueItemSuggestionAtomicStatus(data)) {
		return Result.err(
			new DatabaseError({
				code: "unexpected_rpc_result",
				message:
					"dismiss_match_review_item_suggestion_atomic returned an unknown status.",
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
	// Returned when match_review_item_visible_pair has no rows for the item —
	// presentMatchReviewItem must capture pairs before finish can proceed (MSR-28).
	"no_captured_pairs",
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
 *
 * Returns no_captured_pairs if presentMatchReviewItem has not yet run for the
 * item; the TypeScript caller maps this to derive-failed so the item stays
 * pending and finish can be retried after presentation (MSR-28).
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
 * Returns the set of already-applied (snapshot_id, visibility_config_hash)
 * composite keys for this session, encoded as "${snapshotId}:${hash}".
 *
 * The composite PK on (session_id, snapshot_id, visibility_config_hash) allows
 * the same snapshot to be re-applied under a new visibility hash without a
 * conflict — each (snapshot, hash) pair is its own idempotency unit (MSR-19 C9).
 */
export async function fetchAppliedSnapshotIds(
	sessionId: string,
): Promise<Result<Set<string>, DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMany(
		supabase
			.from("match_review_session_snapshot")
			.select("snapshot_id, visibility_config_hash")
			.eq("session_id", sessionId),
	);
	if (Result.isError(result)) return result;
	return Result.ok(
		new Set(
			result.value.map((r) => `${r.snapshot_id}:${r.visibility_config_hash}`),
		),
	);
}

/**
 * Records that a (snapshot, visibility hash) pair has been applied to the
 * session. The composite PK (session_id, snapshot_id, visibility_config_hash)
 * makes a duplicate insert fail with a unique constraint violation — the
 * service treats that as a safe no-op. A new hash for the same snapshot allows
 * an additional row, enabling append-without-duplication when visibility config
 * changes (MSR-19 C9).
 */
export async function insertSessionSnapshot(
	sessionId: string,
	snapshotId: string,
	appendedItemCount: number,
	visibilityConfigHash: string,
): Promise<Result<MatchReviewSessionSnapshotRow, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("match_review_session_snapshot")
			.insert({
				session_id: sessionId,
				snapshot_id: snapshotId,
				appended_item_count: appendedItemCount,
				visibility_config_hash: visibilityConfigHash,
			})
			.select()
			.single(),
	);
}

/**
 * Raw payload returned by the resume_match_review_session RPC. The RPC
 * consolidates 6 serial PostgREST reads into one database call; TypeScript
 * maps these raw shapes to domain types before the service layer sees them.
 */
export interface ResumeMatchReviewSessionRpcResult {
	status: "found" | "no_session";
	session?: {
		id: string;
		account_id: string;
		orientation: string;
		status: string;
		strictness_preset: string;
		strictness_min_score: number;
		created_at: string;
		updated_at: string;
		completed_at: string | null;
	};
	unresolved_count?: number;
	latest_snapshot_id?: string | null;
	applied_snapshots?: Array<{
		snapshot_id: string;
		visibility_config_hash: string;
	}>;
	items?: Array<{
		id: string;
		session_id: string;
		account_id: string;
		orientation: string;
		song_id: string | null;
		playlist_id: string | null;
		source_snapshot_id: string;
		position: number;
		state: string;
		resolution: string | null;
		source_fit_score: number;
		was_new_at_enqueue: boolean;
		presented_at: string | null;
		resolved_at: string | null;
		visible_pairs_captured_at: string | null;
		created_at: string;
		updated_at: string;
	}>;
}

/**
 * Calls the resume_match_review_session RPC which consolidates the 6 serial
 * reads of the common resume path into one database round trip. Returns the
 * raw JSONB payload; the service layer maps it to domain types.
 */
export async function callResumeMatchReviewSession(
	accountId: string,
	orientation: MatchOrientation,
): Promise<Result<ResumeMatchReviewSessionRpcResult, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc("resume_match_review_session", {
		p_account_id: accountId,
		p_orientation: orientation,
	});

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	// The RPC returns JSONB (typed as Json); narrow to the raw payload shape the
	// service layer maps. The SQL function's status union guarantees the shape.
	return Result.ok(data as unknown as ResumeMatchReviewSessionRpcResult);
}

/**
 * Raw payload returned by the present_match_review_item_fast RPC. Collapses
 * the 3-round-trip playlist card fast path (ownership check + playlist row +
 * suggestion read) into one database call.
 */
export interface PresentMatchReviewItemFastRpcResult {
	status:
		| "ready"
		| "not_found"
		| "not_playlist"
		| "not_captured"
		| "playlist_gone"
		| "no_visible_suggestions";
	item?: {
		id: string;
		session_id: string;
		orientation: string;
		playlist_id: string;
		state: string;
		visible_pairs_captured_at: string | null;
	};
	playlist?: {
		id: string;
		spotify_id: string;
		name: string;
		match_intent: string | null;
		image_url: string | null;
		song_count: number;
	};
	suggestions?: Array<{
		song_id: string;
		name: string;
		artists: string[];
		album_name: string | null;
		image_url: string | null;
		spotify_id: string;
		genres: string[];
		fit_score: number;
		visible_rank: number;
		model_rank: number;
	}>;
	total_active_count?: number;
}

/**
 * Calls the present_match_review_item_fast RPC which collapses the 3 serial
 * reads of the captured playlist card path into one database round trip.
 */
export async function callPresentMatchReviewItemFast(
	itemId: string,
	accountId: string,
	limit?: number,
): Promise<Result<PresentMatchReviewItemFastRpcResult, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc("present_match_review_item_fast", {
		p_item_id: itemId,
		p_account_id: accountId,
		p_limit: limit ?? undefined,
	});

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	// The RPC returns JSONB (typed as Json); narrow to the raw payload shape the
	// server layer maps. The SQL function's status union guarantees the shape.
	return Result.ok(data as unknown as PresentMatchReviewItemFastRpcResult);
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

/**
 * Playlist counterpart to fetchPendingSongIds: returns the playlist IDs of the
 * first N pending items in a playlist-orientation session, in queue order.
 * Drives the orientation-aware dashboard/sidebar preview fan (Finding 4).
 */
export async function fetchPendingPlaylistIds(
	sessionId: string,
	limit: number,
): Promise<Result<string[], DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMany(
		supabase
			.from("match_review_queue_item")
			.select("playlist_id")
			.eq("session_id", sessionId)
			.in("state", ["pending", "active"])
			.order("position", { ascending: true })
			.limit(limit),
	);
	if (Result.isError(result)) return result;
	return Result.ok(
		result.value
			.map((r) => r.playlist_id)
			.filter((id): id is string => id !== null),
	);
}

/**
 * Fetches match_filters for all target playlists owned by the account.
 * Used by appendSnapshotDelta to compute the read-time filter hash component
 * of the visibility config hash (MSR-36). Returns a Map from playlist ID to
 * parsed filter config; null means the playlist has no filter set.
 */
export async function fetchTargetPlaylistFilters(
	accountId: string,
): Promise<Result<Map<string, PlaylistMatchFiltersV1 | null>, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("playlist")
		.select("id, match_filters")
		.eq("account_id", accountId)
		.eq("is_target", true);
	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}
	const map = new Map<string, PlaylistMatchFiltersV1 | null>();
	for (const row of data ?? []) {
		if (row.match_filters === null) {
			map.set(row.id, null);
		} else {
			const { value } = parseStoredMatchFilters(row.match_filters);
			map.set(row.id, value);
		}
	}
	return Result.ok(map);
}
