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
	mockUseExtensionConnection,
	mockReportSpotifyAuthFailure,
	mockReportSpotifyAuthSuccess,
	mockSubmitMatchDeckAction,
	mockOutcomeFromCommandResponse,
	mockAddToPlaylist,
} = vi.hoisted(() => ({
	mockUseQueryClient: vi.fn(),
	mockUseSuspenseQuery: vi.fn(),
	mockUseMatchReviewCard: vi.fn(),
	mockUseExtensionConnection: vi.fn(),
	mockReportSpotifyAuthFailure: vi.fn(),
	mockReportSpotifyAuthSuccess: vi.fn(),
	mockSubmitMatchDeckAction: vi.fn(),
	mockOutcomeFromCommandResponse: vi.fn(),
	mockAddToPlaylist: vi.fn(),
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
	outcomeFromCommandResponse: mockOutcomeFromCommandResponse,
}));

vi.mock("@/lib/extension/spotify-client", () => ({
	addToPlaylist: mockAddToPlaylist,
}));

vi.mock("@/lib/extension/connection/useExtensionConnection", () => ({
	useExtensionConnection: mockUseExtensionConnection,
}));

vi.mock("@/lib/extension/connection/report-failure", () => ({
	reportSpotifyAuthFailure: mockReportSpotifyAuthFailure,
	reportSpotifyAuthSuccess: mockReportSpotifyAuthSuccess,
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
	onAdd: (suggestionId: string) => Promise<void>;
	reconnectNeeded: boolean;
	mismatchProfile: unknown;
	onRecheckConnection: () => Promise<void>;
	refetch: ReturnType<typeof vi.fn>;
}

function makeSongReviewItem() {
	return {
		mode: "song" as const,
		song: {
			id: "song-1",
			spotifyId: "sp-song-1",
			name: "Test Song",
			artist: "Test Artist",
		},
	};
}

async function renderCard(
	itemId = "item-1",
	options?: {
		verdict?: { kind: string; extensionProfile?: unknown };
		currentSuggestions?: unknown[];
	},
): Promise<CardTestHarness> {
	const { QueueCardContent } = await import("../QueueCardContent");

	mockUseSuspenseQuery.mockReturnValue({ data: makeReadyItemData(itemId) });
	mockUseMatchReviewCard.mockReturnValue({
		currentReviewItem: makeSongReviewItem(),
		currentSuggestions: options?.currentSuggestions ?? [],
		suggestionTotal: undefined,
		hasMoreSuggestions: false,
		isLoadingMoreSuggestions: false,
		loadMoreSuggestions: vi.fn(),
		loadMoreError: null,
		retryLoadMore: vi.fn(),
		dismissSuggestion: vi.fn(),
		waitForPendingDismisses: vi.fn().mockResolvedValue(undefined),
	});
	const refetch = vi.fn().mockResolvedValue(undefined);
	mockUseExtensionConnection.mockReturnValue({
		connection: undefined,
		verdict: options?.verdict ?? { kind: "ok" },
		refetch,
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
		linkedSpotifyId: null,
	});

	const props = (
		element as unknown as {
			props: {
				onNext: () => Promise<void>;
				onAdd: (suggestionId: string) => Promise<void>;
				reconnectNeeded: boolean;
				mismatchProfile: unknown;
				onRecheckConnection: () => Promise<void>;
			};
		}
	).props;

	return {
		queryClient,
		sessionActions,
		onNext: props.onNext,
		onAdd: props.onAdd,
		reconnectNeeded: props.reconnectNeeded,
		mismatchProfile: props.mismatchProfile,
		onRecheckConnection: props.onRecheckConnection,
		refetch,
	};
}

describe("QueueCardContent whole-card action handlers", () => {
	beforeEach(() => {
		mockUseQueryClient.mockReset();
		mockUseSuspenseQuery.mockReset();
		mockUseMatchReviewCard.mockReset();
		mockUseExtensionConnection.mockReset();
		mockReportSpotifyAuthFailure.mockReset();
		mockReportSpotifyAuthSuccess.mockReset();
		mockSubmitMatchDeckAction.mockReset();
		mockOutcomeFromCommandResponse.mockReset();
		mockAddToPlaylist.mockReset();
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

	// 05-liked-songs-matching.md: the per-song useSpotifyReconnectState poll is
	// gone — reconnectNeeded now mirrors the shared connection verdict, and a
	// failed/successful add-to-playlist pushes into that shared state instead
	// of a local flag.
	describe("05 — shared connection verdict replaces per-song reconnect state", () => {
		it("reconnectNeeded mirrors the shared verdict instead of a local flag", async () => {
			const disconnected = await renderCard("item-1", {
				verdict: { kind: "spotify-disconnected" },
			});
			expect(disconnected.reconnectNeeded).toBe(true);

			const ok = await renderCard("item-1", { verdict: { kind: "ok" } });
			expect(ok.reconnectNeeded).toBe(false);

			// mismatch/unpaired/unverifiable/checking are deliberately NOT treated
			// as reconnectNeeded here — only spotify-disconnected is. Mismatch gets
			// its own signal (mismatchProfile, see the block below) rather than
			// reusing reconnectNeeded: ReconnectPrompt's copy/repair path is wrong
			// for "connected, just as the wrong person" (see useSpotifyGate.ts).
			const mismatch = await renderCard("item-1", {
				verdict: { kind: "mismatch", extensionProfile: { spotifyId: "x" } },
			});
			expect(mismatch.reconnectNeeded).toBe(false);
		});

		it("pushes reportSpotifyAuthFailure on a reconnect-required Spotify outcome, and bails before the deck write", async () => {
			const { queryClient, onAdd } = await renderCard("item-1", {
				currentSuggestions: [
					{
						mode: "song",
						playlist: { id: "pl-1", spotifyId: "sp-pl-1", name: "Chill" },
					},
				],
			});
			mockAddToPlaylist.mockResolvedValue({
				ok: false,
				errorCode: "AUTH_REQUIRED",
			});
			mockOutcomeFromCommandResponse.mockReturnValue({
				status: "reconnect-required",
			});

			await onAdd("pl-1");

			expect(mockReportSpotifyAuthFailure).toHaveBeenCalledWith(queryClient);
			expect(mockReportSpotifyAuthSuccess).not.toHaveBeenCalled();
			// Spotify write first, DB decision only on success (behavior preserved
			// from before this phase) — a reconnect bails before submitting.
			expect(mockSubmitMatchDeckAction).not.toHaveBeenCalled();
		});

		it("pushes reportSpotifyAuthSuccess when the Spotify write itself comes back ok, then still submits the deck decision", async () => {
			const { queryClient, onAdd } = await renderCard("item-1", {
				currentSuggestions: [
					{
						mode: "song",
						playlist: { id: "pl-1", spotifyId: "sp-pl-1", name: "Chill" },
					},
				],
			});
			mockAddToPlaylist.mockResolvedValue({ ok: true });
			mockOutcomeFromCommandResponse.mockReturnValue({ status: "success" });
			mockSubmitMatchDeckAction.mockResolvedValue({ actionStatus: "added" });

			await onAdd("pl-1");

			expect(mockReportSpotifyAuthSuccess).toHaveBeenCalledWith(queryClient);
			expect(mockReportSpotifyAuthFailure).not.toHaveBeenCalled();
			expect(mockSubmitMatchDeckAction).toHaveBeenCalledWith({
				data: {
					type: "add-suggestion",
					itemId: "item-1",
					suggestionId: "pl-1",
				},
			});
		});

		it("a non-auth Spotify error neither pushes nor submits the deck decision", async () => {
			const { onAdd } = await renderCard("item-1", {
				currentSuggestions: [
					{
						mode: "song",
						playlist: { id: "pl-1", spotifyId: "sp-pl-1", name: "Chill" },
					},
				],
			});
			mockAddToPlaylist.mockResolvedValue({
				ok: false,
				errorCode: "INVALID_TARGET",
			});
			mockOutcomeFromCommandResponse.mockReturnValue({
				status: "error",
				errorCode: "INVALID_TARGET",
			});

			await onAdd("pl-1");

			expect(mockReportSpotifyAuthFailure).not.toHaveBeenCalled();
			expect(mockReportSpotifyAuthSuccess).not.toHaveBeenCalled();
			expect(mockSubmitMatchDeckAction).not.toHaveBeenCalled();
		});
	});

	// Post-review fix (CRITICAL, invariant 2): phase 05 threaded a real
	// linkedSpotifyId into this hook, which made `mismatch` reachable here for
	// the first time — but nothing blocked the write under it. A mismatched
	// write would land on Spotify under whichever account the extension's live
	// token belongs to (not the deck's linked account) while this deck records
	// the decision as resolved — the same phantom/orphan-write class as phase
	// 04's studio CRITICAL finding, now closed here the same way: addSuggestion
	// refuses the write outright under `mismatch`, and Matching is handed
	// `mismatchProfile` so the suggestion sections render AccountMismatchPrompt
	// instead of an Add button in the first place.
	describe("post-review fix — account mismatch blocks the write (CRITICAL, invariant 2)", () => {
		const MISMATCH_PROFILE = {
			spotifyId: "wrong-id",
			displayName: "Someone Else",
		};

		it("never calls addToPlaylist or submits the deck decision, and neither push fires", async () => {
			const { onAdd } = await renderCard("item-1", {
				verdict: { kind: "mismatch", extensionProfile: MISMATCH_PROFILE },
				currentSuggestions: [
					{
						mode: "song",
						playlist: { id: "pl-1", spotifyId: "sp-pl-1", name: "Chill" },
					},
				],
			});

			await onAdd("pl-1");

			expect(mockAddToPlaylist).not.toHaveBeenCalled();
			expect(mockSubmitMatchDeckAction).not.toHaveBeenCalled();
			// A blocked write is not "the token failed" — it must not stamp a
			// fresh authFailedAt, and it must not clear a real sticky failure
			// either (no live command ran to evidence anything).
			expect(mockReportSpotifyAuthFailure).not.toHaveBeenCalled();
			expect(mockReportSpotifyAuthSuccess).not.toHaveBeenCalled();
		});

		it("blocks the write even when the Spotify command would have reported success (defense-in-depth: the gate, not the outcome, decides)", async () => {
			const { onAdd } = await renderCard("item-1", {
				verdict: { kind: "mismatch", extensionProfile: MISMATCH_PROFILE },
				currentSuggestions: [
					{
						mode: "song",
						playlist: { id: "pl-1", spotifyId: "sp-pl-1", name: "Chill" },
					},
				],
			});
			// Even if addToPlaylist were somehow called and returned ok, the
			// mismatch check runs first and short-circuits before any of this.
			mockAddToPlaylist.mockResolvedValue({ ok: true });
			mockOutcomeFromCommandResponse.mockReturnValue({ status: "success" });

			await onAdd("pl-1");

			expect(mockAddToPlaylist).not.toHaveBeenCalled();
			expect(mockSubmitMatchDeckAction).not.toHaveBeenCalled();
			expect(mockReportSpotifyAuthSuccess).not.toHaveBeenCalled();
		});

		it("exposes the extension's live profile to Matching so the suggestion sections can render AccountMismatchPrompt, and wires onRecheckConnection to the shared refetch", async () => {
			const { mismatchProfile, onRecheckConnection, refetch } =
				await renderCard("item-1", {
					verdict: { kind: "mismatch", extensionProfile: MISMATCH_PROFILE },
				});

			expect(mismatchProfile).toEqual(MISMATCH_PROFILE);

			await onRecheckConnection();
			expect(refetch).toHaveBeenCalledTimes(1);
		});

		it("mismatchProfile is null for every other verdict", async () => {
			const ok = await renderCard("item-1", { verdict: { kind: "ok" } });
			expect(ok.mismatchProfile).toBeNull();

			const disconnected = await renderCard("item-1", {
				verdict: { kind: "spotify-disconnected" },
			});
			expect(disconnected.mismatchProfile).toBeNull();
		});
	});
});
