import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Job } from "@/lib/platform/jobs/repository";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import {
	fromSupabaseMany,
	fromSupabaseMaybe,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";
import type { LibraryProcessingState } from "./types";

type StateRow =
	import("@/lib/data/database.types").Tables<"library_processing_state">;

function toState(row: StateRow): LibraryProcessingState {
	return {
		accountId: row.account_id,
		enrichment: {
			requestedAt: row.enrichment_requested_at,
			settledAt: row.enrichment_settled_at,
			activeJobId: row.enrichment_active_job_id,
		},
		matchSnapshotRefresh: {
			requestedAt: row.match_snapshot_refresh_requested_at,
			settledAt: row.match_snapshot_refresh_settled_at,
			activeJobId: row.match_snapshot_refresh_active_job_id,
		},
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export async function loadLibraryProcessingState(
	accountId: string,
): Promise<Result<LibraryProcessingState | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMaybe(
		supabase
			.from("library_processing_state")
			.select("*")
			.eq("account_id", accountId)
			.single(),
	);
	if (Result.isError(result)) return result;
	return Result.ok(result.value ? toState(result.value) : null);
}

export async function getOrCreateLibraryProcessingState(
	accountId: string,
): Promise<Result<LibraryProcessingState, DbError>> {
	const existing = await loadLibraryProcessingState(accountId);
	if (Result.isError(existing)) return existing;
	if (existing.value) return Result.ok(existing.value);

	const supabase = createAdminSupabaseClient();
	const created = await fromSupabaseSingle(
		supabase
			.from("library_processing_state")
			.insert({ account_id: accountId })
			.select()
			.single(),
	);
	if (Result.isError(created)) {
		// Concurrent insert race — read the winner's row
		if (created.error._tag === "ConstraintError") {
			const retry = await loadLibraryProcessingState(accountId);
			if (Result.isError(retry)) return retry;
			if (retry.value) return Result.ok(retry.value);
		}
		return created;
	}
	return Result.ok(toState(created.value));
}

export async function findStatesWithoutEnrichmentActiveJob(): Promise<
	Result<LibraryProcessingState[], DbError>
> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMany(
		supabase
			.from("library_processing_state")
			.select("*")
			.is("enrichment_active_job_id", null),
	);
	if (Result.isError(result)) return result;
	return Result.ok(result.value.map(toState));
}

export type TerminalActiveRef = {
	state: LibraryProcessingState;
	workflow: "enrichment" | "match_snapshot_refresh";
	job: Job;
};

export async function findTerminalActiveRefs(): Promise<
	Result<TerminalActiveRef[], DbError>
> {
	const supabase = createAdminSupabaseClient();

	// Each active job is embedded through its FK and filtered to terminal status
	// in the same request, so no job-id list is sent back through a URL.
	const { data: rows, error } = await supabase
		.from("library_processing_state")
		.select(
			"*, enrichment_job:job!library_processing_state_enrichment_active_job_id_fkey(*), refresh_job:job!library_processing_state_match_snapshot_refresh_active_job_fkey(*)",
		)
		.or(
			"enrichment_active_job_id.not.is.null,match_snapshot_refresh_active_job_id.not.is.null",
		)
		.in("enrichment_job.status", ["completed", "failed"])
		.in("refresh_job.status", ["completed", "failed"]);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	const refs: TerminalActiveRef[] = [];
	// The embeds are non-inner so one terminal ref still comes back while the
	// other is running; rows whose refs are all running yield nothing here.
	for (const { enrichment_job, refresh_job, ...row } of rows ?? []) {
		const state = toState(row);
		if (enrichment_job) {
			refs.push({ state, workflow: "enrichment", job: enrichment_job });
		}
		if (refresh_job) {
			refs.push({
				state,
				workflow: "match_snapshot_refresh",
				job: refresh_job,
			});
		}
	}

	return Result.ok(refs);
}

/**
 * Compare-and-set write of a reconciled state: applies only while the row still
 * carries the updated_at it was loaded with (a trigger bumps it on every write,
 * settlement's raw SQL included). `ok(null)` means another runtime wrote first;
 * the caller reloads and reconciles again instead of writing stale columns back.
 */
export async function persistLibraryProcessingState(
	state: LibraryProcessingState,
): Promise<Result<LibraryProcessingState | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMaybe(
		supabase
			.from("library_processing_state")
			.update({
				enrichment_requested_at: state.enrichment.requestedAt,
				enrichment_settled_at: state.enrichment.settledAt,
				enrichment_active_job_id: state.enrichment.activeJobId,
				match_snapshot_refresh_requested_at:
					state.matchSnapshotRefresh.requestedAt,
				match_snapshot_refresh_settled_at: state.matchSnapshotRefresh.settledAt,
				match_snapshot_refresh_active_job_id:
					state.matchSnapshotRefresh.activeJobId,
			})
			.eq("account_id", state.accountId)
			.eq("updated_at", state.updatedAt)
			.select()
			.maybeSingle(),
	);
	if (Result.isError(result)) return result;
	return Result.ok(result.value ? toState(result.value) : null);
}

/**
 * Moves one workflow's active job ref from `from` to `to` only if it still
 * holds `from`, so a settle or apply that landed meanwhile is never
 * overwritten. `ok(false)` means the ref moved underneath; the ensured job
 * still runs and settles on its own.
 */
export async function swapActiveJobRef(
	accountId: string,
	workflow: "enrichment" | "match_snapshot_refresh",
	from: string | null,
	to: string | null,
): Promise<Result<boolean, DbError>> {
	const supabase = createAdminSupabaseClient();
	const column =
		workflow === "enrichment"
			? "enrichment_active_job_id"
			: "match_snapshot_refresh_active_job_id";
	const values =
		workflow === "enrichment"
			? { enrichment_active_job_id: to }
			: { match_snapshot_refresh_active_job_id: to };
	const update = supabase
		.from("library_processing_state")
		.update(values)
		.eq("account_id", accountId);
	const guarded =
		from === null ? update.is(column, null) : update.eq(column, from);
	const result = await fromSupabaseMaybe(
		guarded.select("account_id").maybeSingle(),
	);
	if (Result.isError(result)) return result;
	return Result.ok(result.value !== null);
}
