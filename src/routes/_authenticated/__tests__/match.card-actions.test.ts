import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DB-free coverage for QueueMatchPage's building-recovery poll (M8) — the
 * one piece of card-action-adjacent behavior that stayed in match.tsx after
 * the Deepening #2 extraction (QueueMatchContent/QueueCardContent moved to
 * src/features/matching/; see QueueCardContent.test.tsx for the mutation
 * handler coverage that moved with them).
 *
 * Mirrors match.test.ts's trick: mock every React hook down to an inert/
 * synchronous shim, mock `createFileRoute` to identity so `Route.component`
 * is a plain callable function reference, then invoke MatchPage →
 * QueueMatchPage directly instead of mounting it, and capture the real
 * `refetchInterval` callback off the mocked `useSuspenseQuery` call.
 */

const {
	mockUseQuery,
	mockUseQueryClient,
	mockUseSuspenseQuery,
	mockUseActiveJobs,
} = vi.hoisted(() => ({
	mockUseQuery: vi.fn(),
	mockUseQueryClient: vi.fn(),
	mockUseSuspenseQuery: vi.fn(),
	mockUseActiveJobs: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: mockUseQuery,
	useQueryClient: mockUseQueryClient,
	useSuspenseQuery: mockUseSuspenseQuery,
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (routeConfig: unknown) => routeConfig,
	redirect: vi.fn(),
	useNavigate: () => vi.fn(),
}));

vi.mock("react", () => ({
	Suspense: ({ children }: { children: unknown }) => children,
	useCallback: (fn: unknown) => fn,
	useEffect: vi.fn(),
	useRef: (init: unknown) => ({ current: init }),
}));

vi.mock("@/features/dashboard/queries", () => ({
	dashboardKeys: { all: ["dashboard"] },
}));

vi.mock("@/features/matching/components/MatchingEmptyState", () => ({
	MatchingEmptyState: vi.fn(),
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

vi.mock("@/features/matching/QueueMatchSession", () => ({
	QueueMatchContent: vi.fn(),
}));

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

vi.mock("@/features/matching/seed-deck-cards", () => ({
	seedBakedDeckCardReads: vi.fn(),
}));

vi.mock("@/features/matching/WalkthroughMatchContent", () => ({
	WalkthroughMatchContent: vi.fn(),
}));

vi.mock("@/lib/domains/library/accounts/onboarding-session", () => ({
	sessionMode: vi.fn(),
}));

vi.mock("@/lib/hooks/useActiveJobs", () => ({
	useActiveJobs: mockUseActiveJobs,
}));

vi.mock("@/lib/observability/sentry", () => ({
	captureRouteError: vi.fn(),
}));

vi.mock("@/lib/server/settings.functions", () => ({
	setMatchViewModePreference: vi.fn(),
}));

vi.mock("@/lib/theme/fonts", () => ({ fonts: { body: "", display: "" } }));

type FakeElement = {
	type: (props: unknown) => FakeElement;
	props: Record<string, unknown>;
};

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
 * Invokes MatchPage → QueueMatchPage as plain function calls and returns
 * QueueMatchPage's resulting element. Callers configure
 * `mockUseSuspenseQuery`/`mockUseActiveJobs` beforehand.
 */
async function invokeQueueMatchPage(): Promise<FakeElement> {
	const routeConfig = await getRouteConfig();
	const matchPageElement = routeConfig.component() as FakeElement;
	const queueMatchPageElement = matchPageElement.props.children as FakeElement;
	return queueMatchPageElement.type(queueMatchPageElement.props);
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
	mockUseQueryClient.mockReturnValue({});
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

describe("QueueMatchPage building-recovery poll", () => {
	beforeEach(() => {
		mockUseQuery.mockReset();
		mockUseQueryClient.mockReset();
		mockUseActiveJobs.mockReset();
		mockUseSuspenseQuery.mockReset();
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
