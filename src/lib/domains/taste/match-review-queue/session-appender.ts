/**
 * Worker-side append_sessions (plan §11, ruling R1). When a snapshot publishes,
 * newly-visible undecided proposal subjects are appended into each active
 * session's queue — WITHOUT the request-path appendSnapshotDelta.
 *
 * R1 (Phase 5 must be able to delete appendSnapshotDelta): this reads the READY
 * proposal for the account+orientation+snapshot under the active session's
 * frozen-strictness visibility_config_hash, takes its ordered subjects, drops
 * those already in the session's queue, and inserts the rest via the EXISTING
 * insert_queue_song_items / insert_queue_playlist_items RPCs + the
 * match_review_session_snapshot ledger row. It shares the ./queries machinery
 * (insert RPCs + ledger + dedupe + idempotency) with appendSnapshotDelta but not
 * appendSnapshotDelta itself, so that function stays independently deletable.
 *
 * The proposal already excluded build-time-decided subjects; queue-membership
 * dedupe (which includes resolved rows) covers decisions on subjects ever
 * queued. A subject decided in a different session between build and append can
 * transiently append as an empty card — self-healing (the card read derives no
 * visible suggestions and resolves), and near-nil in practice since build chains
 * append back-to-back.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Tables } from "@/lib/data/database.types";
import type { DbError } from "@/lib/shared/errors/database";
import { DatabaseError } from "@/lib/shared/errors/database";
import {
	fetchActiveSession,
	fetchAppliedSnapshotIds,
	fetchMaxPosition,
	fetchQueuedPlaylistIds,
	fetchQueuedSongIds,
	fetchTargetPlaylistFilters,
	insertQueueItems,
	insertQueuePlaylistItems,
	insertSessionSnapshot,
} from "./queries";
import type { MatchOrientation, MatchReviewSession } from "./types";
import {
	computeVisibilityPolicyHash,
	type VisibilityPolicy,
} from "./visibility-policy";

type ProposalSubject = Tables<"match_review_proposal_subject">;

export type AppendSessionsOutcome =
	| { kind: "no_active_session" }
	/** No proposal row exists for the session's frozen hash — never built for
	 *  this (account, orientation, snapshot, hash). Retry later (may still be
	 *  building), and eventual dead-letter is acceptable. */
	| { kind: "no_ready_proposal" }
	/** A proposal row exists for the frozen hash but a NEWER snapshot's publish
	 *  already marked it `stale` before this (older) append ran. The skip is
	 *  CORRECT — settle as done, not a retry/dead-letter (M2). */
	| { kind: "superseded" }
	| { kind: "applied"; appendedCount: number };

/** insertSessionSnapshot treating a duplicate-key ConstraintError as a benign
 *  idempotency no-op — a concurrent append already recorded this (snapshot, hash). */
async function recordSnapshotApplied(
	sessionId: string,
	snapshotId: string,
	appendedItemCount: number,
	visibilityConfigHash: string,
): Promise<Result<void, DbError>> {
	const result = await insertSessionSnapshot(
		sessionId,
		snapshotId,
		appendedItemCount,
		visibilityConfigHash,
	);
	if (Result.isError(result) && result.error._tag !== "ConstraintError") {
		return result;
	}
	return Result.ok(undefined);
}

/** A concurrent append can collide on (session_id, position) — the per-subject
 *  upsert doesn't cover it. Treat that one case as a no-op; else propagate. */
function treatPositionRaceAsNoop(error: DbError): Result<number, DbError> {
	return error._tag === "ConstraintError" ? Result.ok(0) : Result.err(error);
}

