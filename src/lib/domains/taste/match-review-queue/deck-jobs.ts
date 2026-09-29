/**
 * DB layer for match_review_deck_job — thin Result wrappers over the deck-job
 * RPCs and direct settlement UPDATEs. Modeled on the audio-feature-backfill
 * jobs layer (src/lib/domains/enrichment/audio-feature-backfill/jobs.ts).
 *
 * Settlement is by direct UPDATE (not a settlement RPC), compare-and-set on
 * (id, status = 'running', locked_by = the claim token): a sweep can re-pend a
 * stalled job and another worker reclaim it, and the stalled run's late
 * settle/heartbeat must not land on the new run. `attempts` is already
 * incremented at claim time, so a defer is just re-pending with a future
 * available_at; exhausted attempts are terminalized by mark_dead in the sweep
 * tick.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Json, Tables } from "@/lib/data/database.types";
import type { DbError } from "@/lib/shared/errors/database";
import { DatabaseError } from "@/lib/shared/errors/database";

/** The deck-job row shape, exported for the DB layer + worker dispatch. */
export type DeckJob = Tables<"match_review_deck_job">;

/** A job this worker holds the lease on; `locked_by` fences its settlement. */
export type ClaimedDeckJob = DeckJob & { locked_by: string };

function dbErr(error: { code?: string; message: string }): DbError {
	return new DatabaseError({
		code: error.code ?? "rpc_error",
		message: error.message,
	});
}

/** A SETOF composite arrives as an array; single composite as an object. */
function firstRow<T>(data: unknown): T | null {
	if (Array.isArray(data)) return (data[0] as T) ?? null;
	return (data as T) ?? null;
}

/**
 * Claims the next pending deck job. Poll concurrency is 1 and this is always
 * called with p_limit=1: the claim function's NOT EXISTS self-join guarantees
 * per-(account, orientation) serialization only for committed running rows, so
 * batching (p_limit > 1) is unsafe (decisions log Phase 1a). Returns the claimed
 * job or null when nothing is claimable.
 */
export async function claimDeckJob(): Promise<
	Result<ClaimedDeckJob | null, DbError>
> {
	const { data, error } = await createAdminSupabaseClient().rpc(
		"claim_pending_match_review_deck_job",
		{ p_limit: 1 },
	);
	if (error) return Result.err(dbErr(error));
	const job = firstRow<DeckJob>(data);
	if (!job) return Result.ok(null);
	const lockedBy = job.locked_by;
	if (lockedBy === null) {
		return Result.err(
			new DatabaseError({
				code: "deck_job_claim_token_missing",
				message: `deck job ${job.id} was claimed without a claim token`,
			}),
		);
	}
	return Result.ok({ ...job, locked_by: lockedBy });
}

/**
 * Refreshes the running lease so the sweep doesn't reclaim an in-flight job.
 * Ok(false) means the claim is lost (swept, reclaimed, or dead-lettered): the
 * run no longer owns the job and must stop.
 */
export async function heartbeatDeckJob(
	jobId: string,
	claimToken: string,
): Promise<Result<boolean, DbError>> {
	const { data, error } = await createAdminSupabaseClient()
		.from("match_review_deck_job")
		.update({ heartbeat_at: new Date().toISOString() })
		.eq("id", jobId)
		.eq("status", "running")
		.eq("locked_by", claimToken)
		.select("id")
		.maybeSingle();
	if (error) return Result.err(dbErr(error));
	return Result.ok(data !== null);
}

/**
 * Terminalizes a job as completed. 'completed' is outside the idempotency
 * partial index's non-terminal set, so this frees the idempotency_key for a
 * future re-enqueue.
 *
 * The status guard stops a late-finishing handler from resurrecting a job
 * mark_dead already terminalized; the claim-token guard stops it from
 * completing a newer run of the same job.
 */
export async function completeDeckJob(
	jobId: string,
	claimToken: string,
): Promise<Result<boolean, DbError>> {
	const { data, error } = await createAdminSupabaseClient()
		.from("match_review_deck_job")
		.update({ status: "completed" })
		.eq("id", jobId)
		.eq("status", "running")
		.eq("locked_by", claimToken)
		.select("id")
		.maybeSingle();
	if (error) return Result.err(dbErr(error));
	return Result.ok(data !== null);
}

/**
 * Re-queues a job for a later retry. attempts was already consumed at claim, so
 * this only re-pends with a future available_at and clears the heartbeat. If the
 * job has exhausted max_attempts the claim guard skips it and mark_dead
 * terminalizes it on the next sweep.
 *
 * Fenced like completeDeckJob: neither a dead-lettered job nor a newer run of
 * this job may be re-pended by a late-finishing handler.
 */
