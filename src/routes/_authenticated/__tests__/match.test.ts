import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((options: { to: string; replace?: boolean }) => ({
	kind: "redirect" as const,
	...options,
}));
const sessionModeMock = vi.fn();
// The deck query-option factories are mocked so the loader's key/seed contract
// can be asserted without loading the real deck server-fn module graph.
const matchDeckQueryOptionsMock = vi.fn(
	(accountId: string, orientation: string) => ({
		queryKey: ["match-deck", "deck", accountId, orientation],
	}),
);
const readMatchDeckCardQueryOptionsMock = vi.fn((itemId: string) => ({
	queryKey: ["match-deck", "card", itemId, "read"],
}));

type OnboardingSession = { status: string };

type LoaderContext = {
	session: { accountId: string };
	queryClient: {
		ensureQueryData: (options: unknown) => Promise<unknown>;
		setQueryData: (key: unknown, value: unknown) => void;
	};
	onboardingSession: OnboardingSession;
};

type MatchRoute = {
	beforeLoad: (args: { location: { searchStr: string } }) => void;
	// The loader now AWAITS the bounded deck read (RB) and seeds the deck +
	// baked-card caches; walkthrough sessions short-circuit before the read.
	loader: (args: {
		context: LoaderContext;
		deps: { mode: string };
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
		Link: vi.fn(),
	}));
	vi.doMock("@tanstack/react-query", () => ({
		useQueryClient: vi.fn(),
		useSuspenseQuery: vi.fn(),
		queryOptions: vi.fn((opts: unknown) => opts),
	}));
	// match.tsx + mutations.ts import submitMatchDeckAction as a value; mock the
	// module so the heavy server-fn graph never loads for a loader/beforeLoad test.
	vi.doMock("@/lib/server/match-deck.functions", () => ({
		submitMatchDeckAction: vi.fn(),
	}));
	vi.doMock("@/features/matching/deck-queries", () => ({
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
		matchDeckQueryOptions: matchDeckQueryOptionsMock,
		readMatchDeckCardQueryOptions: readMatchDeckCardQueryOptionsMock,
		matchDeckCardSuggestionsInfiniteQueryOptions: vi.fn(),
	}));
	vi.doMock("@/features/matching/queries", () => ({
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
		runMatchSnapshotRefreshEffects: vi.fn(),
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

	describe("loader — deck read (RB)", () => {
		const makeContext = (
			onboardingSession: OnboardingSession,
			ensureData: unknown,
		): LoaderContext => ({
			session: { accountId: "acct-1" },
			queryClient: {
				ensureQueryData: vi.fn().mockResolvedValue(ensureData),
				setQueryData: vi.fn(),
			},
			onboardingSession,
		});

		it("short-circuits before any deck read for walkthrough sessions", async () => {
			const route = await loadRoute();
			sessionModeMock.mockReturnValue("walkthrough");
			const context = makeContext({ status: "song-walkthrough" }, undefined);

			await expect(
				route.loader({ context, deps: { mode: "playlist" } }),
			).resolves.toBeUndefined();
			expect(context.queryClient.ensureQueryData).not.toHaveBeenCalled();
			expect(context.queryClient.setQueryData).not.toHaveBeenCalled();
		});

		it("awaits the deck read and seeds the current + next card caches", async () => {
			const route = await loadRoute();
			sessionModeMock.mockReturnValue("complete");
			const view = {
				itemIds: ["item-1", "item-2"],
				cards: {
					current: {
						itemId: "item-1",
						position: 0,
						presentation: { status: "ready", itemId: "item-1" },
					},
					next: {
						itemId: "item-2",
						position: 1,
						presentation: { status: "ready", itemId: "item-2" },
					},
				},
				progress: {
					total: 2,
					remaining: 2,
					caughtUp: false,
					hiddenReviewItemCount: 0,
				},
			};
			const context = makeContext({ status: "complete" }, view);

			await route.loader({ context, deps: { mode: "playlist" } });

			// The deck read is keyed per (account, orientation) from loaderDeps.mode.
			expect(matchDeckQueryOptionsMock).toHaveBeenCalledWith(
				"acct-1",
				"playlist",
			);
			expect(context.queryClient.ensureQueryData).toHaveBeenCalledWith({
				queryKey: ["match-deck", "deck", "acct-1", "playlist"],
			});
			// Both baked cards are seeded under their read keys.
			expect(context.queryClient.setQueryData).toHaveBeenCalledWith(
				["match-deck", "card", "item-1", "read"],
				view.cards.current.presentation,
			);
			expect(context.queryClient.setQueryData).toHaveBeenCalledWith(
				["match-deck", "card", "item-2", "read"],
				view.cards.next.presentation,
			);
		});

		it("awaits the deck read but seeds no card caches for the building state", async () => {
			const route = await loadRoute();
			sessionModeMock.mockReturnValue("complete");
			const context = makeContext(
				{ status: "complete" },
				{ status: "building" },
			);

			await route.loader({ context, deps: { mode: "song" } });

			expect(context.queryClient.ensureQueryData).toHaveBeenCalled();
			// Building state carries no itemIds/cards, so nothing is seeded.
			expect(context.queryClient.setQueryData).not.toHaveBeenCalled();
		});

		it("skips the next-card seed when the deck has only a current card", async () => {
			const route = await loadRoute();
			sessionModeMock.mockReturnValue("complete");
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
			const context = makeContext({ status: "complete" }, view);

			await route.loader({ context, deps: { mode: "playlist" } });

			expect(context.queryClient.setQueryData).toHaveBeenCalledTimes(1);
			expect(context.queryClient.setQueryData).toHaveBeenCalledWith(
				["match-deck", "card", "item-1", "read"],
				view.cards.current.presentation,
			);
		});
	});
});