export async function appendSessionsForAccountOrientation(input: {
	accountId: string;
	orientation: MatchOrientation;
	snapshotId: string;
}): Promise<Result<AppendSessionsOutcome, DbError>> {
	const { accountId, orientation, snapshotId } = input;

	const sessionResult = await fetchActiveSession(accountId, orientation);
	if (Result.isError(sessionResult)) return sessionResult;
	const session: MatchReviewSession | null = sessionResult.value;
	if (!session) return Result.ok({ kind: "no_active_session" });

	const filtersResult = await fetchTargetPlaylistFilters(accountId);
	if (Result.isError(filtersResult)) return filtersResult;

	// The session's frozen strictness + current target filters + nowMs give the
	// exact hash build_proposals keyed the matching proposal under.
	const policy: VisibilityPolicy = {
		orientation,
		minScore: session.strictnessMinScore,
		filtersByPlaylistId: filtersResult.value,
	};
	const nowMs = Date.now();
	const visibilityHash = computeVisibilityPolicyHash(policy, nowMs);
	const appliedKey = `${snapshotId}:${visibilityHash}`;

	const appliedResult = await fetchAppliedSnapshotIds(session.id);
	if (Result.isError(appliedResult)) return appliedResult;
	if (appliedResult.value.has(appliedKey)) {
		return Result.ok({ kind: "applied", appendedCount: 0 });
	}

	// Read status (not `.eq("status","ready")`) so a proposal that a newer
	// snapshot marked `stale` is distinguishable from one that never existed:
	// the former is a correct skip, the latter a genuine miss (M2).
	const proposalResult = await createAdminSupabaseClient()
		.from("match_review_proposal")
		.select("id, status")
		.eq("account_id", accountId)
		.eq("orientation", orientation)
		.eq("snapshot_id", snapshotId)
		.eq("visibility_config_hash", visibilityHash)
		.maybeSingle();
	if (proposalResult.error) {
		return Result.err(
			new DatabaseError({
				code: proposalResult.error.code,
				message: proposalResult.error.message,
			}),
		);
	}
	if (!proposalResult.data) return Result.ok({ kind: "no_ready_proposal" });
	if (proposalResult.data.status === "stale") {
		return Result.ok({ kind: "superseded" });
	}
	// Still `building` (or `failed`): raced ahead of its build — retry later.
	if (proposalResult.data.status !== "ready") {
		return Result.ok({ kind: "no_ready_proposal" });
	}
	const proposalId = proposalResult.data.id;

	const subjectsResult = await createAdminSupabaseClient()
		.from("match_review_proposal_subject")
		.select("*")
		.eq("proposal_id", proposalId)
		.order("position", { ascending: true });
	if (subjectsResult.error) {
		return Result.err(
			new DatabaseError({
				code: subjectsResult.error.code,
				message: subjectsResult.error.message,
			}),
		);
	}
	const proposalSubjects = (subjectsResult.data ?? []) as ProposalSubject[];

	const queuedResult =
		orientation === "song"
			? await fetchQueuedSongIds(session.id)
			: await fetchQueuedPlaylistIds(session.id);
	if (Result.isError(queuedResult)) return queuedResult;
	const alreadyQueued = queuedResult.value;

	if (orientation === "song") {
		const candidates = proposalSubjects.flatMap((s) =>
			s.song_id !== null && !alreadyQueued.has(s.song_id)
				? [
						{
							songId: s.song_id,
							sourceScore: s.source_fit_score,
							wasNew: s.was_new_at_enqueue,
						},
					]
				: [],
		);

		if (candidates.length === 0) {
			const recorded = await recordSnapshotApplied(
				session.id,
				snapshotId,
				0,
				visibilityHash,
			);
			if (Result.isError(recorded)) return recorded;
			return Result.ok({ kind: "applied", appendedCount: 0 });
		}

		const maxPosResult = await fetchMaxPosition(session.id);
		if (Result.isError(maxPosResult)) return maxPosResult;
		const startPosition = maxPosResult.value + 1;

		const items = candidates.map((c, i) => ({
			sessionId: session.id,
			accountId,
			songId: c.songId,
			sourceSnapshotId: snapshotId,
			position: startPosition + i,
			sourceScore: c.sourceScore,
			wasNewAtEnqueue: c.wasNew,
		}));

		const insertResult = await insertQueueItems(items);
		if (Result.isError(insertResult)) {
			const noop = treatPositionRaceAsNoop(insertResult.error);
			if (Result.isError(noop)) return noop;
			return Result.ok({ kind: "applied", appendedCount: 0 });
		}

		const recorded = await recordSnapshotApplied(
			session.id,
			snapshotId,
			items.length,
			visibilityHash,
		);
		if (Result.isError(recorded)) return recorded;
		return Result.ok({ kind: "applied", appendedCount: items.length });
	}

	const candidates = proposalSubjects.flatMap((s) =>
		s.playlist_id !== null && !alreadyQueued.has(s.playlist_id)
			? [{ playlistId: s.playlist_id, sourceScore: s.source_fit_score }]
			: [],
	);

	if (candidates.length === 0) {
		const recorded = await recordSnapshotApplied(
			session.id,
			snapshotId,
			0,
			visibilityHash,
		);
		if (Result.isError(recorded)) return recorded;
		return Result.ok({ kind: "applied", appendedCount: 0 });
	}

	const maxPosResult = await fetchMaxPosition(session.id);
	if (Result.isError(maxPosResult)) return maxPosResult;
	const startPosition = maxPosResult.value + 1;

	const items = candidates.map((c, i) => ({
		sessionId: session.id,
		accountId,
		playlistId: c.playlistId,
		sourceSnapshotId: snapshotId,
		position: startPosition + i,
		sourceScore: c.sourceScore,
		// Playlist subjects never carry a newness flag (MSR-19 scope).
		wasNewAtEnqueue: false,
	}));

	const insertResult = await insertQueuePlaylistItems(items);
	if (Result.isError(insertResult)) {
		const noop = treatPositionRaceAsNoop(insertResult.error);
		if (Result.isError(noop)) return noop;
		return Result.ok({ kind: "applied", appendedCount: 0 });
	}

	const recorded = await recordSnapshotApplied(
		session.id,
		snapshotId,
		items.length,
		visibilityHash,
	);
	if (Result.isError(recorded)) return recorded;
	return Result.ok({ kind: "applied", appendedCount: items.length });
}
