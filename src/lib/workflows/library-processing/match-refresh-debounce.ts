import type { LibraryProcessingChange } from "./types";

// Debounce delays per change kind (E16). Playlist config saves use 8 s so
// rapid editor saves coalesce into one refresh instead of fanning out.
// Onboarding, library, and enrichment triggers are zero because the user
// expects immediate progress after those actions.
export const MATCH_REFRESH_DEBOUNCE_MS_BY_CHANGE: Record<
	LibraryProcessingChange["kind"],
	number
> = {
	playlist_management_session_flushed: 8_000,
	onboarding_target_selection_confirmed: 0,
	library_synced: 0,
	enrichment_completed: 0,
	enrichment_stopped: 0,
	match_snapshot_published: 0,
	match_snapshot_failed: 0,
	enrichment_work_available: 0,
	songs_unlocked: 0,
	unlimited_activated: 0,
	candidate_access_revoked: 0,
};

export function resolveMatchRefreshAvailableAt(input: {
	changeKind: LibraryProcessingChange["kind"];
	now: Date;
}): string {
	const delayMs = MATCH_REFRESH_DEBOUNCE_MS_BY_CHANGE[input.changeKind];
	return new Date(input.now.getTime() + delayMs).toISOString();
}
