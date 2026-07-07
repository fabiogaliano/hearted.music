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
import { getLatestMatchSnapshot } from "@/lib/domains/taste/song-matching/queries";
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
	/** The job's snapshot is no longer the account's latest (H2b) — caught
	 *  directly against getLatestMatchSnapshot, or via the proposal's own
	 *  `stale` flag already flipped by a concurrent newer-snapshot build. The
	 *  skip is CORRECT — settle as done, not a retry/dead-letter. */
	| { kind: "superseded" }
	| {
			kind: "applied";
			appendedCount: number;
			/** The session the append ran against, so the poll loop can chain a
			 *  capture_ahead job for this session's resume region when
			 *  appendedCount > 0 (M5). */
			sessionId: string;
	  };

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

/**
 * Records the ledger row and, only when subjects actually landed, advances the
 * session's `active_proposal_id` to the just-applied proposal (M11): branch 1
 * of start_or_resume_match_deck reads snapshot/hash/hidden-review-count through
 * that FK, so leaving it pointed at a pre-append proposal leaks superseded
 * metadata into the view once a newer snapshot has appended into the session.
 * Gated on appendedCount > 0 — a zero-count replay changes nothing the FK needs
 * to reflect, the same gate the poll loop uses to chain capture_ahead (M5).
 */
async function finalizeAppliedAppend(
	session: MatchReviewSession,
	proposalId: string,
	snapshotId: string,
	visibilityConfigHash: string,
	appendedCount: number,
): Promise<Result<AppendSessionsOutcome, DbError>> {
	const recorded = await recordSnapshotApplied(
		session.id,
		snapshotId,
		appendedCount,
		visibilityConfigHash,
	);
	if (Result.isError(recorded)) return recorded;

	if (appendedCount > 0) {
		const { error } = await createAdminSupabaseClient()
			.from("match_review_session")
			.update({ active_proposal_id: proposalId })
			.eq("id", session.id);
		if (error) {
			return Result.err(
				new DatabaseError({ code: error.code, message: error.message }),
			);
		}
	}

	return Result.ok({ kind: "applied", appendedCount, sessionId: session.id });
}

/** Row shape read by fetchProposalForSnapshotHash — just enough to route the
 *  ready/stale/building/missing branches shared by the apply and replay paths. */
type ProposalStatusLookup = { id: string; status: string };

/**
 * Looks up the proposal for this exact (account, orientation, snapshot,
 * visibility hash) key — the same match_review_proposal row both the apply
 * path (below) and the idempotency-replay self-heal
 * (advanceActiveProposalOnReplay) resolve `active_proposal_id` from. Scoping on
 * all four columns means the row returned can never belong to another account
 * or a different snapshot/hash than the one this job is running for.
 */
async function fetchProposalForSnapshotHash(
	accountId: string,
	orientation: MatchOrientation,
	snapshotId: string,
	visibilityHash: string,
): Promise<Result<ProposalStatusLookup | null, DbError>> {
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
	return Result.ok(proposalResult.data);
}

/**
 * Self-heals a stranded `active_proposal_id` on the idempotency-replay path
 * (M11 follow-up): finalizeAppliedAppend's ledger INSERT and its
 * `active_proposal_id` UPDATE are two separate non-transactional calls. If the
 * INSERT commits but the UPDATE then errors (transient blip), the function
 * returns Result.err and the job defers/retries — but on retry the appliedKey
 * short-circuit above fires (the ledger row already exists) and returns before
 * finalizeAppliedAppend, and thus the UPDATE, ever runs again. Without this,
 * `active_proposal_id` would stay pointed at the pre-append proposal forever.
 *
 * Re-derives the exact ready proposal the original apply would have advanced
 * to (same (account, orientation, snapshot, hash) lookup as the apply path) and
 * re-issues the same UPDATE, scoped to this session's id. The UPDATE is
 * idempotent — setting `active_proposal_id` to the value it should already
 * hold is a no-op — so replaying it on every already-applied hit is safe.
 *
 * Failure handling mirrors finalizeAppliedAppend's own UPDATE: a query or
 * update error is propagated (Result.err) so the job defers and retries on the
 * normal job retry/dead-letter policy — the ledger row is already durable, so
 * this can't loop forever, and retrying is exactly what re-attempts the FK
 * write. A proposal that isn't `ready` (still building, gone stale, or not
 * found under this hash) is NOT an error: the advance is simply deferred to
 * whichever future append job first finds a ready proposal for this key.
 */
