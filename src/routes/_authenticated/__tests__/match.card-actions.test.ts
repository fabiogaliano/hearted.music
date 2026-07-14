import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DB-free coverage for QueueCardContent's whole-card action handlers (M7,
 * M9, N1 second half) — a component that is intentionally NOT exported from
 * match.tsx (see its own comments on why it stays unkeyed/inline). There is
 * no route-component render harness anywhere in this codebase (routes are
 * only ever tested via `beforeLoad`/`loader` as plain functions — see
 * match.test.ts); building one from scratch for a full `RouterProvider`
 * mount was ruled out as disproportionate for this backfill.
 *
 * Instead this file extends match.test.ts's existing trick (mock every React
 * hook down to an inert/synchronous shim, mock `createFileRoute` to identity
 * so `Route.component` is a plain callable function reference, then invoke
 * that function directly instead of mounting it) one level further: it walks
 * MatchPage → QueueMatchPage → QueueMatchContent by calling each returned
 * JSX element's `.type` as a plain function exactly once, to obtain a real
 * reference to the otherwise-unreachable QueueCardContent function. Every
 * step of that walk is disposable scaffolding; the reference is cached and
 * every actual test below re-invokes QueueCardContent directly with
 * hand-built props (its own onSessionStats/onCurrentItemId/onLockNavigation/
 * queryClient mocks), so assertions never depend on the walk's own props or
 * on useState call ordering inside QueueMatchContent — only on the real,
 * unmodified handleNext/applyResolvedView closures QueueCardContent builds.
 */

const {
	mockUseQuery,
	mockUseQueryClient,
	mockUseSuspenseQuery,
	mockUseActiveJobs,
	mockUseMatchReviewCard,
	mockUseSpotifyReconnectState,
	mockSubmitMatchDeckAction,
} = vi.hoisted(() => ({
	mockUseQuery: vi.fn(),
	mockUseQueryClient: vi.fn(),
	mockUseSuspenseQuery: vi.fn(),
	mockUseActiveJobs: vi.fn(),
	mockUseMatchReviewCard: vi.fn(),
	mockUseSpotifyReconnectState: vi.fn(),
	mockSubmitMatchDeckAction: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: mockUseQuery,
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

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (routeConfig: unknown) => routeConfig,
	redirect: vi.fn(),
	useNavigate: () => vi.fn(),
	Link: vi.fn(),
}));

