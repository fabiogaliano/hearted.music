import { describe, expect, it, vi } from "vitest";

// The deck query options are thin wrappers over the Phase 3 server fns; mock the
// server modules so the tests drive the key/queryFn contract without a network.
const startOrResumeMatchDeckMock = vi.fn();
const readMatchDeckCardMock = vi.fn();
const listMatchReviewItemSuggestionsMock = vi.fn();

vi.mock("@/lib/server/match-deck.functions", () => ({
	startOrResumeMatchDeck: (...args: unknown[]) =>
		startOrResumeMatchDeckMock(...args),
	readMatchDeckCard: (...args: unknown[]) => readMatchDeckCardMock(...args),
}));

vi.mock("@/lib/server/match-review-queue.functions", () => ({
	listMatchReviewItemSuggestions: (...args: unknown[]) =>
		listMatchReviewItemSuggestionsMock(...args),
}));

import {
	matchDeckCardSuggestionsInfiniteQueryOptions,
	matchDeckKeys,
	matchDeckQueryOptions,
	readMatchDeckCardQueryOptions,
} from "@/features/matching/deck-queries";

describe("matchDeckQueryOptions", () => {
	it("keys per (account, orientation) and calls startOrResumeMatchDeck with the orientation", async () => {
		startOrResumeMatchDeckMock.mockResolvedValue({ status: "building" });
		const options = matchDeckQueryOptions("acct-1", "playlist");

		expect(options.queryKey).toEqual(matchDeckKeys.deck("acct-1", "playlist"));
		expect(options.staleTime).toBe(60_000);

		const queryFn = options.queryFn;
		if (typeof queryFn !== "function") throw new Error("expected a queryFn");
		await queryFn({} as never);

		expect(startOrResumeMatchDeckMock).toHaveBeenCalledWith({
			data: { orientation: "playlist" },
		});
	});
});

describe("readMatchDeckCardQueryOptions", () => {
	it("keys under the card prefix and calls readMatchDeckCard with the itemId", async () => {
		readMatchDeckCardMock.mockResolvedValue({ status: "ready" });
		const options = readMatchDeckCardQueryOptions("item-9");

		expect(options.queryKey).toEqual([...matchDeckKeys.card("item-9"), "read"]);
		expect(options.staleTime).toBe(30 * 60_000);

		const queryFn = options.queryFn;
		if (typeof queryFn !== "function") throw new Error("expected a queryFn");
		await queryFn({} as never);

		expect(readMatchDeckCardMock).toHaveBeenCalledWith({
			data: { itemId: "item-9" },
		});
	});
});

describe("matchDeckCardSuggestionsInfiniteQueryOptions", () => {
	it("is disabled when the initial cursor is null (song cards / whole first page)", () => {
		const options = matchDeckCardSuggestionsInfiniteQueryOptions(
			"item-1",
			null,
		);
		expect(options.enabled).toBe(false);
		expect(options.initialPageParam).toBeNull();
		expect(options.queryKey).toEqual([
			...matchDeckKeys.card("item-1"),
			"suggestions",
		]);
	});

	it("is enabled with a cursor, pages via listMatchReviewItemSuggestions, and stops on a null nextCursor", async () => {
		const cursor = { fitScore: 0.8, modelRank: 3, songId: "song-3" };
		listMatchReviewItemSuggestionsMock.mockResolvedValue({
			suggestions: [],
			nextCursor: null,
		});
		const options = matchDeckCardSuggestionsInfiniteQueryOptions(
			"item-1",
			cursor,
		);

		expect(options.enabled).toBe(true);
		expect(options.initialPageParam).toEqual(cursor);
		// getNextPageParam maps a null tail to undefined so the query stops.
		expect(
			options.getNextPageParam(
				{ suggestions: [], nextCursor: null },
				[],
				cursor,
				[],
			),
		).toBeUndefined();

		const queryFn = options.queryFn;
		if (typeof queryFn !== "function") throw new Error("expected a queryFn");
		await queryFn({ pageParam: cursor } as never);
		expect(listMatchReviewItemSuggestionsMock).toHaveBeenCalledWith({
			data: { itemId: "item-1", cursor },
		});
	});
});
