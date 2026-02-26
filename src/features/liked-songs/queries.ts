import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import {
	getLikedSongsPage,
	getLikedSongsStats,
} from "@/lib/server/liked-songs.functions";

export type FilterOption = "all" | "pending" | "matched" | "analyzed";

export const PAGE_SIZE = 15;

export const likedSongsKeys = {
	all: ["liked-songs"] as const,
	stats: (accountId: string) => ["liked-songs", "stats", accountId] as const,
	infinite: (filter: FilterOption) =>
		[...likedSongsKeys.all, "infinite", { filter }] as const,
	page: (filter: FilterOption, cursor?: string) =>
		[...likedSongsKeys.all, "page", { filter, cursor }] as const,
	artistImage: (artistId: string) => ["artist-image", artistId] as const,
};

export function likedSongsStatsQueryOptions(accountId: string) {
	return queryOptions({
		queryKey: likedSongsKeys.stats(accountId),
		queryFn: () => getLikedSongsStats(),
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
