import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DB-free coverage for QueueCardContent's whole-card action handlers (M7,
 * M9, N1 second half). Extracted alongside the component itself out of
 * match.tsx (Deepening #2) — QueueCardContent is a real named export here, so
 * this test imports it directly instead of walking a route element tree.
 *
 * The session-state contract this component takes changed shape in the same
 * extraction: the four raw setState dispatchers (onSessionStats/onAddedTo/
 * onPastItems/onCurrentItemId) plus onLockNavigation/onReleaseNavigation
 * collapsed into a single `sessionActions` object — useMatchDeckSession's
 * domain-named actions (advanceTo/recordSkip/recordDismissal/lockNavigation/
 * releaseNavigation/...). Tests assert against those mocked methods; the
 * underlying handleNext/applyResolvedView closures under test are unchanged.
 */

const {
	mockUseQueryClient,
	mockUseSuspenseQuery,
	mockUseMatchReviewCard,
	mockUseSpotifyReconnectState,
	mockSubmitMatchDeckAction,
} = vi.hoisted(() => ({
	mockUseQueryClient: vi.fn(),
	mockUseSuspenseQuery: vi.fn(),
	mockUseMatchReviewCard: vi.fn(),
	mockUseSpotifyReconnectState: vi.fn(),
	mockSubmitMatchDeckAction: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: mockUseQueryClient,
	useSuspenseQuery: mockUseSuspenseQuery,
	// useLockedMutation's only touch point on useMutation: mutateAsync just runs
	// mutationFn directly, matching real behavior closely enough for these
	// DB-free handler tests (no caching/retry semantics under test here).
	useMutation: ({
		mutationFn,
	}: {
		mutationFn: (v: unknown) => Promise<unknown>;
	}) => ({
		mutateAsync: mutationFn,
		isPending: false,
	}),
}));

vi.mock("@tanstack/react-router", () => ({ Link: vi.fn() }));

vi.mock("react", () => ({
	useCallback: (fn: unknown) => fn,
	useEffect: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("@/features/matching/components/MatchModeToggle", () => ({
	MatchModeToggle: vi.fn(),
}));

vi.mock("@/features/matching/deck-queries", () => ({
	matchDeckQueryOptions: (accountId: string, orientation: string) => ({
		queryKey: ["match-deck", "deck", accountId, orientation],
	}),
	readMatchDeckCardQueryOptions: (itemId: string) => ({
		queryKey: ["match-deck", "card", itemId, "read"],
	}),
}));

vi.mock("@/features/matching/Matching", () => ({ Matching: vi.fn() }));

vi.mock("@/features/matching/useMatchReviewCard", () => ({
	useMatchReviewCard: mockUseMatchReviewCard,
}));

vi.mock("@/lib/extension/spotify-action-outcome", () => ({
	outcomeFromCommandResponse: vi.fn(),
}));

vi.mock("@/lib/extension/spotify-client", () => ({
	addToPlaylist: vi.fn(),
}));

vi.mock("@/lib/extension/useSpotifyReconnectState", () => ({
	useSpotifyReconnectState: mockUseSpotifyReconnectState,
}));

vi.mock("@/lib/observability/sentry", () => ({
	captureRouteError: vi.fn(),
}));

vi.mock("@/lib/server/match-deck.functions", () => ({
	submitMatchDeckAction: mockSubmitMatchDeckAction,
}));

vi.mock("@/lib/theme/fonts", () => ({ fonts: { body: "", display: "" } }));

function makeQueryClient() {
	return {
		cancelQueries: vi.fn().mockResolvedValue(undefined),
		setQueryData: vi.fn(),
		prefetchQuery: vi.fn().mockResolvedValue(undefined),
		invalidateQueries: vi.fn(),
	};
}

function makeSessionActions() {
	return {
		recordAddition: vi.fn(),
		clearAddedTo: vi.fn(),
		recordPastItem: vi.fn(),
		recordSkip: vi.fn(),
		recordDismissal: vi.fn(),
		advanceTo: vi.fn(),
		lockNavigation: vi.fn(() => true),
		releaseNavigation: vi.fn(),
	};
}

function makeReadyItemData(itemId: string) {
	return {
		status: "ready" as const,
		itemId,
		mode: "song" as const,
		reviewItem: {
			id: "song-1",
			spotifyId: "sp-song-1",
			name: "Test Song",
			artist: "Test Artist",
			album: null,
			albumArtUrl: null,
			genres: [],
			audioFeatures: null,
			analysis: null,
		},
		suggestions: [],
		suggestionTotal: 0,
		nextCursor: null,
	};
}

function makeCompletionStats() {
	return {
		totalItems: 1,
		itemsMatched: 0,
		totalAdditions: 0,
		dismissedCount: 0,
		skippedCount: 0,
	};
}

interface CardTestHarness {
	queryClient: ReturnType<typeof makeQueryClient>;
	sessionActions: ReturnType<typeof makeSessionActions>;
	onNext: () => Promise<void>;
}

async function renderCard(itemId = "item-1"): Promise<CardTestHarness> {
	const { QueueCardContent } = await import("../QueueCardContent");

	mockUseSuspenseQuery.mockReturnValue({ data: makeReadyItemData(itemId) });
	mockUseMatchReviewCard.mockReturnValue({
		currentReviewItem: {
			mode: "song",
			song: {
				id: "song-1",
				spotifyId: "sp-song-1",
				name: "Test Song",
				artist: "Test Artist",
			},
		},
		currentSuggestions: [],
		suggestionTotal: undefined,
		hasMoreSuggestions: false,
		isLoadingMoreSuggestions: false,
		loadMoreSuggestions: vi.fn(),
		loadMoreError: null,
		retryLoadMore: vi.fn(),
		dismissSuggestion: vi.fn(),
		waitForPendingDismisses: vi.fn().mockResolvedValue(undefined),
	});
	mockUseSpotifyReconnectState.mockReturnValue({
		reconnectNeeded: false,
		setReconnectNeeded: vi.fn(),
	});

	const queryClient = makeQueryClient();
	const sessionActions = makeSessionActions();

	const element = QueueCardContent({
		accountId: "acct-1",
		itemId,
		currentIndex: 0,
		total: 1,
		mode: "playlist",
		unresolvedIds: [itemId],
		addedTo: [],
		navigationStatus: "idle",
		pastItems: [],
		completionStats: makeCompletionStats(),
		sessionActions,
		onModeChange: vi.fn(),
		onExit: vi.fn(),
		analytics: { capture: vi.fn() } as never,
		queryClient: queryClient as never,
	});

	const onNext = (
		element as unknown as { props: { onNext: () => Promise<void> } }
	).props.onNext;

	return { queryClient, sessionActions, onNext };
}

describe("QueueCardContent whole-card action handlers", () => {
	beforeEach(() => {
		mockUseQueryClient.mockReset();
		mockUseSuspenseQuery.mockReset();
		mockUseMatchReviewCard.mockReset();
		mockUseSpotifyReconnectState.mockReset();
		mockSubmitMatchDeckAction.mockReset();
	});

	describe("M7 — rejected finish-card reconciliation", () => {
		it("already_resolved applies result.view and does not bump session stats", async () => {
			const { queryClient, sessionActions, onNext } = await renderCard();

			const view = {
				itemIds: ["item-2"],
				cards: {
					current: {
						itemId: "item-2",
						position: 0,
						presentation: { status: "ready", itemId: "item-2" },
					},
					next: null,
				},
				progress: {
					total: 2,
					remaining: 1,
					caughtUp: false,
					hiddenReviewItemCount: 0,
				},
			};
			mockSubmitMatchDeckAction.mockResolvedValue({
				actionStatus: "already_resolved",
				view,
			});

			await onNext();

			// The server's fresh view is authoritative — it must be applied to the
			// deck cache (M7), even though this call itself was rejected.
			expect(queryClient.setQueryData).toHaveBeenCalledWith(
				["match-deck", "deck", "acct-1", "playlist"],
				view,
			);
			expect(sessionActions.advanceTo).toHaveBeenCalledWith("item-2");
			// Not a real finish — this client didn't resolve the item (another
			// tab/session already did), so it must not count as a skip/finish.
			expect(sessionActions.recordSkip).not.toHaveBeenCalled();
			// Reconciling to the fresh view changes the itemId, which releases
			// navigation via the (mocked-away) itemId-change effect in production —
			// this handler itself must not also call it explicitly.
			expect(sessionActions.releaseNavigation).not.toHaveBeenCalled();
		});

		it("no_captured_pairs releases navigation without applying the view", async () => {
			const { queryClient, sessionActions, onNext } = await renderCard();

			const view = {
				itemIds: ["item-1"],
				cards: {
					current: {
						itemId: "item-1",
						position: 0,
						presentation: { status: "ready", itemId: "item-1" },
					},
					next: null,
				},
				progress: {
					total: 1,
					remaining: 1,
					caughtUp: false,
					hiddenReviewItemCount: 0,
				},
			};
			mockSubmitMatchDeckAction.mockResolvedValue({
				actionStatus: "no_captured_pairs",
				view,
			});

			await onNext();

			// Transient/not-yet-captured (H4) — must NOT advance or apply the view;
			// releasing the lock lets the user retry.
			expect(queryClient.setQueryData).not.toHaveBeenCalled();
			expect(sessionActions.advanceTo).not.toHaveBeenCalled();
			expect(sessionActions.recordSkip).not.toHaveBeenCalled();
			expect(sessionActions.releaseNavigation).toHaveBeenCalledTimes(1);
		});
	});

	describe("N1 (second half) — applyResolvedView routes a promoted retryable-error card through prefetchQuery", () => {
		it("prefetches a promoted retryable-error card instead of seeding it into the card cache", async () => {
			const { queryClient, sessionActions, onNext } = await renderCard();

			const view = {
				itemIds: ["item-2", "item-3"],
				cards: {
					current: {
						itemId: "item-2",
						position: 0,
						presentation: {
							status: "retryable-error",
							itemId: "item-2",
							message: "Couldn't load this match card. Try again.",
						},
					},
					next: {
						itemId: "item-3",
						position: 1,
						presentation: { status: "ready", itemId: "item-3" },
					},
				},
				progress: {
					total: 3,
					remaining: 2,
					caughtUp: false,
					hiddenReviewItemCount: 0,
				},
			};
			mockSubmitMatchDeckAction.mockResolvedValue({
				actionStatus: "completed_added",
				view,
			});

			await onNext();

			// The promoted current card is a transient retryable-error — must be
			// re-read through the authoritative card read (prefetchQuery), never
			// pinned into the long-lived card cache via setQueryData (mirrors the
			// loader-side test at match.test.ts ~303-343).
			expect(queryClient.prefetchQuery).toHaveBeenCalledWith({
				queryKey: ["match-deck", "card", "item-2", "read"],
			});
			expect(queryClient.setQueryData).not.toHaveBeenCalledWith(
				["match-deck", "card", "item-2", "read"],
				expect.anything(),
			);
			// The promoted next card is ready — seeded normally.
			expect(queryClient.setQueryData).toHaveBeenCalledWith(
				["match-deck", "card", "item-3", "read"],
				view.cards.next.presentation,
			);
			expect(sessionActions.advanceTo).toHaveBeenCalledWith("item-2");
		});
	});

	describe("M9 — cancelQueries precedes the card-cache writes", () => {
		it("awaits cancelQueries on exactly the written card keys before any setQueryData call", async () => {
			const { queryClient, onNext } = await renderCard();

			const view = {
				itemIds: ["item-2", "item-3"],
				cards: {
					current: {
						itemId: "item-2",
						position: 0,
						presentation: { status: "ready", itemId: "item-2" },
					},
					next: {
						itemId: "item-3",
						position: 1,
						presentation: { status: "ready", itemId: "item-3" },
					},
				},
				progress: {
					total: 3,
					remaining: 2,
					caughtUp: false,
					hiddenReviewItemCount: 0,
				},
			};
			mockSubmitMatchDeckAction.mockResolvedValue({
				actionStatus: "completed_added",
				view,
			});

			await onNext();

			const cancelCalls = queryClient.cancelQueries.mock.calls.map(
				(call) => (call[0] as { queryKey: unknown[] }).queryKey,
			);
			expect(cancelCalls).toEqual([
				["match-deck", "card", "item-2", "read"],
				["match-deck", "card", "item-3", "read"],
			]);

			// Ordering: every cancelQueries call must be invoked strictly before any
			// setQueryData call — the warm-ahead prefetch effect races these writes
			// (M9), so cancellation must land first.
			const lastCancelOrder = Math.max(
				...queryClient.cancelQueries.mock.invocationCallOrder,
			);
			const firstSetOrder = Math.min(
				...queryClient.setQueryData.mock.invocationCallOrder,
			);
			expect(lastCancelOrder).toBeLessThan(firstSetOrder);

			// cancelQueries must only target the two card keys it's about to write —
			// never the deck key itself (no equivalent concurrent prefetcher there).
			expect(queryClient.cancelQueries).not.toHaveBeenCalledWith({
				queryKey: ["match-deck", "deck", "acct-1", "playlist"],
			});
		});
	});
});
