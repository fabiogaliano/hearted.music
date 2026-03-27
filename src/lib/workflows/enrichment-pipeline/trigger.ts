import { Result } from "better-result";
import { getCount as getLikedSongCount } from "@/lib/domains/library/liked-songs/queries";
import { getOrCreateEnrichmentJob } from "@/lib/data/jobs";
import { updateEnrichmentJobId } from "@/lib/domains/library/accounts/preferences-queries";
import { getTargetPlaylists } from "@/lib/domains/library/playlists/queries";
import { requestTargetPlaylistMatchRefresh } from "@/lib/workflows/target-playlist-match-refresh/trigger";
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
		makeInitialProgress(1, 0, songCount.value),
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

/**
 * Called after enrichment queue drains (hasMoreSongs = false).
 * Requests target-playlist refresh if the account has target playlists.
 */
export async function requestRefreshAfterDrain(
	accountId: string,
): Promise<string | null> {
	const targetResult = await getTargetPlaylists(accountId);
	if (Result.isError(targetResult) || targetResult.value.length === 0) {
		return null;
	}

	return requestTargetPlaylistMatchRefresh({
		accountId,
		source: "enrichment_drain",
	});
}