async function advanceActiveProposalOnReplay(
	session: MatchReviewSession,
	accountId: string,
	orientation: MatchOrientation,
	snapshotId: string,
	visibilityHash: string,
): Promise<Result<AppendSessionsOutcome, DbError>> {
	const proposalResult = await fetchProposalForSnapshotHash(
		accountId,
		orientation,
		snapshotId,
		visibilityHash,
	);
	if (Result.isError(proposalResult)) return proposalResult;

	if (proposalResult.value?.status === "ready") {
		const { error } = await createAdminSupabaseClient()
			.from("match_review_session")
			.update({ active_proposal_id: proposalResult.value.id })
			.eq("id", session.id);
		if (error) {
			return Result.err(
				new DatabaseError({ code: error.code, message: error.message }),
			);
		}
	}

	return Result.ok({
		kind: "applied",
		appendedCount: 0,
		sessionId: session.id,
	});
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

	// H2(b): a delayed/retried append must never re-apply a SUPERSEDED
	// snapshot's subjects into the active session — the subject set may now be
	// ineligible (unowned playlist, revoked entitlement) since a newer snapshot
	// published. Check directly against the account's latest snapshot rather
	// than relying solely on the proposal's own `stale` flag (flipped by
	// buildProposalsForAccountOrientation) having already landed.
	const latestSnapshotResult = await getLatestMatchSnapshot(accountId);
	if (Result.isError(latestSnapshotResult)) return latestSnapshotResult;
	if (latestSnapshotResult.value?.id !== snapshotId) {
		return Result.ok({ kind: "superseded" });
	}

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
		// Fix (M11 follow-up): don't just short-circuit — self-heal a possibly
		// stranded active_proposal_id from a prior partial failure (ledger
		// INSERT committed, FK UPDATE didn't) before returning. See
		// advanceActiveProposalOnReplay for why this can't loop forever.
		return advanceActiveProposalOnReplay(
			session,
			accountId,
			orientation,
			snapshotId,
			visibilityHash,
		);
	}

	// Read status (not `.eq("status","ready")`) so a proposal that a newer
	// snapshot marked `stale` is distinguishable from one that never existed:
	// the former is a correct skip, the latter a genuine miss (M2).
	const proposalResult = await fetchProposalForSnapshotHash(
		accountId,
		orientation,
		snapshotId,
		visibilityHash,
	);
	if (Result.isError(proposalResult)) return proposalResult;
	if (!proposalResult.value) return Result.ok({ kind: "no_ready_proposal" });
	if (proposalResult.value.status === "stale") {
		return Result.ok({ kind: "superseded" });
	}
	// Still `building` (or `failed`): raced ahead of its build — retry later.
	if (proposalResult.value.status !== "ready") {
		return Result.ok({ kind: "no_ready_proposal" });
	}
	const proposalId = proposalResult.value.id;

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
			return finalizeAppliedAppend(
				session,
				proposalId,
				snapshotId,
				visibilityHash,
				0,
			);
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

		// M3: queries.ts collapses every postgres constraint violation (23505,
		// 23503, 23514) into ConstraintError, so ANY constraint hit here — not
		// just a (session_id, position) collision from a concurrent append —
		// is treated as a genuine race, not a safe no-op: swallowing it would
		// mean the ledger row below never gets written and the batch silently
		// vanishes with no retry. Propagate the error so the job DEFERS; the
		// common/expected case is the position race, and positions are
		// recomputed fresh (fetchMaxPosition re-reads current state) on the
		// retry, with the insert RPC's `ON CONFLICT DO NOTHING` making
		// re-inserting the already-landed subjects idempotent.
		const insertResult = await insertQueueItems(items);
		if (Result.isError(insertResult)) return insertResult;

		return finalizeAppliedAppend(
			session,
			proposalId,
			snapshotId,
			visibilityHash,
			items.length,
		);
	}

	const candidates = proposalSubjects.flatMap((s) =>
		s.playlist_id !== null && !alreadyQueued.has(s.playlist_id)
			? [{ playlistId: s.playlist_id, sourceScore: s.source_fit_score }]
			: [],
	);

	if (candidates.length === 0) {
		return finalizeAppliedAppend(
			session,
			proposalId,
			snapshotId,
			visibilityHash,
			0,
		);
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

	// M3: see the song-arm comment above — any ConstraintError from the insert
	// (the common/expected case being the position race, not the only one) must
	// defer-and-retry, not silently no-op past the ledger write.
	const insertResult = await insertQueuePlaylistItems(items);
	if (Result.isError(insertResult)) return insertResult;

	return finalizeAppliedAppend(
		session,
		proposalId,
		snapshotId,
		visibilityHash,
		items.length,
	);
}
