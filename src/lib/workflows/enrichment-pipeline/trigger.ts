import { Result } from "better-result";
import { getCount as getLikedSongCount } from "@/lib/domains/library/liked-songs/queries";
import { getOrCreateEnrichmentJob } from "@/lib/data/jobs";
import { updateEnrichmentJobId } from "@/lib/domains/library/accounts/preferences-queries";
import { makeInitialProgress } from "./progress";

/**
 * Requests enrichment for an account's liked songs.
 * Idempotent — safe to call from any context (onboarding, sync, manual).
 *
 * Returns the job ID if created/found, null if no liked songs exist.
 */
export async function requestEnrichment(
	accountId: string,
): Promise<string | null> {
	const songCount = await getLikedSongCount(accountId);
	if (Result.isError(songCount) || songCount.value === 0) return null;

	const result = await getOrCreateEnrichmentJob(
		accountId,
		makeInitialProgress(1, 0, 0),
	);
	if (Result.isError(result)) {
		console.error("[enrichment] Failed to create job:", result.error.message);
		return null;
	}

	const updateResult = await updateEnrichmentJobId(accountId, result.value.id);
	if (Result.isError(updateResult)) {
		console.error(
			"[enrichment] Failed to update enrichment pointer:",
			updateResult.error.message,
		);
	}
	return result.value.id;
}
