import { Result } from "better-result";
import { getOrCreateTargetPlaylistMatchRefreshJob } from "@/lib/data/jobs";
import { updateTargetPlaylistMatchRefreshJobId } from "@/lib/domains/library/accounts/preferences-queries";
import { buildRefreshPlan } from "./planner";
import type { RefreshSource, TargetPlaylistRefreshPlan } from "./types";

/**
 * Requests a target-playlist match refresh for an account.
 * Idempotent — coalesces into the active job via rerunRequested.
 * Returns the job ID if created/found.
 */
export async function requestTargetPlaylistMatchRefresh(opts: {
	accountId: string;
	source: RefreshSource;
}): Promise<string | null> {
	const plan: TargetPlaylistRefreshPlan = buildRefreshPlan(opts.source);

	const progress = {
		total: 0,
		done: 0,
		succeeded: 0,
		failed: 0,
		plan,
	};

	const result = await getOrCreateTargetPlaylistMatchRefreshJob(
		opts.accountId,
		progress as any,
	);

	if (Result.isError(result)) {
		console.error(
			`[target-refresh] Failed to create job for ${opts.accountId}:`,
			result.error.message,
		);
		return null;
	}

	const updateResult = await updateTargetPlaylistMatchRefreshJobId(
		opts.accountId,
		result.value.id,
	);
	if (Result.isError(updateResult)) {
		console.error(
			"[target-refresh] Failed to update job pointer:",
			updateResult.error.message,
		);
	}

	return result.value.id;
}