vi.mock("react", () => ({
	Suspense: ({ children }: { children: unknown }) => children,
	useCallback: (fn: unknown) => fn,
	useEffect: vi.fn(),
	useMemo: (fn: () => unknown) => fn(),
	useRef: (init: unknown) => ({ current: init }),
	useState: (init: unknown) => [
		typeof init === "function" ? (init as () => unknown)() : init,
		vi.fn(),
	],
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("@/features/dashboard/queries", () => ({
	dashboardKeys: { all: ["dashboard"] },
}));

vi.mock("@/features/matching/components/MatchingEmptyState", () => ({
	MatchingEmptyState: vi.fn(),
}));

vi.mock("@/features/matching/components/MatchModeToggle", () => ({
	MatchModeToggle: vi.fn(),
}));

vi.mock("@/features/matching/deck-queries", () => ({
	matchDeckKeys: {
		all: ["match-deck"],
		deckRoot: ["match-deck", "deck"],
		deck: (accountId: string, orientation: string) => [
			"match-deck",
			"deck",
			accountId,
			orientation,
		],
		card: (itemId: string) => ["match-deck", "card", itemId],
	},
	matchDeckQueryOptions: (accountId: string, orientation: string) => ({
		queryKey: ["match-deck", "deck", accountId, orientation],
	}),
	readMatchDeckCardQueryOptions: (itemId: string) => ({
		queryKey: ["match-deck", "card", itemId, "read"],
	}),
}));

vi.mock("@/features/matching/Matching", () => ({ Matching: vi.fn() }));

vi.mock("@/features/matching/queries", () => ({
	matchReviewSummaryKeys: {
		summariesRoot: ["match-review", "summary"],
		summary: (accountId: string, orientation: string) => [
			"match-review",
			"summary",
			accountId,
			orientation,
		],
		preferredSummary: (accountId: string) => [
			"match-review",
			"summary",
			accountId,
			"preferred",
		],
	},
}));

vi.mock("@/features/matching/useMatchReviewCard", () => ({
	useMatchReviewCard: mockUseMatchReviewCard,
}));

vi.mock("@/features/matching/WalkthroughMatchContent", () => ({
	WalkthroughMatchContent: vi.fn(),
}));

vi.mock("@/lib/domains/library/accounts/onboarding-session", () => ({
	sessionMode: vi.fn(),
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

vi.mock("@/lib/hooks/useActiveJobs", () => ({
	useActiveJobs: mockUseActiveJobs,
}));

vi.mock("@/lib/observability/sentry", () => ({
	captureRouteError: vi.fn(),
}));

vi.mock("@/lib/observability/useAnalytics", () => ({
	useAnalytics: () => ({ capture: vi.fn() }),
}));

vi.mock("@/lib/server/match-deck.functions", () => ({
	submitMatchDeckAction: mockSubmitMatchDeckAction,
}));

vi.mock("@/lib/server/settings.functions", () => ({
	setMatchViewModePreference: vi.fn(),
}));

vi.mock("@/lib/theme/fonts", () => ({ fonts: { body: "", display: "" } }));

type FakeElement = {
	type: (props: unknown) => FakeElement;
	props: Record<string, unknown>;
};

function makeQueryClient() {
	return {
		cancelQueries: vi.fn().mockResolvedValue(undefined),
		setQueryData: vi.fn(),
		prefetchQuery: vi.fn().mockResolvedValue(undefined),
		invalidateQueries: vi.fn(),
	};
}

// Test-only shape of the mocked route config object: createFileRoute is
// mocked to identity, so `Route` here is the plain config object match.tsx
// passed in (component/useRouteContext/useSearch), with the latter two
// monkeypatched in getRouteConfig below (the real createFileRoute normally
// attaches them; our mock doesn't).
interface RouteConfig {
	component: () => FakeElement;
	useRouteContext: () => {
		session: { accountId: string };
		onboardingSession: { status: string };
	};
	useSearch: () => Record<string, unknown>;
}

// Cached across tests: the module only needs importing (and its Route object
// monkeypatching) once — it is disposable scaffolding, see the header comment.
let routeConfigPromise: Promise<RouteConfig> | null = null;

async function getRouteConfig(): Promise<RouteConfig> {
	if (!routeConfigPromise) {
		routeConfigPromise = import("../match").then((mod) => {
			// The real createFileRoute return type has no top-level `component`
			// (see RouteConfig's comment); createFileRoute is mocked to identity so
			// `Route` really is the plain config object at runtime.
			const routeConfig = mod.Route as unknown as RouteConfig;
			routeConfig.useRouteContext = () => ({
				session: { accountId: "acct-1" },
				onboardingSession: { status: "complete" },
			});
			routeConfig.useSearch = () => ({});
			return routeConfig;
		});
	}
	return routeConfigPromise;
}

/**
 * Invokes MatchPage → QueueMatchPage as plain function calls (mirroring
 * match.test.ts's loader-harness trick one level further — see the header
 * comment) and returns QueueMatchPage's resulting element. Callers configure
 * `mockUseSuspenseQuery`/`mockUseActiveJobs` beforehand.
 */
async function invokeQueueMatchPage(): Promise<FakeElement> {
	const routeConfig = await getRouteConfig();
	const matchPageElement = routeConfig.component() as FakeElement;
	const queueMatchPageElement = matchPageElement.props.children as FakeElement;
	return queueMatchPageElement.type(queueMatchPageElement.props);
}

// Cached across tests: the walk down to QueueCardContent only needs to run
// once (it is disposable scaffolding — see the header comment).
let queueCardContentFn:
	| ((props: Record<string, unknown>) => FakeElement)
	| null = null;

async function getQueueCardContent() {
	if (queueCardContentFn) return queueCardContentFn;

	mockUseQuery.mockReturnValue({ data: "disconnected" });
	mockUseQueryClient.mockReturnValue(makeQueryClient());
	mockUseActiveJobs.mockReturnValue({
		isEnrichmentRunning: false,
		isMatchSnapshotRefreshRunning: false,
		firstVisibleMatchReady: true,
		enrichmentProgress: null,
		matchSnapshotRefreshProgress: null,
	});
	mockUseSuspenseQuery.mockReturnValue({
		data: {
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
		},
	});

	const afterQueueMatchPage = await invokeQueueMatchPage();
	const queueMatchContentElement = afterQueueMatchPage.props
		.children as FakeElement;
	const queueCardContentElement = queueMatchContentElement.type(
		queueMatchContentElement.props,
	);

	queueCardContentFn = queueCardContentElement.type as (
		props: Record<string, unknown>,
	) => FakeElement;
	return queueCardContentFn;
}

/**
 * Captures the real `refetchInterval` callback QueueMatchPage passes to
 * `useSuspenseQuery` (M8) by invoking QueueMatchPage once and reading the
 * mocked hook's call arguments — no production export needed since the
 * callback is captured off the mock, not off QueueMatchPage's return value.
 */
async function captureRefetchInterval(
	firstVisibleMatchReady: boolean,
	connectionState: "connected" | "disconnected" = "disconnected",
): Promise<
	(query: {
		state: { data: unknown; dataUpdateCount: number };
	}) => number | false
> {
	mockUseActiveJobs.mockReturnValue({
		isEnrichmentRunning: false,
		isMatchSnapshotRefreshRunning: false,
		firstVisibleMatchReady,
		enrichmentProgress: null,
		matchSnapshotRefreshProgress: null,
	});
	mockUseQuery.mockReturnValue({ data: connectionState });
	// The initial data value only needs to satisfy useSuspenseQuery's mocked
	// return during this one QueueMatchPage invocation; refetchInterval reads
	// its OWN `query.state.data` argument on each call, not this value.
	mockUseSuspenseQuery.mockReturnValueOnce({
		data: {
			itemIds: ["item-1"],
			cards: { current: null, next: null },
			progress: {
				total: 1,
				remaining: 1,
				caughtUp: true,
				hiddenReviewItemCount: 0,
			},
		},
	});

	await invokeQueueMatchPage();

	const deckReadCall = mockUseSuspenseQuery.mock.calls.at(-1)?.[0] as {
		refetchInterval: (query: {
			state: { data: unknown; dataUpdateCount: number };
		}) => number | false;
	};
	return deckReadCall.refetchInterval;
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
	onSessionStats: ReturnType<typeof vi.fn>;
	onAddedTo: ReturnType<typeof vi.fn>;
	onCurrentItemId: ReturnType<typeof vi.fn>;
	onReleaseNavigation: ReturnType<typeof vi.fn>;
	onNext: () => Promise<void>;
}

async function renderCard(itemId = "item-1"): Promise<CardTestHarness> {
	const QueueCardContent = await getQueueCardContent();

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
	const onSessionStats = vi.fn();
	const onAddedTo = vi.fn();
	const onCurrentItemId = vi.fn();
	const onReleaseNavigation = vi.fn();

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
		onAddedTo,
		onSessionStats,
		onPastItems: vi.fn(),
		onCurrentItemId,
		onLockNavigation: () => true,
		onReleaseNavigation,
		onModeChange: vi.fn(),
		onExit: vi.fn(),
		analytics: { capture: vi.fn() },
		queryClient,
	});

	const onNext = element.props.onNext as () => Promise<void>;

	return {
		queryClient,
		onSessionStats,
		onAddedTo,
		onCurrentItemId,
		onReleaseNavigation,
		onNext,
	};
}

describe("QueueCardContent whole-card action handlers", () => {
	beforeEach(() => {
		mockUseQuery.mockReset();
		mockUseQueryClient.mockReset();
		mockUseActiveJobs.mockReset();
		mockUseSuspenseQuery.mockReset();
		mockUseMatchReviewCard.mockReset();
		mockUseSpotifyReconnectState.mockReset();
		mockSubmitMatchDeckAction.mockReset();
	});

	describe("M7 — rejected finish-card reconciliation", () => {
		it("already_resolved applies result.view and does not bump session stats", async () => {
			const {
				queryClient,
				onSessionStats,
				onCurrentItemId,
				onReleaseNavigation,
				onNext,
			} = await renderCard();

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
			expect(onCurrentItemId).toHaveBeenCalledWith("item-2");
			// Not a real finish — this client didn't resolve the item (another
			// tab/session already did), so it must not count as a skip/finish.
			expect(onSessionStats).not.toHaveBeenCalled();
			// Reconciling to the fresh view changes the itemId, which releases
			// navigation via the (mocked-away) itemId-change effect in production —
			// this handler itself must not also call it explicitly.
			expect(onReleaseNavigation).not.toHaveBeenCalled();
		});

		it("no_captured_pairs releases navigation without applying the view", async () => {
			const {
				queryClient,
				onSessionStats,
				onCurrentItemId,
				onReleaseNavigation,
				onNext,
			} = await renderCard();

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
			expect(onCurrentItemId).not.toHaveBeenCalled();
			expect(onSessionStats).not.toHaveBeenCalled();
			expect(onReleaseNavigation).toHaveBeenCalledTimes(1);
		});
	});

	describe("N1 (second half) — applyResolvedView routes a promoted retryable-error card through prefetchQuery", () => {
		it("prefetches a promoted retryable-error card instead of seeding it into the card cache", async () => {
			const { queryClient, onCurrentItemId, onNext } = await renderCard();

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
			expect(onCurrentItemId).toHaveBeenCalledWith("item-2");
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

	describe("M8 — building-recovery poll is bounded, not one-shot", () => {
		// Mirrors BUILDING_POLL_INTERVAL_MS / MAX_BUILDING_POLLS in match.tsx.
		// Not exported (no production edit permitted for this backfill — see
		// header comment) — captured here as the literal contract the poll must
		// keep; a deliberate constant change should update this alongside it.
		const BUILDING_POLL_INTERVAL_MS = 3_000;
		const MAX_BUILDING_POLLS = 5;

		function buildingQuery(dataUpdateCount: number) {
			return {
				state: { data: { status: "building" }, dataUpdateCount },
			};
		}

		function readyQuery(dataUpdateCount: number) {
			return {
				state: {
					data: { itemIds: [], cards: { current: null, next: null } },
					dataUpdateCount,
				},
			};
		}

		it("keeps polling on a fixed interval while still building and a first visible match is ready", async () => {
			const refetchInterval = await captureRefetchInterval(true);

			expect(refetchInterval(buildingQuery(0))).toBe(BUILDING_POLL_INTERVAL_MS);
			// Same closure/ref across ticks (the poll baseline is captured lazily on
			// the first still-building tick, see M8's decisions-log note) — three
			// more still-building ticks stay under the bound.
			expect(refetchInterval(buildingQuery(1))).toBe(BUILDING_POLL_INTERVAL_MS);
			expect(refetchInterval(buildingQuery(4))).toBe(BUILDING_POLL_INTERVAL_MS);
		});

		it("stops polling once MAX_BUILDING_POLLS is reached (bounded, not indefinite — the old one-shot effect's failure mode)", async () => {
			const refetchInterval = await captureRefetchInterval(true);

			refetchInterval(buildingQuery(0)); // establishes the baseline at 0
			expect(refetchInterval(buildingQuery(MAX_BUILDING_POLLS))).toBe(false);
		});

		it("does not poll when firstVisibleMatchReady is false, even while still building", async () => {
			const refetchInterval = await captureRefetchInterval(false);

			expect(refetchInterval(buildingQuery(0))).toBe(false);
		});

		it("quiets the building fallback once the stream is connected", async () => {
			const refetchInterval = await captureRefetchInterval(true, "connected");

			expect(refetchInterval(buildingQuery(0))).toBe(false);
		});

		it("stops polling once the deck is no longer building", async () => {
			const refetchInterval = await captureRefetchInterval(true);

			refetchInterval(buildingQuery(0)); // in-flight poll
			expect(refetchInterval(readyQuery(1))).toBe(false);
		});

		it("gives a later building spell its own fresh bounded window instead of an exhausted counter", async () => {
			const refetchInterval = await captureRefetchInterval(true);

			refetchInterval(buildingQuery(0)); // baseline = 0
			refetchInterval(buildingQuery(MAX_BUILDING_POLLS)); // exhausted → false; baseline untouched by this branch
			// The gate going false (deck resolves) is what clears the baseline —
			// exhausting the bound alone does not.
			refetchInterval(readyQuery(MAX_BUILDING_POLLS + 1));
			// A later, distinct building spell (a fresh mid-session publish) must
			// get its own bounded window from ITS OWN starting tick, not inherit
			// the old exhausted baseline.
			expect(refetchInterval(buildingQuery(MAX_BUILDING_POLLS + 5))).toBe(
				BUILDING_POLL_INTERVAL_MS,
			);
		});
	});
});
