/**
 * Wake enrichment for every account affected by a settled backfill job. The
 * feature row is song-level shared data, so all entitled likers — not just the
 * requester — should get a chance to (re)run analysis. Reuses the existing
 * songs_unlocked library-processing change, which marks enrichment stale and
 * idempotently ensures a pending enrichment job per account.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { log } from "@/lib/observability/logger";
import { BillingChanges } from "@/lib/workflows/library-processing/changes";
import { applyLibraryProcessingChange } from "@/lib/workflows/library-processing/service";

export async function wakeEnrichmentForSong(songId: string): Promise<string[]> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc("get_entitled_likers_of_song", {
		p_song_id: songId,
	});
	if (error) {
		log.warn("youtube-audio-wake-likers-failed", {
			songId,
			error: error.message,
		});
		return [];
	}

	const accountIds = ((data ?? []) as { account_id: string }[]).map(
		(r) => r.account_id,
	);

	for (const accountId of accountIds) {
		const result = await applyLibraryProcessingChange(
			BillingChanges.songsUnlocked(accountId, [songId]),
		);
		if (Result.isError(result)) {
			log.warn("youtube-audio-wake-failed", {
				accountId,
				songId,
				error: result.error.kind,
			});
		}
	}

	return accountIds;
}
