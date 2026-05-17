import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Job } from "@/lib/platform/jobs/repository";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import {
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

export type TerminalActiveRef = {
	state: LibraryProcessingState;
	workflow: "enrichment" | "match_snapshot_refresh";
	job: Job;
};

export async function findTerminalActiveRefs(): Promise<
	Result<TerminalActiveRef[], DbError>
> {
	const supabase = createAdminSupabaseClient();

	const { data: rows, error } = await supabase
		.from("library_processing_state")
		.select("*")
		.or(
			"enrichment_active_job_id.not.is.null,match_snapshot_refresh_active_job_id.not.is.null",
		);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	if (!rows || rows.length === 0) {
		return Result.ok([]);
	}

	const jobIds = new Set<string>();
	for (const row of rows) {
		if (row.enrichment_active_job_id) jobIds.add(row.enrichment_active_job_id);
		if (row.match_snapshot_refresh_active_job_id)
			jobIds.add(row.match_snapshot_refresh_active_job_id);
	}

	const { data: jobs, error: jobError } = await supabase
		.from("job")
		.select("*")
		.in("id", [...jobIds])
		.in("status", ["completed", "failed"]);

	if (jobError) {
		return Result.err(
			new DatabaseError({ code: jobError.code, message: jobError.message }),
		);
	}

	const terminalJobMap = new Map<string, Job>();
	for (const job of jobs ?? []) {
		terminalJobMap.set(job.id, job as Job);
	}

	const refs: TerminalActiveRef[] = [];
	for (const row of rows) {
		const state = toState(row);
		if (row.enrichment_active_job_id) {
			const job = terminalJobMap.get(row.enrichment_active_job_id);
			if (job) refs.push({ state, workflow: "enrichment", job });
		}
		if (row.match_snapshot_refresh_active_job_id) {
			const job = terminalJobMap.get(row.match_snapshot_refresh_active_job_id);
			if (job) refs.push({ state, workflow: "match_snapshot_refresh", job });
		}
	}

	return Result.ok(refs);
}

export async function persistLibraryProcessingState(
	state: LibraryProcessingState,
): Promise<Result<LibraryProcessingState, DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseSingle(
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
			.select()
			.single(),
	);
	if (Result.isError(result)) return result;
	return Result.ok(toState(result.value));
}
