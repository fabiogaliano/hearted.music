import type {
	InfiniteData,
	MutationFunctionContext,
} from "@tanstack/react-query";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// dismissSuggestionMutation's mutationFn is never actually invoked by these
// tests (onMutate/onSuccess/onError are called directly, matching the
// queryFn-calling-convention used elsewhere in this feature's tests), so a
// bare vi.fn() stub is enough — no real server-fn/DB wiring needed.
const dismissMatchReviewItemSuggestionMock = vi.fn();
vi.mock("@/lib/server/match-review-queue.functions", () => ({
	dismissMatchReviewItemSuggestion: (...args: unknown[]) =>
		dismissMatchReviewItemSuggestionMock(...args),
}));

// Pulled in transitively via ../queries; stubbed the same way queries.test.ts
// does so importing that module doesn't require a real dashboard feature.
vi.mock("@/features/dashboard/queries", () => ({
	dashboardKeys: { all: ["dashboard"] },
}));

const captureRouteErrorMock = vi.fn();
vi.mock("@/lib/observability/sentry", () => ({
	captureRouteError: (...args: unknown[]) => captureRouteErrorMock(...args),
}));

import {
	dismissSuggestionMutation,
	patchPresentCacheOnSuggestionDismiss,
	patchTailCacheOnSuggestionDismiss,
} from "@/features/matching/mutations";
import {
	matchReviewKeys,
	presentMatchReviewItemQueryOptions,
} from "@/features/matching/queries";
import type {
	DismissSuggestionResult,
	ListMatchReviewItemSuggestionsPage,
	MatchReviewItemRead,
	MatchReviewItemSuggestionCursor,
} from "@/lib/server/match-review-queue.functions";
import type { MatchingSong } from "@/lib/server/matching.functions";

function makeSong(id: string): MatchingSong {
	return {
		id,
		spotifyId: `sp-${id}`,
		name: `Song ${id}`,
		artist: "Artist",
		album: null,
		albumArtUrl: null,
		genres: [],
		audioFeatures: null,
		analysis: null,
	};
}

function makeSongReadyItem(
	suggestionPlaylistIds: string[],
): MatchReviewItemRead {
	return {
		status: "ready",
		itemId: "item-1",
		mode: "song",
		reviewItem: makeSong("review-song"),
		suggestions: suggestionPlaylistIds.map((playlistId) => ({
			playlist: {
				id: playlistId,
				spotifyId: `sp-${playlistId}`,
				name: `Playlist ${playlistId}`,
				description: null,
				trackCount: 10,
				imageUrl: null,
			},
			score: 0.5,
			rank: 1,
			factors: {},
		})),
	};
}

function makePlaylistReadyItem(
	suggestionSongIds: string[],
	suggestionTotal: number,
): MatchReviewItemRead {
	return {
		status: "ready",
		itemId: "item-1",
		mode: "playlist",
		reviewItem: {
			id: "playlist-1",
			spotifyId: "sp-playlist-1",
			name: "My Playlist",
			description: null,
			imageUrl: null,
			trackCount: 20,
		},
		suggestions: suggestionSongIds.map((songId) => ({
			song: makeSong(songId),
			fitScore: 0.7,
		})),
		suggestionTotal,
		nextCursor: null,
	};
}

function makeTailData(
	pagesSongIds: string[][],
): InfiniteData<
	ListMatchReviewItemSuggestionsPage,
	MatchReviewItemSuggestionCursor | null
> {
	return {
		pages: pagesSongIds.map((songIds) => ({
			suggestions: songIds.map((songId) => ({
				song: makeSong(songId),
				fitScore: 0.6,
			})),
			nextCursor: null,
		})),
		pageParams: pagesSongIds.map(() => null),
	};
}

describe("patchPresentCacheOnSuggestionDismiss (pure)", () => {
	it("returns undefined unchanged", () => {
		expect(
			patchPresentCacheOnSuggestionDismiss(undefined, "x"),
		).toBeUndefined();
	});

	it("passes through non-ready cards unchanged", () => {
		const unavailable: MatchReviewItemRead = {
			status: "unavailable",
			itemId: "item-1",
			reason: "not-entitled",
			message: "gone",
		};
		expect(patchPresentCacheOnSuggestionDismiss(unavailable, "x")).toBe(
			unavailable,
		);
	});

	it("filters the song arm by playlist id", () => {
		const item = makeSongReadyItem(["pl-1", "pl-2"]);
		const result = patchPresentCacheOnSuggestionDismiss(item, "pl-1");
		expect(result?.status).toBe("ready");
		if (result?.status !== "ready" || result.mode !== "song") throw new Error();
		expect(result.suggestions.map((s) => s.playlist.id)).toEqual(["pl-2"]);
	});

	it("filters the playlist arm by song id and decrements suggestionTotal", () => {
		const item = makePlaylistReadyItem(["song-1", "song-2"], 5);
		const result = patchPresentCacheOnSuggestionDismiss(item, "song-1");
		if (result?.status !== "ready" || result.mode !== "playlist")
			throw new Error();
		expect(result.suggestions.map((s) => s.song.id)).toEqual(["song-2"]);
		expect(result.suggestionTotal).toBe(4);
	});

	it("floors suggestionTotal at 0", () => {
		const item = makePlaylistReadyItem(["song-1"], 0);
		const result = patchPresentCacheOnSuggestionDismiss(item, "song-1");
		if (result?.status !== "ready" || result.mode !== "playlist")
			throw new Error();
		expect(result.suggestionTotal).toBe(0);
	});
});

