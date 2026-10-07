/**
 * Every client cache key factory, plus the named invalidation sets that more
 * than one path must agree on. Lib hooks (SSE, active-jobs polling) and
 * features both invalidate these caches, so the keys live below both and
 * import nothing but types.
 */

import type { QueryClient } from "@tanstack/react-query";
import type { LikedSongFilter } from "@/lib/domains/library/liked-songs/queries";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import type { MatchOrientation } from "@/lib/domains/taste/match-review-queue/types";

export const activeJobsKeys = {
	all: ["active-jobs"] as const,
	byAccount: (accountId: string) => ["active-jobs", accountId] as const,
};

export const billingKeys = {
	all: ["billing"] as const,
	state: ["billing", "state"] as const,
	// Temporary: drop together with the waitlist welcome dialog.
	waitlistWelcome: ["billing", "waitlist-welcome"] as const,
};

export const dashboardKeys = {
	all: ["dashboard"] as const,
	pageData: (accountId: string) =>
		["dashboard", "page-data", accountId] as const,
	stats: (accountId: string) => ["dashboard", "stats", accountId] as const,
	recentActivity: (accountId: string) =>
		["dashboard", "recent-activity", accountId] as const,
	matchPreviews: (accountId: string) =>
		["dashboard", "match-previews", accountId] as const,
};

/**
 * Collapse undefined / null / "" / "   " into a single canonical "no search"
 * value so the React Query cache treats every empty form as the same key.
 */
function normalizeSearch(search?: string | null): string {
	if (!search) return "";
	return search.trim();
}

export const likedSongsKeys = {
	all: ["liked-songs"] as const,
	stats: (accountId: string) => ["liked-songs", "stats", accountId] as const,
	bySlug: (accountId: string, slug: string) =>
		[...likedSongsKeys.all, "by-slug", accountId, slug] as const,
	deepLinkBootstrap: (accountId: string, slug: string) =>
		[...likedSongsKeys.all, "deep-link-bootstrap", accountId, slug] as const,
	infinite: (filter: LikedSongFilter, search?: string | null) =>
		[
			...likedSongsKeys.all,
			"infinite",
			{ filter, search: normalizeSearch(search) },
		] as const,
	page: (filter: LikedSongFilter, cursor?: string, search?: string | null) =>
		[
			...likedSongsKeys.all,
			"page",
			{ filter, cursor, search: normalizeSearch(search) },
		] as const,
	songSuggestions: (songId: string) =>
		[...likedSongsKeys.all, "song-suggestions", songId] as const,
	pageLive: ["liked-songs", "page-live"] as const,
};

/**
 * Deck state is one source of truth per (account, orientation); per-card reads
 * and tail suggestions hang off itemId.
 */
export const matchDeckKeys = {
	all: ["match-deck"] as const,
	// Prefix for all deck (start/resume) keys — broad invalidation on snapshot
	// refresh or a strictness/filter change that affects every orientation.
	deckRoot: ["match-deck", "deck"] as const,
	deck: (accountId: string, orientation: MatchOrientation) =>
		["match-deck", "deck", accountId, orientation] as const,
	card: (itemId: string) => ["match-deck", "card", itemId] as const,
};

// Queue-aware summary keys. Drive sidebar badge and dashboard CTA.
// Invalidated on matchSnapshotRefresh completion (useActiveJobs) and after
// queue mutations that change the pending count.
export const matchReviewSummaryKeys = {
	// Prefix for all summary keys — use for broad invalidation across orientations.
	summariesRoot: ["match-review", "summary"] as const,
	summary: (accountId: string, orientation: MatchOrientation) =>
		["match-review", "summary", accountId, orientation] as const,
	// Preference-driven summary: resolves orientation from stored user preference.
	preferredSummary: (accountId: string) =>
		["match-review", "summary", accountId, "preferred"] as const,
};

export const playlistKeys = {
	all: ["playlists"] as const,
	management: (accountId: string) =>
		["playlists", "management", accountId] as const,
	tracks: (playlistId: string) => ["playlists", "tracks", playlistId] as const,
	topGenres: (accountId: string) =>
		["playlists", "top-genres", accountId] as const,
	filterOptions: (accountId: string) =>
		["playlists", "filter-options", accountId] as const,
};

// Keys are stable and derived from the full config so any parameter change
// triggers a fresh fetch while identical configs share the cache. The
// parameter lists exactly the fields that enter the key; the create flow's
// DraftConfig satisfies it structurally.
export const draftPreviewKeys = {
	all: ["playlist-draft-preview"] as const,
	preview: (config: {
		maxSongs: number;
		intent?: string;
		genrePills: string[];
		matchFilters: PlaylistMatchFiltersV1;
		pinnedSongIds: string[];
		excludedSongIds: string[];
		suggestionsOffset: number;
	}) =>
		[
			"playlist-draft-preview",
			config.maxSongs,
			config.intent ?? null,
			config.genrePills,
			config.matchFilters,
			config.pinnedSongIds,
			config.excludedSongIds,
			config.suggestionsOffset,
		] as const,
};

/**
 * Caches a finished match-snapshot refresh makes stale. Called on the
 * running-to-idle edge of the refresh job (useActiveJobCompletionEffects).
 */
export async function invalidateMatchSnapshotQueries(
	queryClient: QueryClient,
	accountId: string,
): Promise<void> {
	// Deck read model: a mid-session snapshot refresh must re-run the bounded deck
	// read so newly appended subjects surface. Appends are worker-driven now
	// (append_sessions jobs), so there is no request-path sync to await first.
	// deckRoot invalidates every (account, orientation) deck query; per-card
	// read/suggestion keys hang off matchDeckKeys.card and are intentionally left
	// alone — refetching an individual card mid-review would interrupt the user's
	// current card.
	queryClient.invalidateQueries({
		queryKey: matchDeckKeys.deckRoot,
	});

	// Queue-aware summary: drives sidebar badge + dashboard CTA count. Using
	// summariesRoot invalidates all orientation summary queries in one call.
	queryClient.invalidateQueries({
		queryKey: matchReviewSummaryKeys.summariesRoot,
	});

	// Dashboard surfaces updated by the new snapshot. stats backs the CTA's
	// reviewCount — without invalidating it the preview fan refreshes while the
	// count stays stale. pageData keeps the route-loader cache fresh.
	queryClient.invalidateQueries({
		queryKey: dashboardKeys.stats(accountId),
	});
	queryClient.invalidateQueries({
		queryKey: dashboardKeys.pageData(accountId),
	});
	queryClient.invalidateQueries({
		queryKey: dashboardKeys.matchPreviews(accountId),
	});
}
