import {
	type InfiniteData,
	infiniteQueryOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import {
	LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS,
	LIKED_SONGS_PAGE_SIZE,
} from "@/lib/domains/library/liked-songs/constants";
import type { LikedSongFilter } from "@/lib/domains/library/liked-songs/queries";
import {
	getLikedSongBySlug,
	getLikedSongsDeepLinkBootstrap,
	getLikedSongsPage,
	getLikedSongsStats,
	type LikedSongsDeepLinkBootstrapResult,
	type LikedSongsPageResult,
} from "@/lib/server/liked-songs.functions";
import { getSongSuggestions } from "@/lib/server/matching.functions";
import { getWalkthroughCompanionSongs } from "@/lib/server/onboarding.functions";
import { generateSongSlug } from "@/lib/utils/slug";

export type FilterOption = LikedSongFilter;

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
	pageLive: ["liked-songs", "page-live"] as const,
};

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
					limit: LIKED_SONGS_PAGE_SIZE,
					search: searchArg,
				},
			});
		},
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
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
	data: InfiniteData<LikedSongsPageResult> | undefined,
	slug: string,
): boolean {
	if (!data) return false;

	const songs = data.pages.flatMap((page) => page.songs);
	const selectedIndex = songs.findIndex(
		(song) => generateSongSlug(song.track.artist, song.track.name) === slug,
	);
	if (selectedIndex === -1) return false;

	const trailingCount = songs.length - selectedIndex - 1;
	if (trailingCount >= LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS) {
		return true;
	}

	const lastPage = data.pages[data.pages.length - 1];
	return lastPage?.nextCursor === null;
}

/**
 * Resolves whether the route loader should run the deep-link bootstrap that
 * seeds — and therefore *replaces* — the canonical no-search "all" infinite
 * query with the contiguous prefix through the selected song.
 *
 * This may run on fresh route entry, even when a warm canonical list cache is
 * present from a prior visit, as long as the selected song is not already
 * loaded with enough trailing rows to avoid the first-paint "selected at the
 * bottom" clamp. What it must never do is re-run while the liked-songs page is
 * already live: in-app song changes (clicking another row, panel prev/next,
 * arrow navigation) also change `song`, and reseeding then would overwrite the
 * active list and visibly rebuild it.
 *
 * Returns the validated slug to bootstrap with, or null when bootstrap must be
 * skipped: no song, a filtered view, the page already live, or the canonical
 * list already satisfying the selected song + trailing-buffer UX.
 */
export function resolveLikedSongsDeepLinkBootstrap(
	queryClient: QueryClient,
	{ song, isDefaultFilter }: { song?: string; isDefaultFilter: boolean },
): { slug: string } | null {
	if (!song || !isDefaultFilter) return null;
	if (queryClient.getQueryData(likedSongsKeys.pageLive) === true) return null;

	const canonicalAllList = queryClient.getQueryData<
		InfiniteData<LikedSongsPageResult>
	>(likedSongsInfiniteQueryOptions("all").queryKey);
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
 *    immediately even if the row somehow falls outside the seeded prefix;
 * 2. the canonical no-search "all" infinite query, with the contiguous prefix
 *    of pages through the selected song.
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

	// pageParams must line up with pages: the first page was fetched with the
	// initial (undefined) cursor; every later page with the prior page's cursor.
	const pageParams = data.pages.map((_page, index) =>
		index === 0 ? undefined : (data.pages[index - 1].nextCursor ?? undefined),
	);

	queryClient.setQueryData<InfiniteData<LikedSongsPageResult>>(
		likedSongsInfiniteQueryOptions("all").queryKey,
		{ pages: data.pages, pageParams },
	);
}
