/**
 * Dev-only warm reset for library-processing flows.
 *
 * Clears account-scoped processing outputs while preserving shared
 * song artifacts (audio features, genres, analysis, embeddings).
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { markJobFailed } from "@/lib/data/jobs";
import {
	persistLibraryProcessingState,
	loadLibraryProcessingState,
} from "../queries";
import type { LibraryProcessingState } from "../types";

export interface WarmResetResult {
	cancelledJobs: number;
	clearedItemStatuses: number;
	clearedMatchContexts: number;
}

export interface MatchOnlyResetResult {
	cancelledJobs: number;
	clearedMatchContexts: number;
}

/**
 * Full warm replay reset — clears all account-scoped processing outputs.
 * Preserves shared song artifacts (global audio features, analysis, embeddings, genres).
 */
export async function warmReplayReset(
	accountId: string,
): Promise<WarmResetResult> {
	const supabase = createAdminSupabaseClient();

	const cancelledJobs = await cancelActiveLibraryProcessingJobs(
		supabase,
		accountId,
	);

	const { data: deletedStatuses } = await supabase
		.from("item_status")
		.delete()
		.eq("account_id", accountId)
		.select("item_id");

	const clearedMatchContexts = await clearMatchSnapshots(supabase, accountId);

	await resetLibraryProcessingState(accountId);

	return {
		cancelledJobs,
		clearedItemStatuses: deletedStatuses?.length ?? 0,
		clearedMatchContexts,
	};
}

/**
 * Narrower reset — clears only match snapshot output and refresh state.
 */
export async function matchOnlyReset(
	accountId: string,
): Promise<MatchOnlyResetResult> {
	const supabase = createAdminSupabaseClient();

	const cancelledRefreshJobs = await cancelActiveJobsByType(
		supabase,
		accountId,
		"match_snapshot_refresh",
	);

	const clearedMatchContexts = await clearMatchSnapshots(supabase, accountId);

	const stateResult = await loadLibraryProcessingState(accountId);
	if (Result.isOk(stateResult) && stateResult.value) {
		const state = stateResult.value;
		await persistLibraryProcessingState({
			...state,
			matchSnapshotRefresh: {
				requestedAt: null,
				settledAt: null,
				activeJobId: null,
			},
		});
	}

	return {
		cancelledJobs: cancelledRefreshJobs,
		clearedMatchContexts,
	};
}

async function cancelActiveLibraryProcessingJobs(
	supabase: ReturnType<typeof createAdminSupabaseClient>,
	accountId: string,
): Promise<number> {
	const enrichmentCount = await cancelActiveJobsByType(
		supabase,
		accountId,
		"enrichment",
	);
	const refreshCount = await cancelActiveJobsByType(
		supabase,
		accountId,
		"match_snapshot_refresh",
	);
	return enrichmentCount + refreshCount;
}

async function cancelActiveJobsByType(
	supabase: ReturnType<typeof createAdminSupabaseClient>,
	accountId: string,
	jobType: "enrichment" | "match_snapshot_refresh",
): Promise<number> {
	const { data: activeJobs } = await supabase
		.from("job")
		.select("id")
		.eq("account_id", accountId)
		.eq("type", jobType)
		.in("status", ["pending", "running"]);

	if (!activeJobs || activeJobs.length === 0) return 0;

	for (const job of activeJobs) {
		await markJobFailed(job.id, "dev reset");
	}
	return activeJobs.length;
}

async function clearMatchSnapshots(
	supabase: ReturnType<typeof createAdminSupabaseClient>,
	accountId: string,
): Promise<number> {
	const { data: contexts } = await supabase
		.from("match_context")
		.select("id")
		.eq("account_id", accountId);

	if (!contexts || contexts.length === 0) return 0;

	const contextIds = contexts.map((c) => c.id);

	await supabase.from("match_result").delete().in("context_id", contextIds);
	await supabase.from("match_context").delete().eq("account_id", accountId);

	return contexts.length;
}

async function resetLibraryProcessingState(accountId: string): Promise<void> {
	const stateResult = await loadLibraryProcessingState(accountId);
	if (Result.isError(stateResult) || !stateResult.value) return;

	const freshState: LibraryProcessingState = {
		...stateResult.value,
		enrichment: {
			requestedAt: null,
			settledAt: null,
			activeJobId: null,
		},
		matchSnapshotRefresh: {
			requestedAt: null,
			settledAt: null,
			activeJobId: null,
		},
	};

	await persistLibraryProcessingState(freshState);
}
