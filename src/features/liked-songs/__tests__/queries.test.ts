import { type InfiniteData, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS } from "@/lib/domains/library/liked-songs/constants";
import type {
	LikedSongsDeepLinkBootstrapResult,
	LikedSongsPageResult,
} from "@/lib/server/liked-songs.functions";
import {
	clearLikedSongsPageLive,
	likedSongBySlugQueryOptions,
	likedSongsInfiniteQueryOptions,
	likedSongsKeys,
	markLikedSongsPageLive,
	resolveLikedSongsDeepLinkBootstrap,
	seedLikedSongsDeepLinkCaches,
} from "../queries";
import type { LikedSong } from "../types";

function createSong(id: string): LikedSong {
	return {
		liked_at: "2026-03-30T00:00:00Z",
		matching_status: null,
		displayState: "analyzed",
		analysis: null,
		track: {
			id,
			spotify_track_id: `spotify-${id}`,
			name: `Song ${id}`,
			artist: "Lorde",
			artist_id: "artist-1",
			artist_image_url: null,
			album: "Pure Heroine",
			image_url: null,
			genres: [],
			audio_features: null,
		},
	};
}

function createPage(
	ids: string[],
	nextCursor: string | null,
): LikedSongsPageResult {
	return { songs: ids.map(createSong), nextCursor };
}

describe("likedSongsKeys.infinite", () => {
	it("collapses undefined, null, empty, and whitespace search into a single key", () => {
		const filter = "all" as const;
		const base = JSON.stringify(likedSongsKeys.infinite(filter));

		expect(JSON.stringify(likedSongsKeys.infinite(filter, undefined))).toBe(
			base,
		);
		expect(JSON.stringify(likedSongsKeys.infinite(filter, null))).toBe(base);
		expect(JSON.stringify(likedSongsKeys.infinite(filter, ""))).toBe(base);
		expect(JSON.stringify(likedSongsKeys.infinite(filter, "   "))).toBe(base);
	});

	it("treats trimmed and untrimmed searches as the same key", () => {
		const filter = "all" as const;
		expect(
			JSON.stringify(likedSongsKeys.infinite(filter, "let it happen")),
		).toBe(
			JSON.stringify(likedSongsKeys.infinite(filter, "  let it happen  ")),
		);
	});

	it("yields distinct keys for different filter+search combinations", () => {
		const a = JSON.stringify(likedSongsKeys.infinite("all", "let it happen"));
		const b = JSON.stringify(
			likedSongsKeys.infinite("pending", "let it happen"),
		);
		const c = JSON.stringify(likedSongsKeys.infinite("all", "another song"));
		expect(a).not.toBe(b);
		expect(a).not.toBe(c);
		expect(b).not.toBe(c);
	});
});

describe("likedSongsInfiniteQueryOptions", () => {
	it("uses the normalized search in the query key", () => {
		const trimmed = likedSongsInfiniteQueryOptions("all", "  let it happen  ");
		const raw = likedSongsInfiniteQueryOptions("all", "let it happen");
		expect(JSON.stringify(trimmed.queryKey)).toBe(JSON.stringify(raw.queryKey));
	});

	it("uses the canonical no-search key when search is missing/blank", () => {
		const omitted = JSON.stringify(
			likedSongsInfiniteQueryOptions("all").queryKey,
		);
		expect(
			JSON.stringify(likedSongsInfiniteQueryOptions("all", "").queryKey),
		).toBe(omitted);
		expect(
			JSON.stringify(likedSongsInfiniteQueryOptions("all", "   ").queryKey),
		).toBe(omitted);
		expect(
			JSON.stringify(likedSongsInfiniteQueryOptions("all", null).queryKey),
		).toBe(omitted);
	});
});

describe("seedLikedSongsDeepLinkCaches", () => {
	const accountId = "account-1";
	const slug = "lorde-song-a";

	it("seeds the by-slug cache with the selected song", () => {
		const queryClient = new QueryClient();
		const selectedSong = createSong("a");
		const data: LikedSongsDeepLinkBootstrapResult = {
			selectedSong,
			pages: [createPage(["a"], null)],
		};

		seedLikedSongsDeepLinkCaches(queryClient, accountId, slug, data);

		expect(
			queryClient.getQueryData(
				likedSongBySlugQueryOptions(accountId, slug).queryKey,
			),
		).toBe(selectedSong);
	});

	it("seeds the by-slug cache with null for an unresolved slug", () => {
		const queryClient = new QueryClient();
		const data: LikedSongsDeepLinkBootstrapResult = {
			selectedSong: null,
			pages: [createPage(["a", "b"], "cursor-b")],
		};

		seedLikedSongsDeepLinkCaches(queryClient, accountId, slug, data);

		expect(
			queryClient.getQueryData(
				likedSongBySlugQueryOptions(accountId, slug).queryKey,
			),
		).toBeNull();
	});

	it("seeds the infinite query under the canonical no-search 'all' key", () => {
		const queryClient = new QueryClient();
		const data: LikedSongsDeepLinkBootstrapResult = {
			selectedSong: createSong("b"),
			pages: [createPage(["a"], "cursor-0"), createPage(["b"], "cursor-1")],
		};

		seedLikedSongsDeepLinkCaches(queryClient, accountId, slug, data);

		const seeded = queryClient.getQueryData<InfiniteData<LikedSongsPageResult>>(
			likedSongsInfiniteQueryOptions("all").queryKey,
		);

		expect(seeded?.pages).toEqual(data.pages);
		// The walkthrough/collection hook reads exactly this key.
		expect(seeded).toBeDefined();
	});

	it("derives pageParams aligned with the seeded pages", () => {
		const queryClient = new QueryClient();
		const data: LikedSongsDeepLinkBootstrapResult = {
			selectedSong: createSong("c"),
			pages: [
				createPage(["a"], "cursor-0"),
				createPage(["b"], "cursor-1"),
				createPage(["c"], null),
			],
		};

		seedLikedSongsDeepLinkCaches(queryClient, accountId, slug, data);

		const seeded = queryClient.getQueryData<InfiniteData<LikedSongsPageResult>>(
			likedSongsInfiniteQueryOptions("all").queryKey,
		);

		// First param is the initial (undefined) cursor; each later param is the
		// prior page's nextCursor, so React Query can keep paginating from the end.
		expect(seeded?.pageParams).toEqual([undefined, "cursor-0", "cursor-1"]);
	});
});

