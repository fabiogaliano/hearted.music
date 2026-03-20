/**
 * Trigger helper for playlist lightweight enrichment jobs.
 *
 * Creates or reuses an active lightweight enrichment job for an account.
 * Defaults to mode: "all_destinations" for app-triggered flows.
 */

import { Result } from "better-result";
import { createJob, getActiveJob } from "@/lib/data/jobs";

export type LightweightEnrichmentJobProgress = {
	total: number;
	done: number;
	succeeded: number;
	failed: number;
	mode: "all_destinations" | "playlist_ids";
	playlistIds?: string[];
	reason: "sync" | "destination_toggle" | "manual";
	rerunRequested?: boolean;
};

/**
 * Enqueue a playlist lightweight enrichment job.
 * Returns the job ID, or null if a job is already active.
 */
export async function triggerLightweightEnrichment(
	accountId: string,
	_reason: LightweightEnrichmentJobProgress["reason"] = "sync",
): Promise<string | null> {
	// Check for existing active job
	const activeResult = await getActiveJob(
		accountId,
		"playlist_lightweight_enrichment",
	);
	if (Result.isOk(activeResult) && activeResult.value) {
		// Job already active — mark rerun requested if possible
		console.log(
			`[lightweight-enrichment] Active job exists for account ${accountId}, skipping`,
		);
		return null;
	}

	const jobResult = await createJob(
		accountId,
		"playlist_lightweight_enrichment",
	);
	if (Result.isError(jobResult)) {
		console.warn(
			"[lightweight-enrichment] Failed to create job:",
			jobResult.error.message,
		);
		return null;
	}

	return jobResult.value.id;
}
