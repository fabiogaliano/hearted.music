/**
 * Data-access for the asynchronous extension_sync parent job.
 *
 * `beginExtensionSync` is the one atomic ingress the slim route calls; the
 * progress parser is what the Bun worker uses to recover the staged payload
 * pointer and phase ids from the claimed parent row.
 */

import { Result } from "better-result";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/data/client";
import {
	type PhaseJobIds,
	PhaseJobIdsSchema,
} from "@/lib/platform/jobs/progress/types";
import type { Job } from "@/lib/platform/jobs/repository";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import { fromSupabaseMany } from "@/lib/shared/utils/result-wrappers/supabase";

export type BeginExtensionSyncOutcome =
	| { kind: "queued"; jobId: string; phaseJobIds: PhaseJobIds }
	| { kind: "active"; jobId: string }
	| { kind: "cooldown"; retryAfterSeconds: number };

// The RPC returns exactly one of these jsonb shapes. Validating here turns a
// silent shape drift (e.g. a future RPC edit) into a typed error instead of an
// undefined-property crash downstream.
const BeginResultSchema = z.union([
	z.object({ active: z.literal(true), jobId: z.uuid() }),
	z.object({
		cooldown: z.literal(true),
		retryAfterSeconds: z.number().int().positive(),
	}),
	z.object({ jobId: z.uuid(), phaseJobIds: PhaseJobIdsSchema }),
]);

export async function beginExtensionSync(
	accountId: string,
	payloadPath: string,
	payloadBytes: number,
): Promise<Result<BeginExtensionSyncOutcome, DbError>> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc("begin_extension_sync", {
		p_account_id: accountId,
		p_payload_path: payloadPath,
		p_payload_bytes: payloadBytes,
	});

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	const parsed = BeginResultSchema.safeParse(data);
	if (!parsed.success) {
		return Result.err(
			new DatabaseError({
				code: "begin_extension_sync_bad_shape",
				message: parsed.error.message,
			}),
		);
	}

	const value = parsed.data;
	if ("active" in value) {
		return Result.ok({ kind: "active", jobId: value.jobId });
	}
	if ("cooldown" in value) {
		return Result.ok({
			kind: "cooldown",
			retryAfterSeconds: value.retryAfterSeconds,
		});
	}
	return Result.ok({
		kind: "queued",
		jobId: value.jobId,
		phaseJobIds: value.phaseJobIds,
	});
}

// Shape of the extension_sync parent job's `progress` jsonb, written by
// begin_extension_sync. payload_bytes is informational; only payload_path and
// phase_job_ids are load-bearing for the worker.
export const ExtensionSyncJobProgressSchema = z.object({
	payload_path: z.string().min(1),
	payload_bytes: z.number().optional(),
	phase_job_ids: PhaseJobIdsSchema,
});
export type ExtensionSyncJobProgress = z.infer<
	typeof ExtensionSyncJobProgressSchema
>;

export function parseExtensionSyncJobProgress(
	progress: unknown,
): Result<ExtensionSyncJobProgress, DbError> {
	const parsed = ExtensionSyncJobProgressSchema.safeParse(progress);
	if (!parsed.success) {
		return Result.err(
			new DatabaseError({
				code: "extension_sync_progress_bad_shape",
				message: parsed.error.message,
			}),
		);
	}
	return Result.ok(parsed.data);
}

/**
 * Claims the oldest pending extension_sync parent job (SKIP LOCKED). Returns
 * null when the queue is empty. Dedicated RPC so a stuck sync can never starve
 * the library-processing claim path.
 */
export async function claimExtensionSyncJob(): Promise<
	Result<Job | null, DbError>
> {
	const supabase = createAdminSupabaseClient();

	// The RPC is a SETOF function — always an array (0 or 1 rows) per the
	// generated Database types — so fromSupabaseMany's `T[]` shape applies
	// directly; no single-vs-array hedge needed.
	const rowsResult = await fromSupabaseMany<Job>(
		supabase.rpc("claim_pending_extension_sync_job"),
	);
	return Result.map(rowsResult, (rows) => rows[0] ?? null);
}

/**
 * Requeues running extension_sync jobs whose heartbeat went stale while attempts
 * remain, so a crashed worker's in-flight sync gets retried. Re-running is safe:
 * every sync write is an idempotent upsert/diff.
 */
export async function sweepStaleExtensionSyncJobs(
	staleThreshold: string,
): Promise<Result<Job[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany<Job>(
		supabase.rpc("sweep_stale_extension_sync_jobs", {
			stale_threshold: staleThreshold,
		}),
	);
}

/**
 * Strips the payload_path pointer from terminal extension_sync jobs and returns
 * each (job_id, account_id, payload_path) exactly once so the worker can
 * best-effort delete the Storage object. SKIP LOCKED so concurrent sweep ticks
 * never double-process the same row.
 */
export async function claimExtensionSyncPayloadCleanup(): Promise<
	Result<{ jobId: string; accountId: string; payloadPath: string }[], DbError>
> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc(
		"claim_extension_sync_payload_cleanup",
	);
	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}
	return Result.ok(
		(data ?? []).map((r) => ({
			jobId: r.job_id,
			accountId: r.account_id,
			payloadPath: r.payload_path,
		})),
	);
}

/**
 * Dead-letters running extension_sync jobs that exhausted their attempts. The
 * returned rows still carry the payload pointer in `progress`, so the caller can
 * delete the now-orphaned Storage object.
 */
export async function markDeadExtensionSyncJobs(
	staleThreshold: string,
): Promise<Result<Job[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany<Job>(
		supabase.rpc("mark_dead_extension_sync_jobs", {
			stale_threshold: staleThreshold,
		}),
	);
}
