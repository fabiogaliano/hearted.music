import { Result } from "better-result";
import { getCount as getLikedSongCount } from "@/lib/domains/library/liked-songs/queries";
import {
	getOrCreateEnrichmentJob,
	getOrCreateRematchJob,
} from "@/lib/data/jobs";
import {
	updateEnrichmentJobId,
	updateRematchJobId,
} from "@/lib/domains/library/accounts/preferences-queries";
import { getLatestMatchContext } from "@/lib/domains/taste/song-matching/queries";
import { getPlaylists } from "@/lib/domains/library/playlists/queries";
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

/**
 * Checks if rematch is needed and creates a background job if so.
 * Does NOT execute matching — the worker picks up the job asynchronously.
 *
 * Guards:
 * - No playlists AND no prior context → nothing to do
 * - No prior match_context → let initial enrichment pipeline handle it
 * - Playlists removed AND prior context had playlists → create rematch job
 * - Playlists exist AND prior context exists → create rematch job (worker dedup via contextHash)
 */
export async function checkAndRematch(
	accountId: string,
): Promise<{ triggered: boolean; rematchJobId?: string }> {
	const playlistsResult = await getPlaylists(accountId);
	const currentPlaylists = Result.isOk(playlistsResult)
		? playlistsResult.value
		: [];

	const latestCtxResult = await getLatestMatchContext(accountId);
	const latestCtx = Result.isOk(latestCtxResult) ? latestCtxResult.value : null;

	if (currentPlaylists.length === 0) {
		if (latestCtx && latestCtx.playlist_count > 0) {
			// User removed all playlists — worker will create empty context
			return createRematchJobForAccount(accountId);
		}
		return { triggered: false };
	}

	if (!latestCtx) {
		return { triggered: false };
	}

	// Playlists exist and prior context exists — always create job.
	// contextHash dedup inside requestRematch will short-circuit if nothing changed.
	console.info(
		`[enrichment] Playlist change check for ${accountId}, creating rematch job`,
	);
	return createRematchJobForAccount(accountId);
}

async function createRematchJobForAccount(
	accountId: string,
): Promise<{ triggered: boolean; rematchJobId?: string }> {
	const result = await getOrCreateRematchJob(accountId);
	if (Result.isError(result)) {
		console.error(
			`[enrichment] Failed to create rematch job for ${accountId}:`,
			result.error.message,
		);
		return { triggered: false };
	}

	const updateResult = await updateRematchJobId(accountId, result.value.id);
	if (Result.isError(updateResult)) {
		console.error(
			"[enrichment] Failed to update rematch pointer:",
			updateResult.error.message,
		);
	}

	return { triggered: true, rematchJobId: result.value.id };
}
