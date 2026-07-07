/**
 * Tests for useMatchReviewCard — the playlist-mode tail-paging + suggestion-
 * dismiss seam (first tracer-bullet slice of useMatchReviewSession).
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubmitMatchDeckActionResult } from "@/lib/server/match-deck.functions";
import type {
	ListMatchReviewItemSuggestionsPage,
	MatchReviewItemRead,
	MatchReviewItemSuggestionCursor,
} from "@/lib/server/match-review-queue.functions";
import type { MatchingSong } from "@/lib/server/matching.functions";

const listMatchReviewItemSuggestionsMock = vi.fn();
const submitMatchDeckActionMock = vi.fn();

vi.mock("@/lib/server/match-review-queue.functions", () => ({
	listMatchReviewItemSuggestions: (...args: unknown[]) =>
		listMatchReviewItemSuggestionsMock(...args),
}));

// Dismiss now dispatches through the one deck-action command boundary; the tail
// query still pages via listMatchReviewItemSuggestions (above).
vi.mock("@/lib/server/match-deck.functions", () => ({
	submitMatchDeckAction: (...args: unknown[]) =>
		submitMatchDeckActionMock(...args),
	startOrResumeMatchDeck: vi.fn(),
	readMatchDeckCard: vi.fn(),
}));

import { readMatchDeckCardQueryOptions } from "@/features/matching/deck-queries";
import { useMatchReviewCard } from "@/features/matching/useMatchReviewCard";

// submitMatchDeckAction returns a raw TEXT actionStatus + the fresh deck view.
// dismiss-suggestion reads only the status via the classifier; the view is inert
// here (RF: the dismiss path never applies it).
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

		let resolveTailPage:
			| ((page: ListMatchReviewItemSuggestionsPage) => void)
			| undefined;
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

		if (!resolveTailPage) throw new Error("tail fetch was never issued");
		resolveTailPage({ suggestions: [], nextCursor: null });

		await waitFor(() => expect(result.current.hasMoreSuggestions).toBe(false));
	});

	it("resolves true on a successful dismiss and patches the present cache", async () => {
		const itemData = makePlaylistReadyItem(["song-1", "song-2"], null);
		queryClient.setQueryData(
			readMatchDeckCardQueryOptions(ITEM_ID).queryKey,
			itemData,
		);
		submitMatchDeckActionMock.mockResolvedValue(actionResult("dismissed"));

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
			readMatchDeckCardQueryOptions(ITEM_ID).queryKey,
		);
		if (patched?.status !== "ready" || patched.mode !== "playlist") {
			throw new Error("expected a ready playlist card");
		}
		expect(patched.suggestions.map((s) => s.song.id)).toEqual(["song-2"]);
	});

	it("resolves false and rolls back the present cache on a rejected dismiss", async () => {
		const itemData = makePlaylistReadyItem(["song-1", "song-2"], null);
		queryClient.setQueryData(
			readMatchDeckCardQueryOptions(ITEM_ID).queryKey,
			itemData,
		);
		// A non-"dismissed" TEXT status is a rejection the classifier rolls back.
		submitMatchDeckActionMock.mockResolvedValue(
			actionResult("already_resolved"),
		);

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
			readMatchDeckCardQueryOptions(ITEM_ID).queryKey,
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

	it("serializes overlapping dismisses so a failed one can't resurrect a concurrent one", async () => {
		const presentKey = readMatchDeckCardQueryOptions(ITEM_ID).queryKey;
		const itemData = makePlaylistReadyItem(["song-1", "song-2"], null);
		queryClient.setQueryData(presentKey, itemData);

		// Dismiss A (song-1) stays pending until we resolve it as a failure; dismiss
		// B (song-2) succeeds. Without serialization, B would snapshot the cache
		// while A's row is already optimistically gone, and A's later whole-snapshot
		// rollback would resurrect BOTH rows (final ["song-1","song-2"]).
		let resolveA: ((value: SubmitMatchDeckActionResult) => void) | undefined;
		submitMatchDeckActionMock.mockImplementation(
			(arg: { data: { suggestionId: string } }) => {
				if (arg.data.suggestionId === "song-1") {
					return new Promise<SubmitMatchDeckActionResult>((resolve) => {
						resolveA = resolve;
					});
				}
				return Promise.resolve(actionResult("dismissed"));
			},
		);

		const { result } = renderHook(
			() => useMatchReviewCard({ itemId: ITEM_ID, itemData, queryClient }),
			{ wrapper },
		);

		await act(async () => {
			void result.current.dismissSuggestion("song-1");
			void result.current.dismissSuggestion("song-2");
		});

		// B is queued behind A: only A's request has been issued so far.
		expect(submitMatchDeckActionMock).toHaveBeenCalledTimes(1);
		expect(submitMatchDeckActionMock).toHaveBeenCalledWith({
			data: {
				type: "dismiss-suggestion",
				itemId: ITEM_ID,
				suggestionId: "song-1",
			},
		});

		if (!resolveA) throw new Error("dismiss A was never issued");
		const settleA = resolveA;
		await act(async () => {
			settleA(actionResult("already_resolved"));
		});

		// A settled (and rolled back) before B ran, so B is issued only now.
		await waitFor(() =>
			expect(submitMatchDeckActionMock).toHaveBeenCalledTimes(2),
		);

		await waitFor(() => {
			const patched = queryClient.getQueryData<MatchReviewItemRead>(presentKey);
			if (patched?.status !== "ready" || patched.mode !== "playlist") {
				throw new Error("expected a ready playlist card");
			}
			// song-1 restored by A's rollback, song-2 dismissed by B — no resurrection.
			expect(patched.suggestions.map((s) => s.song.id)).toEqual(["song-1"]);
		});
	});

	it("does not serialize dismisses across different cards", async () => {
		// QueueCardContent stays mounted as itemId changes, so the dismiss chain
		// must be per-card: a pending dismiss on the card the user left must never
		// stall the new card's dismiss (their caches are disjoint by itemId).
		let resolveA: ((value: SubmitMatchDeckActionResult) => void) | undefined;
		submitMatchDeckActionMock.mockImplementation(
			(arg: { data: { itemId: string; suggestionId: string } }) => {
				if (arg.data.itemId === "item-a") {
					return new Promise<SubmitMatchDeckActionResult>((resolve) => {
						resolveA = resolve;
					});
				}
				return Promise.resolve(actionResult("dismissed"));
			},
		);

		const { result, rerender } = renderHook(
			({
				itemId,
				itemData,
			}: {
				itemId: string;
				itemData: MatchReviewItemRead;
			}) => useMatchReviewCard({ itemId, itemData, queryClient }),
			{
				wrapper,
				initialProps: {
					itemId: "item-a",
					itemData: makePlaylistReadyItem(["song-1"], null),
				},
			},
		);

		// Card A's dismiss is issued and left pending (item-a never resolves).
		await act(async () => {
			void result.current.dismissSuggestion("song-1");
		});
		expect(submitMatchDeckActionMock).toHaveBeenCalledTimes(1);

		// Navigate to card B without resolving A. B's dismiss must fire and settle
		// on its own; a shared chain would leave it queued behind A forever.
		rerender({
			itemId: "item-b",
			itemData: makePlaylistReadyItem(["song-9"], null),
		});
		await act(async () => {
			const dismissed = await result.current.dismissSuggestion("song-9");
			expect(dismissed).toBe(true);
		});

		expect(submitMatchDeckActionMock).toHaveBeenCalledTimes(2);
		expect(submitMatchDeckActionMock).toHaveBeenLastCalledWith({
			data: {
				type: "dismiss-suggestion",
				itemId: "item-b",
				suggestionId: "song-9",
			},
		});

		// A is still pending — B did not wait on it.
		expect(resolveA).toBeDefined();
	});

	it("routes a queued dismiss to the card it was enqueued on, not the mounted one", async () => {
		// A dismiss that queues behind a pending one on card A must still target
		// card A even if it dequeues after the user navigated to card B — itemId
		// is carried in the mutation variables, not the (per-render) observer
		// options, so it can't bind to whatever card happens to be mounted.
		const presentKeyA = readMatchDeckCardQueryOptions("item-a").queryKey;
		const presentKeyB = readMatchDeckCardQueryOptions("item-b").queryKey;
		queryClient.setQueryData(
			presentKeyA,
			makePlaylistReadyItem(["song-1", "song-2"], null),
		);
		queryClient.setQueryData(
			presentKeyB,
			makePlaylistReadyItem(["song-9"], null),
		);

		let resolveRow1: ((value: SubmitMatchDeckActionResult) => void) | undefined;
		submitMatchDeckActionMock.mockImplementation(
			(arg: { data: { itemId: string; suggestionId: string } }) => {
				if (arg.data.suggestionId === "song-1") {
					return new Promise<SubmitMatchDeckActionResult>((resolve) => {
						resolveRow1 = resolve;
					});
				}
				return Promise.resolve(actionResult("dismissed"));
			},
		);

		const { result, rerender } = renderHook(
			({
				itemId,
				itemData,
			}: {
				itemId: string;
				itemData: MatchReviewItemRead;
			}) => useMatchReviewCard({ itemId, itemData, queryClient }),
			{
				wrapper,
				initialProps: {
					itemId: "item-a",
					itemData: makePlaylistReadyItem(["song-1", "song-2"], null),
				},
			},
		);

		// Both dismisses are enqueued while card A is mounted; row 2 queues behind
		// the still-pending row 1.
		await act(async () => {
			void result.current.dismissSuggestion("song-1");
			void result.current.dismissSuggestion("song-2");
		});
		expect(submitMatchDeckActionMock).toHaveBeenCalledTimes(1);

		// Navigate to card B, THEN let row 1 settle so the queued row 2 dequeues
		// while card B is the mounted card.
		rerender({
			itemId: "item-b",
			itemData: makePlaylistReadyItem(["song-9"], null),
		});
		if (!resolveRow1) throw new Error("row 1 was never issued");
		const settleRow1 = resolveRow1;
		await act(async () => {
			settleRow1(actionResult("dismissed"));
		});

		await waitFor(() =>
			expect(submitMatchDeckActionMock).toHaveBeenCalledTimes(2),
		);
		expect(submitMatchDeckActionMock).toHaveBeenLastCalledWith({
			data: {
				type: "dismiss-suggestion",
				itemId: "item-a",
				suggestionId: "song-2",
			},
		});

		// Card A drained both rows; card B is untouched by A's queued dismiss.
		const patchedA = queryClient.getQueryData<MatchReviewItemRead>(presentKeyA);
		if (patchedA?.status !== "ready" || patchedA.mode !== "playlist") {
			throw new Error("expected a ready playlist card");
		}
		expect(patchedA.suggestions.map((s) => s.song.id)).toEqual([]);

		const patchedB = queryClient.getQueryData<MatchReviewItemRead>(presentKeyB);
		if (patchedB?.status !== "ready" || patchedB.mode !== "playlist") {
			throw new Error("expected a ready playlist card");
		}
		expect(patchedB.suggestions.map((s) => s.song.id)).toEqual(["song-9"]);
	});

	it("waitForPendingDismisses drains a dismiss queued during its own await window", async () => {
		// A whole-card action awaits waitForPendingDismisses() while row dismiss A
		// is in flight. If a row dismiss B is enqueued *during* that await, it
		// chains behind A and replaces the map entry the drain first snapshotted —
		// so awaiting only that snapshot would return while B is still mid-onMutate.
		// The drain must loop until the chain is truly quiescent.
		const presentKey = readMatchDeckCardQueryOptions(ITEM_ID).queryKey;
		const itemData = makePlaylistReadyItem(["song-1", "song-2"], null);
		queryClient.setQueryData(presentKey, itemData);

		let resolveA: ((value: SubmitMatchDeckActionResult) => void) | undefined;
		let resolveB: ((value: SubmitMatchDeckActionResult) => void) | undefined;
		submitMatchDeckActionMock.mockImplementation(
			(arg: { data: { suggestionId: string } }) =>
				new Promise<SubmitMatchDeckActionResult>((resolve) => {
					if (arg.data.suggestionId === "song-1") resolveA = resolve;
					else resolveB = resolve;
				}),
		);

		const { result } = renderHook(
			() => useMatchReviewCard({ itemId: ITEM_ID, itemData, queryClient }),
			{ wrapper },
		);

		await act(async () => {
			void result.current.dismissSuggestion("song-1");
		});
		expect(submitMatchDeckActionMock).toHaveBeenCalledTimes(1);

		let drained = false;
		let drainPromise: Promise<void> | undefined;
		await act(async () => {
			drainPromise = result.current.waitForPendingDismisses().then(() => {
				drained = true;
			});
			// Enqueued after the drain snapshotted A — queues behind it and swaps
			// the map entry, reproducing the narrow real-world click window.
			void result.current.dismissSuggestion("song-2");
		});
		expect(submitMatchDeckActionMock).toHaveBeenCalledTimes(1);

		// A settles → B is issued, but B is still pending, so the drain must NOT
		// have resolved yet. The pre-fix single-read would have resolved here.
		if (!resolveA) throw new Error("dismiss A was never issued");
		const settleA = resolveA;
		await act(async () => {
			settleA(actionResult("dismissed"));
		});
		await waitFor(() =>
			expect(submitMatchDeckActionMock).toHaveBeenCalledTimes(2),
		);
		expect(drained).toBe(false);

		// B settles → the drain finally resolves.
		if (!resolveB) throw new Error("dismiss B was never issued");
		const settleB = resolveB;
		await act(async () => {
			settleB(actionResult("dismissed"));
		});
		await waitFor(() => expect(drained).toBe(true));
		await drainPromise;
	});
});
