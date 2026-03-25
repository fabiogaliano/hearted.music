import type { RefreshSource, TargetPlaylistRefreshPlan } from "./types";

/**
 * Builds a TargetPlaylistRefreshPlan from the change source.
 * The plan is a hint — the orchestrator re-reads DB state at execution time.
 */
export function buildRefreshPlan(
	source: RefreshSource,
): TargetPlaylistRefreshPlan {
	const needsTargetSongEnrichment =
		source === "enrichment_drain" ||
		source === "sync_target_track_change" ||
		source === "target_selection";

	return {
		source,
		shouldEnrichTargetPlaylistSongs: needsTargetSongEnrichment,
	};
}
