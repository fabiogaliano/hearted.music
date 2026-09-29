import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRouteWithContext,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { vi } from "vitest";
import type { OnboardingSession } from "@/lib/domains/library/accounts/onboarding-session";
import { act, render } from "@/test/utils/render";
import { Route as MatchRoute } from "../match";

/**
 * Mounts the real /match route (beforeLoad, loader, component) under a memory
 * router with the caller's real QueryClient. Callers own the vi.mock calls for
 * server fns, since those must be hoisted in the test file itself.
 */

export const ACCOUNT_ID = "acct-1";

// The generated route tree nests /match under /_authenticated; a bare root
// with the same context shape is all the component and loader read.
const rootRoute = createRootRouteWithContext<Record<string, unknown>>()();
const matchRoute = MatchRoute.update({
	id: "/match",
	path: "/match",
	getParentRoute: () => rootRoute,
} as never);

// Fake timers are expected: advancing time is what lets the router, the
// loader's awaited query, and Suspense settle inside act.
export async function advance(ms: number) {
	await act(() => vi.advanceTimersByTimeAsync(ms));
}

export async function renderMatchRoute({
	queryClient,
	url = "/match",
	onboardingSession = { status: "complete" },
}: {
	queryClient: QueryClient;
	url?: string;
	onboardingSession?: OnboardingSession;
}) {
	// The router restores scroll on navigation; jsdom has no scrollTo.
	vi.spyOn(window, "scrollTo").mockImplementation(() => {});
	const history = createMemoryHistory({ initialEntries: [url] });
	const router = createRouter({
		routeTree: rootRoute.addChildren([matchRoute]),
		history,
		context: {
			queryClient,
			session: { accountId: ACCOUNT_ID },
			account: {},
			onboardingSession,
		},
	});

	render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
	await advance(0);
	await advance(0);

	return { router, history };
}
