/**
 * Tests for useMatchReviewCard — the playlist-mode tail-paging + suggestion-
 * dismiss seam (first tracer-bullet slice of useMatchReviewSession).
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	DismissSuggestionResult,
	ListMatchReviewItemSuggestionsPage,
	MatchReviewItemRead,
	MatchReviewItemSuggestionCursor,
} from "@/lib/server/match-review-queue.functions";
import type { MatchingSong } from "@/lib/server/matching.functions";

const listMatchReviewItemSuggestionsMock = vi.fn();
const dismissMatchReviewItemSuggestionMock = vi.fn();

vi.mock("@/lib/server/match-review-queue.functions", () => ({
	listMatchReviewItemSuggestions: (...args: unknown[]) =>
		listMatchReviewItemSuggestionsMock(...args),
	dismissMatchReviewItemSuggestion: (...args: unknown[]) =>
		dismissMatchReviewItemSuggestionMock(...args),
}));

vi.mock("@/features/dashboard/queries", () => ({
	dashboardKeys: { all: ["dashboard"] },
}));

import { presentMatchReviewItemQueryOptions } from "@/features/matching/queries";
import { useMatchReviewCard } from "@/features/matching/useMatchReviewCard";

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

const ITEM_ID = "item-1";

function makePlaylistReadyItem(
	suggestionSongIds: string[],
	nextCursor: MatchReviewItemSuggestionCursor | null,
	suggestionTotal = 10,
): MatchReviewItemRead {
	return {
		status: "ready",
		itemId: ITEM_ID,
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
		nextCursor,
	};
}

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}

describe("useMatchReviewCard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
	});

	it("merges the present-card first page with a resolved tail page, deduped by song id", async () => {
		const itemData = makePlaylistReadyItem(["song-1", "song-2"], {
			fitScore: 0.7,
			modelRank: 2,
			songId: "song-2",
		});
		const tailPage: ListMatchReviewItemSuggestionsPage = {
			// song-2 duplicates the present card's first page — the merge must
			// keep only one copy of it.
			suggestions: [
				{ song: makeSong("song-2"), fitScore: 0.65 },
				{ song: makeSong("song-3"), fitScore: 0.6 },
			],
			nextCursor: null,
		};
		listMatchReviewItemSuggestionsMock.mockResolvedValue(tailPage);

		const { result } = renderHook(
			() => useMatchReviewCard({ itemId: ITEM_ID, itemData, queryClient }),
			{ wrapper },
		);

		await waitFor(() =>
			expect(result.current.currentSuggestions).toHaveLength(3),
		);

		const songIds = result.current.currentSuggestions.map((s) =>
			s.mode === "playlist" ? s.song.id : null,
		);
		expect(songIds).toEqual(["song-1", "song-2", "song-3"]);
		expect(listMatchReviewItemSuggestionsMock).toHaveBeenCalledWith({
			data: {
				itemId: ITEM_ID,
				cursor: { fitScore: 0.7, modelRank: 2, songId: "song-2" },
			},
		});
	});

	it("keeps hasMoreSuggestions true until the first auto tail fetch settles", async () => {
		const itemData = makePlaylistReadyItem(["song-1"], {
			fitScore: 0.7,
			modelRank: 1,
			songId: "song-1",
		});

		let resolveTailPage!: (page: ListMatchReviewItemSuggestionsPage) => void;
		listMatchReviewItemSuggestionsMock.mockReturnValue(
			new Promise<ListMatchReviewItemSuggestionsPage>((resolve) => {
				resolveTailPage = resolve;
			}),
		);

		const { result } = renderHook(
			() => useMatchReviewCard({ itemId: ITEM_ID, itemData, queryClient }),
			{ wrapper },
		);

		// The auto first tail fetch is in flight (initialCursor !== null, no data
		// yet) — hasMoreSuggestions must read true even though hasNextPage is
		// still its pre-fetch false, or the sentinel/footer would flash "no more"
		// before the first page settles.
		expect(result.current.hasMoreSuggestions).toBe(true);

		resolveTailPage({ suggestions: [], nextCursor: null });

		await waitFor(() => expect(result.current.hasMoreSuggestions).toBe(false));
	});

	it("resolves true on a successful dismiss and patches the present cache", async () => {
		const itemData = makePlaylistReadyItem(["song-1", "song-2"], null);
		queryClient.setQueryData(
			presentMatchReviewItemQueryOptions(ITEM_ID).queryKey,
			itemData,
		);
		const successResult: DismissSuggestionResult = { success: true };
		dismissMatchReviewItemSuggestionMock.mockResolvedValue(successResult);

		const { result } = renderHook(
			() => useMatchReviewCard({ itemId: ITEM_ID, itemData, queryClient }),
			{ wrapper },
		);

		let dismissed: boolean | undefined;
		await act(async () => {
			dismissed = await result.current.dismissSuggestion("song-1");
		});

		expect(dismissed).toBe(true);
		const patched = queryClient.getQueryData<MatchReviewItemRead>(
			presentMatchReviewItemQueryOptions(ITEM_ID).queryKey,
		);
		if (patched?.status !== "ready" || patched.mode !== "playlist") {
			throw new Error("expected a ready playlist card");
		}
		expect(patched.suggestions.map((s) => s.song.id)).toEqual(["song-2"]);
	});

	it("resolves false and rolls back the present cache on a rejected dismiss", async () => {
		const itemData = makePlaylistReadyItem(["song-1", "song-2"], null);
		queryClient.setQueryData(
			presentMatchReviewItemQueryOptions(ITEM_ID).queryKey,
			itemData,
		);
		const failureResult: DismissSuggestionResult = {
			success: false,
			reason: "already-resolved",
		};
		dismissMatchReviewItemSuggestionMock.mockResolvedValue(failureResult);

		const { result } = renderHook(
			() => useMatchReviewCard({ itemId: ITEM_ID, itemData, queryClient }),
			{ wrapper },
		);

		let dismissed: boolean | undefined;
		await act(async () => {
			dismissed = await result.current.dismissSuggestion("song-1");
		});

		expect(dismissed).toBe(false);
		const patched = queryClient.getQueryData<MatchReviewItemRead>(
			presentMatchReviewItemQueryOptions(ITEM_ID).queryKey,
		);
		if (patched?.status !== "ready" || patched.mode !== "playlist") {
			throw new Error("expected a ready playlist card");
		}
		// Optimistic removal was rolled back — both songs are still present.
		expect(patched.suggestions.map((s) => s.song.id)).toEqual([
			"song-1",
			"song-2",
		]);
	});
});
