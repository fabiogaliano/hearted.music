import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((options: { to: string; replace?: boolean }) => ({
	kind: "redirect" as const,
	...options,
}));
const startOrResumeMatchReviewMock = vi.fn();
const matchReviewQueryOptionsMock = vi.fn();
const matchReviewItemQueryOptionsMock = vi.fn();
const presentMatchReviewItemQueryOptionsMock = vi.fn();
const sessionModeMock = vi.fn();

type OnboardingSession = { status: string };

type LoaderContext = {
	session: { accountId: string };
	queryClient: { prefetchQuery: (options: unknown) => Promise<void> };
	onboardingSession: OnboardingSession;
};

type MatchRoute = {
	beforeLoad: (args: { location: { searchStr: string } }) => void;
	loaderDeps: (args: { search: Record<string, unknown> }) => {
		mode: "song" | "playlist";
	};
	loader: (args: {
		context: LoaderContext;
		deps: { mode: "song" | "playlist" };
	}) => Promise<void>;
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
	}));
	vi.doMock("@tanstack/react-query", () => ({
		useQueryClient: vi.fn(),
		useSuspenseQuery: vi.fn(),
		queryOptions: vi.fn((opts: unknown) => opts),
	}));
	vi.doMock("@/lib/server/match-review-queue.functions", () => ({
		startOrResumeMatchReview: startOrResumeMatchReviewMock,
		markMatchReviewItemPresented: vi.fn(),
		addSongToPlaylistFromQueueItem: vi.fn(),
		dismissMatchReviewItem: vi.fn(),
		finishMatchReviewItem: vi.fn(),
	}));
	vi.doMock("@/features/matching/queries", () => ({
		matchReviewQueryOptions: matchReviewQueryOptionsMock,
		matchReviewItemQueryOptions: matchReviewItemQueryOptionsMock,
		presentMatchReviewItemQueryOptions: presentMatchReviewItemQueryOptionsMock,
		matchReviewKeys: {
			all: ["match-review"],
			reviewsRoot: ["match-review", "review"],
			review: (accountId: string, orientation: string) => [
				"match-review",
				"review",
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
	vi.doMock("@/lib/theme/fonts", () => ({ fonts: { body: "", display: "" } }));
	vi.doMock("sonner", () => ({ toast: vi.fn() }));
	vi.doMock("react", () => ({
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
		it("does not redirect when no mode param is present (canonical song mode)", async () => {
			const route = await loadRoute();
			// Should return undefined (no redirect)
			const result = route.beforeLoad({ location: { searchStr: "" } });
			expect(result).toBeUndefined();
			expect(redirectMock).not.toHaveBeenCalled();
		});

		it("does not redirect for mode=playlist (canonical playlist mode)", async () => {
			const route = await loadRoute();
			const result = route.beforeLoad({
				location: { searchStr: "?mode=playlist" },
			});
			expect(result).toBeUndefined();
			expect(redirectMock).not.toHaveBeenCalled();
		});

		it("redirects mode=song to /match with replace:true", async () => {
			const route = await loadRoute();
			let caught: unknown;
			try {
				route.beforeLoad({ location: { searchStr: "?mode=song" } });
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

	describe("loaderDeps — mode derivation", () => {
		it("returns mode=song when no mode param is present", async () => {
			const route = await loadRoute();
			expect(route.loaderDeps({ search: {} })).toEqual({ mode: "song" });
		});

		it("returns mode=playlist when search contains mode=playlist", async () => {
			const route = await loadRoute();
			expect(route.loaderDeps({ search: { mode: "playlist" } })).toEqual({
				mode: "playlist",
			});
		});
	});

	describe("loader — orientation-scoped bootstrap", () => {
		const makeContext = (
			onboardingSession: OnboardingSession,
		): LoaderContext => ({
			session: { accountId: "acct-1" },
			queryClient: { prefetchQuery: vi.fn().mockResolvedValue(undefined) },
			onboardingSession,
		});

		it("skips bootstrap for walkthrough sessions", async () => {
			const route = await loadRoute();
			sessionModeMock.mockReturnValue("walkthrough");
			const context = makeContext({ status: "song-walkthrough" });

			await route.loader({ context, deps: { mode: "song" } });

			expect(startOrResumeMatchReviewMock).not.toHaveBeenCalled();
			expect(context.queryClient.prefetchQuery).not.toHaveBeenCalled();
		});

		it("bootstraps song orientation with orientation:song when mode=song", async () => {
			const route = await loadRoute();
			sessionModeMock.mockReturnValue("normal");
			startOrResumeMatchReviewMock.mockResolvedValue({
				sessionId: "sess-1",
				itemIds: [],
				total: 0,
				caughtUp: true,
			});
			matchReviewQueryOptionsMock.mockReturnValue({
				queryKey: ["match-review", "review", "acct-1", "song"],
			});
			const context = makeContext({ status: "complete" });

			await route.loader({ context, deps: { mode: "song" } });

			expect(startOrResumeMatchReviewMock).toHaveBeenCalledWith({
				data: { orientation: "song" },
			});
			expect(matchReviewQueryOptionsMock).toHaveBeenCalledWith(
				"acct-1",
				"song",
			);
		});

		it("bootstraps playlist orientation with orientation:playlist when mode=playlist", async () => {
			const route = await loadRoute();
			sessionModeMock.mockReturnValue("normal");
			startOrResumeMatchReviewMock.mockResolvedValue({
				sessionId: "sess-1",
				itemIds: [],
				total: 0,
				caughtUp: true,
			});
			matchReviewQueryOptionsMock.mockReturnValue({
				queryKey: ["match-review", "review", "acct-1", "playlist"],
			});
			const context = makeContext({ status: "complete" });

			await route.loader({ context, deps: { mode: "playlist" } });

			expect(startOrResumeMatchReviewMock).toHaveBeenCalledWith({
				data: { orientation: "playlist" },
			});
			expect(matchReviewQueryOptionsMock).toHaveBeenCalledWith(
				"acct-1",
				"playlist",
			);
		});

		it("prefetches the first card when the queue has items", async () => {
			const route = await loadRoute();
			sessionModeMock.mockReturnValue("normal");
			startOrResumeMatchReviewMock.mockResolvedValue({
				sessionId: "sess-1",
				itemIds: ["item-1", "item-2"],
				total: 2,
				caughtUp: false,
			});
			matchReviewQueryOptionsMock.mockReturnValue({ queryKey: ["queue"] });
			matchReviewItemQueryOptionsMock.mockReturnValue({ queryKey: ["item-1"] });
			presentMatchReviewItemQueryOptionsMock.mockReturnValue({
				queryKey: ["item-1", "present"],
			});
			const context = makeContext({ status: "complete" });

			await route.loader({ context, deps: { mode: "song" } });

			// All three prefetches should fire — queue, non-authoritative warm, authoritative present.
			expect(context.queryClient.prefetchQuery).toHaveBeenCalledTimes(3);
			expect(matchReviewItemQueryOptionsMock).toHaveBeenCalledWith("item-1");
			expect(presentMatchReviewItemQueryOptionsMock).toHaveBeenCalledWith(
				"item-1",
			);
		});

		it("only prefetches the queue summary when caughtUp (no first card)", async () => {
			const route = await loadRoute();
			sessionModeMock.mockReturnValue("normal");
			startOrResumeMatchReviewMock.mockResolvedValue({
				sessionId: "sess-1",
				itemIds: [],
				total: 0,
				caughtUp: true,
			});
			matchReviewQueryOptionsMock.mockReturnValue({ queryKey: ["queue"] });
			const context = makeContext({ status: "complete" });

			await route.loader({ context, deps: { mode: "song" } });

			expect(context.queryClient.prefetchQuery).toHaveBeenCalledTimes(1);
			expect(matchReviewItemQueryOptionsMock).not.toHaveBeenCalled();
			expect(presentMatchReviewItemQueryOptionsMock).not.toHaveBeenCalled();
		});
	});
});
