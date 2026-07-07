import type {
	InfiniteData,
	MutationFunctionContext,
} from "@tanstack/react-query";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// dismissSuggestionMutation's mutationFn is never actually invoked by these
// tests (onMutate/onSuccess/onError are called directly, matching the
// queryFn-calling-convention used elsewhere in this feature's tests), so a bare
// vi.fn() stub is enough — no real server-fn/DB wiring needed. The deck-query
// options the mutation keys off are real (see the deck-queries import below), so
// the server-fn modules deck-queries pulls in are mocked instead.
const submitMatchDeckActionMock = vi.fn();
vi.mock("@/lib/server/match-deck.functions", () => ({
	submitMatchDeckAction: (...args: unknown[]) =>
		submitMatchDeckActionMock(...args),
	startOrResumeMatchDeck: vi.fn(),
	readMatchDeckCard: vi.fn(),
}));

vi.mock("@/lib/server/match-review-queue.functions", () => ({
	listMatchReviewItemSuggestions: vi.fn(),
}));

const captureRouteErrorMock = vi.fn();
vi.mock("@/lib/observability/sentry", () => ({
	captureRouteError: (...args: unknown[]) => captureRouteErrorMock(...args),
}));

import {
	matchDeckKeys,
	readMatchDeckCardQueryOptions,
} from "@/features/matching/deck-queries";
import {
	dismissSuggestionMutation,
	patchPresentCacheOnSuggestionDismiss,
	patchTailCacheOnSuggestionDismiss,
} from "@/features/matching/mutations";
import type { SubmitMatchDeckActionResult } from "@/lib/server/match-deck.functions";
import type {
	ListMatchReviewItemSuggestionsPage,
	MatchReviewItemRead,
	MatchReviewItemSuggestionCursor,
} from "@/lib/server/match-review-queue.functions";
import type { MatchingSong } from "@/lib/server/matching.functions";

// submitMatchDeckAction returns a raw TEXT actionStatus + the fresh deck view;
// dismiss-suggestion reads only the status (via the classifier) and discards the
// view (RF), so the view here is an inert placeholder the mutation never applies.
function actionResult(actionStatus: string): SubmitMatchDeckActionResult {
	return { actionStatus, view: { status: "building" } };
}

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
		suggestionTotal: suggestionPlaylistIds.length,
		nextCursor: null,
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
	// Keys retargeted to the deck caches (Phase 4): present → the deck card read,
	// tail → the deck card suggestions infinite query.
	const presentKey = readMatchDeckCardQueryOptions(itemId).queryKey;
	const tailKey = [...matchDeckKeys.card(itemId), "suggestions"] as const;

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
		const options = dismissSuggestionMutation(queryClient);
		if (!options.onMutate) throw new Error("expected onMutate");

		const context = await options.onMutate(
			{ itemId, suggestionId: "song-1" },
			fakeMutationContext(),
		);

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

	it("onSuccess with a rejection status rolls back both caches to the pre-mutation snapshot", async () => {
		const { present, tail } = seedCaches();
		const options = dismissSuggestionMutation(queryClient);
		if (!options.onMutate || !options.onSuccess) {
			throw new Error("expected onMutate/onSuccess");
		}

		const context = await options.onMutate(
			{ itemId, suggestionId: "song-1" },
			fakeMutationContext(),
		);
		// A non-"dismissed" TEXT status is a rejection the classifier rolls back.
		await options.onSuccess(
			actionResult("already_resolved"),
			{ itemId, suggestionId: "song-1" },
			context,
			fakeMutationContext(),
		);

		expect(queryClient.getQueryData(presentKey)).toEqual(present);
		expect(queryClient.getQueryData(tailKey)).toEqual(tail);
	});

	it("onSuccess with the 'dismissed' status leaves the optimistic patch in place", async () => {
		seedCaches();
		const options = dismissSuggestionMutation(queryClient);
		if (!options.onMutate || !options.onSuccess) {
			throw new Error("expected onMutate/onSuccess");
		}

		const context = await options.onMutate(
			{ itemId, suggestionId: "song-1" },
			fakeMutationContext(),
		);
		await options.onSuccess(
			actionResult("dismissed"),
			{ itemId, suggestionId: "song-1" },
			context,
			fakeMutationContext(),
		);

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

	it("leaves a tail page that loads during a dismiss whose snapshot had no tail data", async () => {
		// The auto first-tail-page window: present has data, the tail cache is
		// still empty (its first page is in flight and hasn't resolved).
		const present = makePlaylistReadyItem(["song-1", "song-2"], 5);
		queryClient.setQueryData(presentKey, present);

		const options = dismissSuggestionMutation(queryClient);
		if (!options.onMutate || !options.onError) {
			throw new Error("expected onMutate/onError");
		}

		const context = await options.onMutate(
			{ itemId, suggestionId: "song-1" },
			fakeMutationContext(),
		);
		expect(context?.previousTail).toBeUndefined();

		// The first tail page resolves after onMutate captured an empty snapshot.
		const lateTail = makeTailData([["song-9", "song-10"]]);
		queryClient.setQueryData(tailKey, lateTail);

		// A failed dismiss rolls back the present card but must not clobber the
		// freshly loaded tail with the empty (undefined) snapshot — doing so would
		// re-strand the tail with no way to page in the rest of the card.
		await options.onError(
			new Error("boom"),
			{ itemId, suggestionId: "song-1" },
			context,
			fakeMutationContext(),
		);

		expect(queryClient.getQueryData(presentKey)).toEqual(present);
		expect(queryClient.getQueryData(tailKey)).toEqual(lateTail);
	});

	it("onError restores both snapshots and reports the failure", async () => {
		const { present, tail } = seedCaches();
		const options = dismissSuggestionMutation(queryClient);
		if (!options.onMutate || !options.onError) {
			throw new Error("expected onMutate/onError");
		}

		const context = await options.onMutate(
			{ itemId, suggestionId: "song-1" },
			fakeMutationContext(),
		);
		const error = new Error("network down");
		await options.onError(
			error,
			{ itemId, suggestionId: "song-1" },
			context,
			fakeMutationContext(),
		);

		expect(queryClient.getQueryData(presentKey)).toEqual(present);
		expect(queryClient.getQueryData(tailKey)).toEqual(tail);
		expect(captureRouteErrorMock).toHaveBeenCalledWith(error, {
			route: "match-review-suggestion-dismiss",
		});
	});
});
