/**
 * DB layer for match_review_deck_job — thin Result wrappers over the deck-job
 * RPCs and direct settlement UPDATEs. Modeled on the audio-feature-backfill
 * jobs layer (src/lib/domains/enrichment/audio-feature-backfill/jobs.ts).
 *
 * Settlement is by direct UPDATE (not a settlement RPC): Phase 1a shipped only
 * claim/sweep/mark_dead — no complete/defer function exists, and the table has
 * no worker-fencing column, so complete/defer/heartbeat are plain status/timing
 * flips scoped by id. `attempts` is already incremented at claim time, so a
 * defer is just re-pending with a future available_at; exhausted attempts are
 * terminalized by mark_dead in the sweep tick.
 *
 * All new-table/RPC access routes through deckDb() (the temporary escape hatch,
 * src/lib/data/deck-db-types.ts) until `gen:types` folds the deck schema into
 * the generated Database.
 */

import { Result } from "better-result";
import type { Json } from "@/lib/data/database.types";
import { type DeckJob, deckDb } from "@/lib/data/deck-db-types";
import type { DbError } from "@/lib/shared/errors/database";
import { DatabaseError } from "@/lib/shared/errors/database";

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
export async function claimDeckJob(): Promise<Result<DeckJob | null, DbError>> {
	const { data, error } = await deckDb().rpc(
		"claim_pending_match_review_deck_job",
		{ p_limit: 1 },
	);
	if (error) return Result.err(dbErr(error));
	return Result.ok(firstRow<DeckJob>(data));
}

/** Refreshes the running lease so the sweep doesn't reclaim an in-flight job. */
export async function heartbeatDeckJob(
	jobId: string,
): Promise<Result<void, DbError>> {
	const { error } = await deckDb()
		.from("match_review_deck_job")
		.update({ heartbeat_at: new Date().toISOString() })
		.eq("id", jobId)
		.eq("status", "running");
	if (error) return Result.err(dbErr(error));
	return Result.ok(undefined);
}

/**
 * Terminalizes a job as completed. 'completed' is outside the idempotency
 * partial index's non-terminal set, so this frees the idempotency_key for a
 * future re-enqueue.
 */
export async function completeDeckJob(
	jobId: string,
): Promise<Result<void, DbError>> {
	const { error } = await deckDb()
		.from("match_review_deck_job")
		.update({ status: "completed" })
		.eq("id", jobId);
	if (error) return Result.err(dbErr(error));
	return Result.ok(undefined);
}

/**
 * Re-queues a job for a later retry. attempts was already consumed at claim, so
 * this only re-pends with a future available_at and clears the heartbeat. If the
 * job has exhausted max_attempts the claim guard skips it and mark_dead
 * terminalizes it on the next sweep.
 */
export async function deferDeckJob(
	jobId: string,
	backoffSeconds: number,
): Promise<Result<void, DbError>> {
	const availableAt = new Date(
		Date.now() + backoffSeconds * 1000,
	).toISOString();
	const { error } = await deckDb()
		.from("match_review_deck_job")
		.update({
			status: "pending",
			available_at: availableAt,
			heartbeat_at: null,
		})
		.eq("id", jobId);
	if (error) return Result.err(dbErr(error));
	return Result.ok(undefined);
}

/** Reclaims running jobs whose heartbeat has gone stale (crashed worker). */
export async function sweepStaleDeckJobs(): Promise<
	Result<DeckJob[], DbError>
> {
	const { data, error } = await deckDb().rpc(
		"sweep_stale_match_review_deck_jobs",
		{},
	);
	if (error) return Result.err(dbErr(error));
	return Result.ok((data ?? []) as DeckJob[]);
}

/** Dead-letters jobs that have exhausted max_attempts. */
export async function markDeadDeckJobs(): Promise<Result<DeckJob[], DbError>> {
	const { data, error } = await deckDb().rpc(
		"mark_dead_match_review_deck_jobs",
		{},
	);
	if (error) return Result.err(dbErr(error));
	return Result.ok((data ?? []) as DeckJob[]);
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
	const { data, error } = await deckDb().rpc("enqueue_match_review_deck_job", {
		p_account_id: input.accountId,
		p_orientation: input.orientation,
		p_kind: input.kind,
		p_idempotency_key: input.idempotencyKey,
		p_session_id: input.sessionId ?? undefined,
		p_payload: input.payload ?? undefined,
	});
	if (error) return Result.err(dbErr(error));
	return Result.ok(firstRow<DeckJob>(data));
}
