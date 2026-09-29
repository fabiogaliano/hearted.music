import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { vi } from "vitest";
import type { OnboardingSession } from "@/lib/domains/library/accounts/onboarding-session";
import { act, renderWithRouter } from "@/test/utils/render";
import { Route as MatchRoute } from "../match";

/**
 * Mounts the real /match route (beforeLoad, loader, component) under a memory
 * router with the caller's real QueryClient. Callers own the vi.mock calls for
 * server fns, since those must be hoisted in the test file itself.
 */

export const ACCOUNT_ID = "acct-1";

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
	const { router, history } = await renderWithRouter(
		<QueryClientProvider client={queryClient}>
			<Outlet />
		</QueryClientProvider>,
		{
			url,
			// The generated route tree nests /match under /_authenticated; the test
			// root carries the same context shape, which is all the component and
			// loader read.
			routes: (root) => [
				MatchRoute.update({
					id: "/match",
					path: "/match",
					getParentRoute: () => root,
				} as never),
			],
			context: {
				queryClient,
				session: { accountId: ACCOUNT_ID },
				account: {},
				onboardingSession,
			},
		},
	);
	await advance(0);
	await advance(0);

	return { router, history };
}
