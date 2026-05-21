import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { LikedSongFilter } from "@/lib/domains/library/liked-songs/queries";
import {
	getLikedSongBySlug,
	getLikedSongsPage,
	getLikedSongsStats,
} from "@/lib/server/liked-songs.functions";
import { getSongSuggestions } from "@/lib/server/matching.functions";

export type FilterOption = LikedSongFilter;

const PAGE_SIZE = 15;

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
	infinite: (filter: FilterOption, search?: string | null) =>
		[
			...likedSongsKeys.all,
			"infinite",
			{ filter, search: normalizeSearch(search) },
		] as const,
	page: (filter: FilterOption, cursor?: string, search?: string | null) =>
		[
			...likedSongsKeys.all,
			"page",
			{ filter, cursor, search: normalizeSearch(search) },
		] as const,
	songSuggestions: (songId: string) =>
		[...likedSongsKeys.all, "song-suggestions", songId] as const,
};

export function likedSongsStatsQueryOptions(accountId: string) {
	return queryOptions({
		queryKey: likedSongsKeys.stats(accountId),
		queryFn: () => getLikedSongsStats(),
		staleTime: 30 * 60_000,
	});
}

export function songSuggestionsQueryOptions(songId: string | null) {
	return queryOptions({
		queryKey: likedSongsKeys.songSuggestions(songId ?? ""),
		queryFn: () => getSongSuggestions({ data: { songId: songId as string } }),
		enabled: songId != null,
		staleTime: 30 * 60_000,
	});
}

export function likedSongBySlugQueryOptions(
	accountId: string,
	slug: string | null | undefined,
) {
	return queryOptions({
		queryKey: likedSongsKeys.bySlug(accountId, slug ?? ""),
		queryFn: () => {
			if (!slug) {
				return Promise.resolve(null);
			}

			return getLikedSongBySlug({ data: { slug } });
		},
		enabled: slug != null,
		staleTime: 30 * 60_000,
	});
}

export function likedSongsInfiniteQueryOptions(
	filter: FilterOption,
	search?: string | null,
) {
	const normalizedSearch = normalizeSearch(search);
	const searchArg = normalizedSearch.length > 0 ? normalizedSearch : undefined;

	return infiniteQueryOptions({
		queryKey: likedSongsKeys.infinite(filter, normalizedSearch),
		queryFn: async ({ pageParam }) => {
			return getLikedSongsPage({
				data: {
					filter,
					cursor: pageParam,
					limit: PAGE_SIZE,
					search: searchArg,
				},
			});
		},
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
		staleTime: 30 * 60_000,
	});
}
