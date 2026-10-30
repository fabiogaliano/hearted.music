import {
	type InfiniteData,
	InfiniteQueryObserver,
	QueryClient,
} from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIKED_SONGS_DEEP_LINK_CENTRING_ROWS } from "@/lib/domains/library/liked-songs/constants";
import { likedSongsKeys } from "@/lib/query-keys";
import {
	getLikedSongsNewerPage,
	getLikedSongsPage,
	type LikedSongsDeepLinkBootstrapResult,
	type LikedSongsPageResult,
} from "@/lib/server/liked-songs.functions";
import {
	clearLikedSongsPageLive,
	likedSongBySlugQueryOptions,
	likedSongsInfiniteQueryOptions,
	markLikedSongsPageLive,
	resolveLikedSongsDeepLinkBootstrap,
	seedLikedSongsDeepLinkCaches,
} from "../queries";
import type { LikedSong } from "../types";

vi.mock("@/lib/server/liked-songs.functions", () => ({
	getLikedSongsPage: vi.fn(),
	getLikedSongsNewerPage: vi.fn(),
}));

beforeEach(() => {
	vi.resetAllMocks();
});

function createSong(id: string): LikedSong {
	return {
		liked_at: "2026-03-30T00:00:00Z",
		matching_status: null,
		displayState: "analyzed",
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
	prevCursor: string | null = null,
): LikedSongsPageResult {
	return { songs: ids.map(createSong), prevCursor, nextCursor };
}

// The cursor each getLikedSongsPage call was made with.
const pageCursors = () =>
	vi
		.mocked(getLikedSongsPage)
		.mock.calls.map(
			([arg]) => (arg as { data: { cursor?: string } }).data.cursor,
		);

const ids = (prefix: string, count: number) =>
	Array.from({ length: count }, (_, index) => `${prefix}-${index}`);

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
			startCursor: null,
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
			startCursor: null,
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
			startCursor: null,
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
				createPage(["a"], "cursor-0", "cursor-a"),
				createPage(["b"], "cursor-1", "cursor-b"),
				createPage(["c"], null, "cursor-c"),
			],
			startCursor: "cursor-start",
		};

		seedLikedSongsDeepLinkCaches(queryClient, accountId, slug, data);

		const seeded = queryClient.getQueryData<InfiniteData<LikedSongsPageResult>>(
			likedSongsInfiniteQueryOptions("all").queryKey,
		);

		// Page 0 reads older from the row just above the window; each later page
		// reads older from the prior page's last row.
		expect(seeded?.pageParams).toEqual([
			{ direction: "older", cursor: "cursor-start" },
			{ direction: "older", cursor: "cursor-0" },
			{ direction: "older", cursor: "cursor-1" },
		]);
	});

	it("re-reads a window from its start, not the newest like, when the list refetches", async () => {
		const queryClient = new QueryClient();
		seedLikedSongsDeepLinkCaches(queryClient, accountId, slug, {
			selectedSong: createSong("w-10"),
			pages: [
				createPage(ids("w", 50), "cursor-w49", "cursor-w0"),
				createPage(ids("v", 20), "cursor-v19", "cursor-v0"),
			],
			startCursor: "cursor-start",
		});
		vi.mocked(getLikedSongsPage)
			.mockResolvedValueOnce(
				createPage(ids("w", 50), "cursor-w49", "cursor-w0"),
			)
			.mockResolvedValueOnce(
				createPage(ids("v", 20), "cursor-v19", "cursor-v0"),
			);

		const observer = new InfiniteQueryObserver(
			queryClient,
			likedSongsInfiniteQueryOptions("all"),
		);

		await observer.refetch();

		expect(pageCursors()).toEqual(["cursor-start", "cursor-w49"]);
		expect(getLikedSongsNewerPage).not.toHaveBeenCalled();
	});

	it("loads the rows above a window from its first row and prepends them", async () => {
		const queryClient = new QueryClient();
		seedLikedSongsDeepLinkCaches(queryClient, accountId, slug, {
			selectedSong: createSong("w-10"),
			pages: [createPage(ids("w", 50), "cursor-w49", "cursor-w0")],
			startCursor: "cursor-start",
		});
		vi.mocked(getLikedSongsNewerPage).mockResolvedValueOnce(
			createPage(ids("n", 30), "cursor-n29", null),
		);
		const observer = new InfiniteQueryObserver(
			queryClient,
			likedSongsInfiniteQueryOptions("all"),
		);
		expect(observer.getCurrentResult().hasPreviousPage).toBe(true);

		const result = await observer.fetchPreviousPage();

		expect(getLikedSongsNewerPage).toHaveBeenCalledWith({
			data: { cursor: "cursor-w0" },
		});
		expect(result.data?.pages.map((page) => page.songs[0].track.id)).toEqual([
			"n-0",
			"w-0",
		]);
		// The newest like is loaded now: nothing above to fetch.
		expect(result.hasPreviousPage).toBe(false);
	});

	it("gives a list read from the newest like no rows above", async () => {
		const queryClient = new QueryClient();
		vi.mocked(getLikedSongsPage).mockResolvedValueOnce(
			createPage(ids("t", 50), "cursor-t49"),
		);
		const observer = new InfiniteQueryObserver(
			queryClient,
			likedSongsInfiniteQueryOptions("all"),
		);

		await observer.refetch();

		expect(pageCursors()).toEqual([undefined]);
		expect(observer.getCurrentResult().hasPreviousPage).toBe(false);
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
			{ pages: [createPage(["a", "b"], "cursor-b")], pageParams: [null] },
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
			{ pages: [createPage(["a", "b"], "cursor-b")], pageParams: [null] },
		);

		expect(
			resolveLikedSongsDeepLinkBootstrap(queryClient, {
				song: "lorde-song-z",
				isDefaultFilter: true,
			}),
		).toEqual({ slug: "lorde-song-z" });
	});

	it("returns the slug when a warm cache has the song but lacks rows below it", () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData<InfiniteData<LikedSongsPageResult>>(
			likedSongsInfiniteQueryOptions("all").queryKey,
			{ pages: [createPage(["a", "b"], "cursor-b")], pageParams: [null] },
		);

		expect(
			resolveLikedSongsDeepLinkBootstrap(queryClient, {
				song: slug,
				isDefaultFilter: true,
			}),
		).toEqual({ slug });
	});

	it("returns null when a warm cache already has room to centre the song", () => {
		const queryClient = new QueryClient();
		const rows = [
			...ids("above", LIKED_SONGS_DEEP_LINK_CENTRING_ROWS),
			"a",
			...ids("below", LIKED_SONGS_DEEP_LINK_CENTRING_ROWS),
		];
		queryClient.setQueryData<InfiniteData<LikedSongsPageResult>>(
			likedSongsInfiniteQueryOptions("all").queryKey,
			{
				pages: [createPage(rows, "cursor-tail", "cursor-head")],
				pageParams: [{ direction: "older", cursor: "cursor-start" }],
			},
		);

		expect(
			resolveLikedSongsDeepLinkBootstrap(queryClient, {
				song: slug,
				isDefaultFilter: true,
			}),
		).toBeNull();
	});

	it("returns the slug when a warm window has the song too close to its first row, with rows above unloaded", () => {
		const queryClient = new QueryClient();
		const rows = ["a", ...ids("below", LIKED_SONGS_DEEP_LINK_CENTRING_ROWS)];
		queryClient.setQueryData<InfiniteData<LikedSongsPageResult>>(
			likedSongsInfiniteQueryOptions("all").queryKey,
			{
				pages: [createPage(rows, "cursor-tail", "cursor-head")],
				pageParams: [{ direction: "older", cursor: "cursor-start" }],
			},
		);

		expect(
			resolveLikedSongsDeepLinkBootstrap(queryClient, {
				song: slug,
				isDefaultFilter: true,
			}),
		).toEqual({ slug });
	});

	it("returns null when the warm cache already reaches the real end after the song", () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData<InfiniteData<LikedSongsPageResult>>(
			likedSongsInfiniteQueryOptions("all").queryKey,
			{ pages: [createPage(["x", "a", "b"], null)], pageParams: [null] },
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
			pageParams: [null],
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
