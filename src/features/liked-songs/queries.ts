import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import {
	getLikedSongBySlug,
	getLikedSongsPage,
	getLikedSongsStats,
} from "@/lib/server/liked-songs.functions";
import { getSongSuggestions } from "@/lib/server/matching.functions";
import type { LikedSongFilter } from "@/lib/domains/library/liked-songs/queries";

export type FilterOption = LikedSongFilter;

export const PAGE_SIZE = 15;

export const likedSongsKeys = {
	all: ["liked-songs"] as const,
	stats: (accountId: string) => ["liked-songs", "stats", accountId] as const,
	bySlug: (accountId: string, slug: string) =>
		[...likedSongsKeys.all, "by-slug", accountId, slug] as const,
	infinite: (filter: FilterOption) =>
		[...likedSongsKeys.all, "infinite", { filter }] as const,
	page: (filter: FilterOption, cursor?: string) =>
		[...likedSongsKeys.all, "page", { filter, cursor }] as const,
	songSuggestions: (songId: string) =>
		[...likedSongsKeys.all, "song-suggestions", songId] as const,
};

export function likedSongsStatsQueryOptions(accountId: string) {
	return queryOptions({
		queryKey: likedSongsKeys.stats(accountId),
		queryFn: () => getLikedSongsStats(),
		staleTime: 60_000,
	});
}

export function songSuggestionsQueryOptions(songId: string | null) {
	return queryOptions({
		queryKey: likedSongsKeys.songSuggestions(songId ?? ""),
		queryFn: () => getSongSuggestions({ data: { songId: songId! } }),
		enabled: songId != null,
		staleTime: 60_000,
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
		staleTime: 60_000,
	});
}

export function likedSongsInfiniteQueryOptions(filter: FilterOption) {
	return infiniteQueryOptions({
		queryKey: likedSongsKeys.infinite(filter),
		queryFn: async ({ pageParam }) => {
			return getLikedSongsPage({
				data: { filter, cursor: pageParam, limit: PAGE_SIZE },
			});
		},
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
	});
}