describe("patchTailCacheOnSuggestionDismiss (pure)", () => {
	it("returns undefined unchanged", () => {
		expect(patchTailCacheOnSuggestionDismiss(undefined, "x")).toBeUndefined();
	});

	it("filters the suggestion out of every page", () => {
		const data = makeTailData([
			["a", "b"],
			["c", "b"],
		]);
		const result = patchTailCacheOnSuggestionDismiss(data, "b");
		expect(
			result?.pages.map((p) => p.suggestions.map((s) => s.song.id)),
		).toEqual([["a"], ["c"]]);
	});
});

describe("dismissSuggestionMutation", () => {
	let queryClient: QueryClient;
	const itemId = "item-1";
	const presentKey = presentMatchReviewItemQueryOptions(itemId).queryKey;
	const tailKey = [...matchReviewKeys.item(itemId), "suggestions"] as const;

	beforeEach(() => {
		vi.clearAllMocks();
		queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
	});

	// v5's onMutate/onSuccess/onError all take a trailing MutationFunctionContext
	// arg that this mutation never reads — a real QueryClient reference is the
	// only field that matters for a well-typed fake.
	function fakeMutationContext(): MutationFunctionContext {
		return { client: queryClient, meta: undefined };
	}

	function seedCaches() {
		const present = makePlaylistReadyItem(["song-1", "song-2"], 5);
		const tail = makeTailData([["song-3", "song-4"]]);
		queryClient.setQueryData(presentKey, present);
		queryClient.setQueryData(tailKey, tail);
		return { present, tail };
	}

	it("onMutate patches both caches and decrements suggestionTotal", async () => {
		const { present, tail } = seedCaches();
		const options = dismissSuggestionMutation(queryClient, itemId);
		if (!options.onMutate) throw new Error("expected onMutate");

		const context = await options.onMutate("song-1", fakeMutationContext());

		const patchedPresent =
			queryClient.getQueryData<MatchReviewItemRead>(presentKey);
		if (
			patchedPresent?.status !== "ready" ||
			patchedPresent.mode !== "playlist"
		) {
			throw new Error("expected a ready playlist card");
		}
		expect(patchedPresent.suggestions.map((s) => s.song.id)).toEqual([
			"song-2",
		]);
		expect(patchedPresent.suggestionTotal).toBe(4);

		const patchedTail =
			queryClient.getQueryData<
				InfiniteData<
					ListMatchReviewItemSuggestionsPage,
					MatchReviewItemSuggestionCursor | null
				>
			>(tailKey);
		expect(patchedTail?.pages[0]?.suggestions.map((s) => s.song.id)).toEqual([
			"song-3",
			"song-4",
		]);

		// Row dismissed is from the present cache's first page, not the tail
		// cache, so the tail cache is untouched by this particular dismiss.
		expect(context?.previousPresent).toEqual(present);
		expect(context?.previousTail).toEqual(tail);
	});

	it("onSuccess with success:false rolls back both caches to the pre-mutation snapshot", async () => {
		const { present, tail } = seedCaches();
		const options = dismissSuggestionMutation(queryClient, itemId);
		if (!options.onMutate || !options.onSuccess) {
			throw new Error("expected onMutate/onSuccess");
		}

		const context = await options.onMutate("song-1", fakeMutationContext());
		const failure: DismissSuggestionResult = {
			success: false,
			reason: "already-resolved",
		};
		await options.onSuccess(failure, "song-1", context, fakeMutationContext());

		expect(queryClient.getQueryData(presentKey)).toEqual(present);
		expect(queryClient.getQueryData(tailKey)).toEqual(tail);
	});

	it("onSuccess with success:true leaves the optimistic patch in place", async () => {
		seedCaches();
		const options = dismissSuggestionMutation(queryClient, itemId);
		if (!options.onMutate || !options.onSuccess) {
			throw new Error("expected onMutate/onSuccess");
		}

		const context = await options.onMutate("song-1", fakeMutationContext());
		const success: DismissSuggestionResult = { success: true };
		await options.onSuccess(success, "song-1", context, fakeMutationContext());

		const patchedPresent =
			queryClient.getQueryData<MatchReviewItemRead>(presentKey);
		if (
			patchedPresent?.status !== "ready" ||
			patchedPresent.mode !== "playlist"
		) {
			throw new Error("expected a ready playlist card");
		}
		expect(patchedPresent.suggestions.map((s) => s.song.id)).toEqual([
			"song-2",
		]);
	});

	it("onError restores both snapshots and reports the failure", async () => {
		const { present, tail } = seedCaches();
		const options = dismissSuggestionMutation(queryClient, itemId);
		if (!options.onMutate || !options.onError) {
			throw new Error("expected onMutate/onError");
		}

		const context = await options.onMutate("song-1", fakeMutationContext());
		const error = new Error("network down");
		await options.onError(error, "song-1", context, fakeMutationContext());

		expect(queryClient.getQueryData(presentKey)).toEqual(present);
		expect(queryClient.getQueryData(tailKey)).toEqual(tail);
		expect(captureRouteErrorMock).toHaveBeenCalledWith(error, {
			route: "match-review-suggestion-dismiss",
		});
	});
});
