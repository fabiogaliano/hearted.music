import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((options: { to: string; replace?: boolean }) => ({
	kind: "redirect" as const,
	...options,
}));
const startOrResumeMatchReviewMock = vi.fn();
const matchReviewBootstrapQueryOptionsMock = vi.fn();
const matchReviewQueryOptionsMock = vi.fn();
const sessionModeMock = vi.fn();

type OnboardingSession = { status: string };

type LoaderContext = {
	session: { accountId: string };
	queryClient: { prefetchQuery: (options: unknown) => Promise<void> };
	onboardingSession: OnboardingSession;
};

type MatchRoute = {
	beforeLoad: (args: { location: { searchStr: string } }) => void;
	// Bootstrap + queue reads moved to the client (B1); the loader now only
	// short-circuits walkthrough modes and returns void.
	loader: (args: { context: LoaderContext }) => void;
};

function isMatchRoute(value: unknown): value is MatchRoute {
	if (typeof value !== "object" || value === null) return false;
	return (
		typeof Reflect.get(value, "beforeLoad") === "function" &&
		typeof Reflect.get(value, "loader") === "function"
	);
}

async function loadRoute(): Promise<MatchRoute> {
	vi.resetModules();
	vi.doMock("@tanstack/react-router", () => ({
		createFileRoute: () => (routeConfig: unknown) => routeConfig,
		redirect: redirectMock,
		useNavigate: vi.fn(),
		Link: vi.fn(),
	}));
	vi.doMock("@tanstack/react-query", () => ({
		useQueryClient: vi.fn(),
		useSuspenseQuery: vi.fn(),
		queryOptions: vi.fn((opts: unknown) => opts),
	}));
	vi.doMock("@/lib/server/match-review-queue.functions", () => ({
		markMatchReviewItemPresented: vi.fn(),
		addSongToPlaylistFromQueueItem: vi.fn(),
		dismissMatchReviewItem: vi.fn(),
		dismissMatchReviewItemSuggestion: vi.fn(),
		finishMatchReviewItem: vi.fn(),
	}));
	vi.doMock("@/features/matching/queries", () => ({
		matchReviewBootstrapQueryOptions: matchReviewBootstrapQueryOptionsMock,
		matchReviewQueryOptions: matchReviewQueryOptionsMock,
		presentMatchReviewItemQueryOptions: vi.fn(),
		matchReviewKeys: {
			all: ["match-review"],
			reviewsRoot: ["match-review", "review"],
			review: (accountId: string, orientation: string) => [
				"match-review",
				"review",
				accountId,
				orientation,
			],
			bootstrap: (accountId: string, orientation: string) => [
				"match-review",
				"bootstrap",
				accountId,
				orientation,
			],
			item: (itemId: string) => ["match-review", "item", itemId],
		},
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
	vi.doMock("@/lib/domains/library/accounts/onboarding-session", () => ({
		sessionMode: sessionModeMock,
	}));
	vi.doMock("@/features/matching/Matching", () => ({ Matching: vi.fn() }));
	vi.doMock("@/features/matching/components/MatchModeToggle", () => ({
		MatchModeToggle: vi.fn(),
	}));
	vi.doMock("@/features/matching/WalkthroughMatchContent", () => ({
		WalkthroughMatchContent: vi.fn(),
	}));
	vi.doMock("@/features/matching/components/MatchingEmptyState", () => ({
		MatchingEmptyState: vi.fn(),
	}));
	vi.doMock("@/features/dashboard/queries", () => ({
		dashboardKeys: { all: ["dashboard"] },
	}));
	vi.doMock("@/lib/extension/spotify-client", () => ({
		addToPlaylist: vi.fn(),
	}));
	vi.doMock("@/lib/extension/spotify-action-outcome", () => ({
		outcomeFromCommandResponse: vi.fn(),
	}));
	vi.doMock("@/lib/extension/useSpotifyReconnectState", () => ({
		useSpotifyReconnectState: vi.fn(),
	}));
	vi.doMock("@/lib/observability/useAnalytics", () => ({
		useAnalytics: vi.fn(),
	}));
	vi.doMock("@/lib/observability/sentry", () => ({
		captureRouteError: vi.fn(),
	}));
	vi.doMock("@/lib/theme/fonts", () => ({ fonts: { body: "", display: "" } }));
	vi.doMock("sonner", () => ({ toast: vi.fn() }));
	vi.doMock("react", () => ({
		Suspense: ({ children }: { children: unknown }) => children,
		useCallback: vi.fn((fn: unknown) => fn),
		useEffect: vi.fn(),
		useMemo: vi.fn((fn: () => unknown) => fn()),
		useRef: vi.fn(() => ({ current: null })),
		useState: vi.fn((init: unknown) => [
			typeof init === "function" ? (init as () => unknown)() : init,
			vi.fn(),
		]),
	}));

	const module = await import("../match");
	if (!isMatchRoute(module.Route)) {
		throw new Error("Expected Route to expose beforeLoad and loader");
	}
	return module.Route;
}

describe("/_authenticated/match route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("beforeLoad — mode normalisation", () => {
		it("does not redirect when no mode param is present (canonical playlist mode)", async () => {
			const route = await loadRoute();
			// Should return undefined (no redirect)
			const result = route.beforeLoad({ location: { searchStr: "" } });
			expect(result).toBeUndefined();
			expect(redirectMock).not.toHaveBeenCalled();
		});

		it("does not redirect for mode=song (canonical song mode)", async () => {
			const route = await loadRoute();
			const result = route.beforeLoad({
				location: { searchStr: "?mode=song" },
			});
			expect(result).toBeUndefined();
			expect(redirectMock).not.toHaveBeenCalled();
		});

		it("redirects mode=playlist to /match with replace:true", async () => {
			const route = await loadRoute();
			let caught: unknown;
			try {
				route.beforeLoad({ location: { searchStr: "?mode=playlist" } });
			} catch (e) {
				caught = e;
			}
			expect(caught).toEqual({ kind: "redirect", to: "/match", replace: true });
			expect(redirectMock).toHaveBeenCalledWith({
				to: "/match",
				replace: true,
			});
		});

		it("redirects an invalid mode value to /match with replace:true", async () => {
			const route = await loadRoute();
			let caught: unknown;
			try {
				route.beforeLoad({ location: { searchStr: "?mode=unknown" } });
			} catch (e) {
				caught = e;
			}
			expect(caught).toEqual({ kind: "redirect", to: "/match", replace: true });
		});

		it("redirects a numeric mode value to /match with replace:true", async () => {
			const route = await loadRoute();
			let caught: unknown;
			try {
				route.beforeLoad({ location: { searchStr: "?mode=42" } });
			} catch (e) {
				caught = e;
			}
			expect(caught).toEqual({ kind: "redirect", to: "/match", replace: true });
		});
	});

	describe("loader — client-suspense contract (B1)", () => {
		const makeContext = (
			onboardingSession: OnboardingSession,
		): LoaderContext => ({
			session: { accountId: "acct-1" },
			queryClient: { prefetchQuery: vi.fn().mockResolvedValue(undefined) },
			onboardingSession,
		});

		it("returns without any query work for walkthrough sessions", async () => {
			const route = await loadRoute();
			sessionModeMock.mockReturnValue("walkthrough");
			const context = makeContext({ status: "song-walkthrough" });

			expect(route.loader({ context })).toBeUndefined();
			expect(context.queryClient.prefetchQuery).not.toHaveBeenCalled();
		});

		it("does no bootstrap or prefetch for normal sessions — moved to the client Suspense boundary", async () => {
			const route = await loadRoute();
			sessionModeMock.mockReturnValue("complete");
			const context = makeContext({ status: "complete" });

			// The loader must not block SSR: create/resume + the queue read now run
			// in QueueMatchPage via useSuspenseQuery under a Suspense fallback, so no
			// prefetch or bootstrap call happens here.
			expect(route.loader({ context })).toBeUndefined();
			expect(context.queryClient.prefetchQuery).not.toHaveBeenCalled();
			expect(startOrResumeMatchReviewMock).not.toHaveBeenCalled();
		});
	});
});
