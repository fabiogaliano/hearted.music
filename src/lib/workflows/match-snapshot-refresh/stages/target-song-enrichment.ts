/**
 * Target song enrichment stage — runs lightweight enrichment for the
 * account's target-playlist songs before profiling/matching. Best-effort:
 * a failure here must not abort the refresh (playlist profiling and
 * candidate loading can still proceed with whatever enrichment already
 * exists), so failures are caught and reported rather than thrown.
 */

import { log } from "@/lib/observability/logger";
import { runLightweightEnrichment } from "@/lib/workflows/playlist-sync/lightweight-enrichment";

export interface TargetSongEnrichmentOutcome {
	succeeded: boolean;
}

export async function runTargetSongEnrichment(
	accountId: string,
	who: string,
): Promise<TargetSongEnrichmentOutcome> {
	try {
		await runLightweightEnrichment({ accountId });
		return { succeeded: true };
	} catch (err) {
		log.warn("match:target-enrichment-failed", {
			actor: who,
			error: err instanceof Error ? err.message : String(err),
		});
		return { succeeded: false };
	}
}
