import {
	type InfiniteData,
	infiniteQueryOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import {
	LIKED_SONGS_DEEP_LINK_CENTRING_ROWS,
	LIKED_SONGS_PAGE_SIZE,
} from "@/lib/domains/library/liked-songs/constants";
import type { LikedSongFilter } from "@/lib/domains/library/liked-songs/queries";
import { generateSongSlug } from "@/lib/domains/library/songs/slug";
import { likedSongsKeys } from "@/lib/query-keys";
import {
	getLikedSongAnalysis,
	getLikedSongBySlug,
	getLikedSongsDeepLinkBootstrap,
	getLikedSongsNewerPage,
	getLikedSongsPage,
	getLikedSongsStats,
	type LikedSongsDeepLinkBootstrapResult,
	type LikedSongsPageResult,
} from "@/lib/server/liked-songs.functions";
import { getSongSuggestions } from "@/lib/server/matching.functions";
import { getWalkthroughCompanionSongs } from "@/lib/server/onboarding.functions";

export type FilterOption = LikedSongFilter;

export function likedSongsStatsQueryOptions(accountId: string) {
	return queryOptions({
		queryKey: likedSongsKeys.stats(accountId),
		queryFn: () => getLikedSongsStats(),
		staleTime: 30 * 60_000,
	});
}

// Curated companion songs for the song-walkthrough library. Static demo content,
// identical for every account, so it never goes stale and isn't account-keyed.
export function walkthroughCompanionsQueryOptions() {
	return queryOptions({
		queryKey: ["liked-songs", "walkthrough-companions"] as const,
		queryFn: () => getWalkthroughCompanionSongs(),
		staleTime: Number.POSITIVE_INFINITY,
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

// Under likedSongsKeys.all, so the enrichment and entitlement invalidations
// that refresh the list rows refresh an open panel's analysis with them.
export function likedSongAnalysisQueryOptions(
	accountId: string,
	songId: string | null,
) {
	return queryOptions({
		queryKey: likedSongsKeys.analysis(accountId, songId ?? ""),
		queryFn: () => getLikedSongAnalysis({ data: { songId: songId as string } }),
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

/**
 * Where a liked-songs page starts: the newest like (null), or a keyset cursor
 * read in one direction. Pages normally run older; a list a deep link seeded
 * mid-library also loads newer pages above its first row.
 */
export type LikedSongsPageParam = {
	direction: "older" | "newer";
	cursor: string;
} | null;

function olderFrom(cursor: string | null): LikedSongsPageParam {
	return cursor === null ? null : { direction: "older", cursor };
}

export function likedSongsInfiniteQueryOptions(
	filter: FilterOption,
	search?: string | null,
) {
	const searchArg = search?.trim() || undefined;

	return infiniteQueryOptions({
		queryKey: likedSongsKeys.infinite(filter, search),
		queryFn: async ({ pageParam }) => {
			if (pageParam?.direction === "newer") {
				return getLikedSongsNewerPage({ data: { cursor: pageParam.cursor } });
			}
			return getLikedSongsPage({
				data: {
					filter,
					cursor: pageParam?.cursor,
					limit: LIKED_SONGS_PAGE_SIZE,
					search: searchArg,
				},
			});
		},
		initialPageParam: null as LikedSongsPageParam,
		// Optional chaining: a page that failed to decode must not take the whole
		// route down with it (the transport guard in src/start.ts is the primary
		// defence; this keeps a bad cache entry from white-screening).
		getNextPageParam: (lastPage) => olderFrom(lastPage?.nextCursor ?? null),
		// Only a deep-link seed starts below the newest like; every other list's
		// first page was read from the top and has no prevCursor.
		getPreviousPageParam: (firstPage): LikedSongsPageParam =>
			firstPage?.prevCursor
				? { direction: "newer", cursor: firstPage.prevCursor }
				: null,
		staleTime: 30 * 60_000,
	});
}

export function likedSongsDeepLinkBootstrapQueryOptions(
	accountId: string,
	slug: string,
) {
	return queryOptions({
		// accountId scopes the key so two accounts deep-linking the same slug do
		// not collide; the server fn resolves the account from the session.
		queryKey: likedSongsKeys.deepLinkBootstrap(accountId, slug),
		queryFn: () => getLikedSongsDeepLinkBootstrap({ data: { slug } }),
		staleTime: 30 * 60_000,
	});
}

export function markLikedSongsPageLive(queryClient: QueryClient): void {
	queryClient.setQueryData(likedSongsKeys.pageLive, true);
}

export function clearLikedSongsPageLive(queryClient: QueryClient): void {
	queryClient.removeQueries({ queryKey: likedSongsKeys.pageLive, exact: true });
}

function canonicalAllListAlreadySatisfiesDeepLink(
	data: InfiniteData<LikedSongsPageResult, unknown> | undefined,
	slug: string,
): boolean {
	if (!data) return false;

	const songs = data.pages.flatMap((page) => page.songs);
	const selectedIndex = songs.findIndex(
		(song) => generateSongSlug(song.track.artist, song.track.name) === slug,
	);
	if (selectedIndex === -1) return false;

	const roomAbove =
		selectedIndex >= LIKED_SONGS_DEEP_LINK_CENTRING_ROWS ||
		data.pages[0]?.prevCursor === null;
	const roomBelow =
		songs.length - selectedIndex - 1 >= LIKED_SONGS_DEEP_LINK_CENTRING_ROWS ||
		data.pages[data.pages.length - 1]?.nextCursor === null;
	return roomAbove && roomBelow;
}

/**
 * Resolves whether the route loader should run the deep-link bootstrap that
 * seeds — and therefore *replaces* — the canonical no-search "all" infinite
 * query with a window of rows around the selected song.
 *
 * This may run on fresh route entry, even when a warm canonical list cache is
 * present from a prior visit, as long as the selected song is not already
 * loaded with enough rows on each side to avoid a first-paint centring clamp. What it must never do is re-run while the liked-songs page is
 * already live: in-app song changes (clicking another row, panel prev/next,
 * arrow navigation) also change `song`, and reseeding then would overwrite the
 * active list and visibly rebuild it.
 *
 * Returns the validated slug to bootstrap with, or null when bootstrap must be
 * skipped: no song, a filtered view, the page already live, or the canonical
 * list already holding the selected song with room to centre it.
 */
export function resolveLikedSongsDeepLinkBootstrap(
	queryClient: QueryClient,
	{ song, isDefaultFilter }: { song?: string; isDefaultFilter: boolean },
): { slug: string } | null {
	if (!song || !isDefaultFilter) return null;
	if (queryClient.getQueryData(likedSongsKeys.pageLive) === true) return null;

	const canonicalAllList = queryClient.getQueryData(
		likedSongsInfiniteQueryOptions("all").queryKey,
	);
	if (canonicalAllListAlreadySatisfiesDeepLink(canonicalAllList, song)) {
		return null;
	}

	return { slug: song };
}

/**
 * Hydrates the React Query cache from a deep-link bootstrap payload so a cold
 * reload of `/liked-songs?song=<slug>` renders the selected song inside the
 * list (highlighted, scroll-centered, prev/next-navigable) without any
 * client-side page waterfall.
 *
 * Seeds two caches:
 * 1. the by-slug lookup (`selectedSong`), so the fallback resolver resolves
 *    immediately even if the row somehow falls outside the seeded window;
 * 2. the canonical no-search "all" infinite query, with the window's pages.
 */
export function seedLikedSongsDeepLinkCaches(
	queryClient: QueryClient,
	accountId: string,
	slug: string,
	data: LikedSongsDeepLinkBootstrapResult,
): void {
	queryClient.setQueryData(
		likedSongBySlugQueryOptions(accountId, slug).queryKey,
		data.selectedSong,
	);

	// pageParams must line up with pages, since a refetch re-reads page 0 from
	// its param and each later page from the page before it: reading older from
	// startCursor reproduces the first page, and each later page starts below
	// the one before.
	const pageParams = data.pages.map((_page, index) =>
		index === 0
			? olderFrom(data.startCursor)
			: olderFrom(data.pages[index - 1].nextCursor),
	);

	queryClient.setQueryData(likedSongsInfiniteQueryOptions("all").queryKey, {
		pages: data.pages,
		pageParams,
	});
}