export async function deferDeckJob(
	jobId: string,
	claimToken: string,
	backoffSeconds: number,
): Promise<Result<boolean, DbError>> {
	const availableAt = new Date(
		Date.now() + backoffSeconds * 1000,
	).toISOString();
	const { data, error } = await createAdminSupabaseClient()
		.from("match_review_deck_job")
		.update({
			status: "pending",
			available_at: availableAt,
			heartbeat_at: null,
			locked_by: null,
		})
		.eq("id", jobId)
		.eq("status", "running")
		.eq("locked_by", claimToken)
		.select("id")
		.maybeSingle();
	if (error) return Result.err(dbErr(error));
	return Result.ok(data !== null);
}

/**
 * Hands back a job claimed but never run (the poll loop stopped mid-claim),
 * refunding the attempt the claim consumed so a job claimed on its final
 * attempt during a deploy isn't dead-lettered without running.
 *
 * The refund is a plain value, not `attempts - 1` in SQL: attempts only moves
 * at claim, which requires 'pending', so while status = 'running' and
 * locked_by = this claim's token it still equals the value the claim returned.
 * The same fence makes a stale release a no-op on a reclaimed run.
 */
export async function releaseDeckJob(
	job: ClaimedDeckJob,
): Promise<Result<boolean, DbError>> {
	const { data, error } = await createAdminSupabaseClient()
		.from("match_review_deck_job")
		.update({
			status: "pending",
			attempts: job.attempts - 1,
			heartbeat_at: null,
			locked_by: null,
		})
		.eq("id", job.id)
		.eq("status", "running")
		.eq("locked_by", job.locked_by)
		.select("id")
		.maybeSingle();
	if (error) return Result.err(dbErr(error));
	return Result.ok(data !== null);
}

/** Reclaims running jobs whose heartbeat has gone stale (crashed worker). */
export async function sweepStaleDeckJobs(
	leaseSeconds: number,
): Promise<Result<DeckJob[], DbError>> {
	const { data, error } = await createAdminSupabaseClient().rpc(
		"sweep_stale_match_review_deck_jobs",
		{ p_lease_seconds: leaseSeconds },
	);
	if (error) return Result.err(dbErr(error));
	return Result.ok((data ?? []) as DeckJob[]);
}

/**
 * Dead-letters jobs that have exhausted max_attempts. `leaseSeconds` must
 * match the value passed to `sweepStaleDeckJobs` (H1): a 'running' job only
 * dead-letters once its heartbeat is older than the same lease sweep uses to
 * reclaim it — otherwise a job on its final attempt could be marked dead
 * while still genuinely executing.
 */
export async function markDeadDeckJobs(
	leaseSeconds: number,
): Promise<Result<DeckJob[], DbError>> {
	const { data, error } = await createAdminSupabaseClient().rpc(
		"mark_dead_match_review_deck_jobs",
		{ p_lease_seconds: leaseSeconds },
	);
	if (error) return Result.err(dbErr(error));
	return Result.ok((data ?? []) as DeckJob[]);
}

/**
 * Looks up an in-flight (pending or running) `build_proposals` job for this
 * (account, orientation) — the request-path miss handler (match-deck-miss-path.ts,
 * P0 race fix) uses this to defer to the worker instead of running the same
 * five-call, non-transactional build concurrently with it. A plain `.eq()`/`.in()`
 * lookup on the job table's own columns, not a DB-derived id set re-entering as
 * an `.in()` filter.
 */
export async function findInFlightBuildProposalsJob(
	accountId: string,
	orientation: string,
): Promise<Result<DeckJob | null, DbError>> {
	const { data, error } = await createAdminSupabaseClient()
		.from("match_review_deck_job")
		.select("*")
		.eq("account_id", accountId)
		.eq("orientation", orientation)
		.eq("kind", "build_proposals")
		.in("status", ["pending", "running"])
		.limit(1)
		.maybeSingle();
	if (error) return Result.err(dbErr(error));
	return Result.ok(data);
}

export interface EnqueueDeckJobInput {
	accountId: string;
	orientation: string;
	kind: "build_proposals" | "append_sessions" | "capture_ahead" | "repair";
	idempotencyKey: string;
	sessionId?: string | null;
	payload?: Json;
}

/**
 * Enqueues a deck job via the RPC (the only way to express the partial-index
 * ON CONFLICT dedupe). Returns the inserted job, or null when a non-terminal job
 * for the same idempotency_key already exists (DO NOTHING — a benign dedupe).
 */
export async function enqueueDeckJob(
	input: EnqueueDeckJobInput,
): Promise<Result<DeckJob | null, DbError>> {
	const { data, error } = await createAdminSupabaseClient().rpc(
		"enqueue_match_review_deck_job",
		{
			p_account_id: input.accountId,
			p_orientation: input.orientation,
			p_kind: input.kind,
			p_idempotency_key: input.idempotencyKey,
			p_session_id: input.sessionId ?? undefined,
			p_payload: input.payload ?? undefined,
		},
	);
	if (error) return Result.err(dbErr(error));
	return Result.ok(firstRow<DeckJob>(data));
}