describe("resolveLikedSongsDeepLinkBootstrap", () => {
	const slug = "lorde-song-a";

	it("returns the slug on cold entry when the canonical list cache is absent", () => {
		const queryClient = new QueryClient();

		expect(
			resolveLikedSongsDeepLinkBootstrap(queryClient, {
				song: slug,
				isDefaultFilter: true,
			}),
		).toEqual({ slug });
	});

	it("returns null once the liked-songs page is already live", () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData<InfiniteData<LikedSongsPageResult>>(
			likedSongsInfiniteQueryOptions("all").queryKey,
			{ pages: [createPage(["a", "b"], "cursor-b")], pageParams: [undefined] },
		);
		markLikedSongsPageLive(queryClient);

		expect(
			resolveLikedSongsDeepLinkBootstrap(queryClient, {
				song: slug,
				isDefaultFilter: true,
			}),
		).toBeNull();
	});

	it("returns null for filtered views even on cold entry", () => {
		const queryClient = new QueryClient();

		expect(
			resolveLikedSongsDeepLinkBootstrap(queryClient, {
				song: slug,
				isDefaultFilter: false,
			}),
		).toBeNull();
	});

	it("returns null when no song is selected", () => {
		const queryClient = new QueryClient();

		expect(
			resolveLikedSongsDeepLinkBootstrap(queryClient, {
				song: undefined,
				isDefaultFilter: true,
			}),
		).toBeNull();
	});

	it("returns the slug on a fresh entry when a warm cache exists but lacks the song", () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData<InfiniteData<LikedSongsPageResult>>(
			likedSongsInfiniteQueryOptions("all").queryKey,
			{ pages: [createPage(["a", "b"], "cursor-b")], pageParams: [undefined] },
		);

		expect(
			resolveLikedSongsDeepLinkBootstrap(queryClient, {
				song: "lorde-song-z",
				isDefaultFilter: true,
			}),
		).toEqual({ slug: "lorde-song-z" });
	});

	it("returns the slug when a warm cache has the song but lacks trailing rows", () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData<InfiniteData<LikedSongsPageResult>>(
			likedSongsInfiniteQueryOptions("all").queryKey,
			{ pages: [createPage(["a", "b"], "cursor-b")], pageParams: [undefined] },
		);

		expect(
			resolveLikedSongsDeepLinkBootstrap(queryClient, {
				song: slug,
				isDefaultFilter: true,
			}),
		).toEqual({ slug });
	});

	it("returns null when a warm cache already has the full trailing buffer", () => {
		const queryClient = new QueryClient();
		const ids = [
			"a",
			...Array.from(
				{ length: LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS },
				(_, index) => `id-${index + 1}`,
			),
		];
		queryClient.setQueryData<InfiniteData<LikedSongsPageResult>>(
			likedSongsInfiniteQueryOptions("all").queryKey,
			{ pages: [createPage(ids, "cursor-tail")], pageParams: [undefined] },
		);

		expect(
			resolveLikedSongsDeepLinkBootstrap(queryClient, {
				song: slug,
				isDefaultFilter: true,
			}),
		).toBeNull();
	});

	it("returns null when the warm cache already reaches the real end after the song", () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData<InfiniteData<LikedSongsPageResult>>(
			likedSongsInfiniteQueryOptions("all").queryKey,
			{ pages: [createPage(["x", "a", "b"], null)], pageParams: [undefined] },
		);

		expect(
			resolveLikedSongsDeepLinkBootstrap(queryClient, {
				song: slug,
				isDefaultFilter: true,
			}),
		).toBeNull();
	});

	it("leaves the live list untouched on a later in-app song change", () => {
		const queryClient = new QueryClient();
		const liveList: InfiniteData<LikedSongsPageResult> = {
			pages: [createPage(["a", "b", "c"], "cursor-c")],
			pageParams: [undefined],
		};
		queryClient.setQueryData(
			likedSongsInfiniteQueryOptions("all").queryKey,
			liveList,
		);
		markLikedSongsPageLive(queryClient);

		// Same-page navigation to a different song: the page-live marker makes the
		// loader skip bootstrap, so the list cache stays the exact same reference.
		const target = resolveLikedSongsDeepLinkBootstrap(queryClient, {
			song: "lorde-song-z",
			isDefaultFilter: true,
		});
		expect(target).toBeNull();

		expect(
			queryClient.getQueryData<InfiniteData<LikedSongsPageResult>>(
				likedSongsInfiniteQueryOptions("all").queryKey,
			),
		).toBe(liveList);
		clearLikedSongsPageLive(queryClient);
	});
});
