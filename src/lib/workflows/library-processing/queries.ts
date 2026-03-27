import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { DbError } from "@/lib/shared/errors/database";
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
