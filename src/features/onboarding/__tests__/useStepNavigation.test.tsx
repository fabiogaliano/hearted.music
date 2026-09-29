import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingSession } from "@/lib/domains/library/accounts/onboarding-session";
import type { SaveableOnboardingStep } from "@/lib/domains/library/accounts/onboarding-steps";
import { ONBOARDING_SESSION_QUERY_KEY } from "@/lib/platform/auth/query-keys";
import {
	getOnboardingSession,
	saveOnboardingStep,
} from "@/lib/server/onboarding.functions";
import { act, renderWithRouter } from "@/test/utils/render";
import { useStepNavigation } from "../hooks/useStepNavigation";

/**
 * useStepNavigation's contract: persist the step, then read the authoritative
 * session back, then navigate — so route guards on the destination read the
 * fresh session from the cache, never the pre-save one. The server fns are
 * mocked as a tiny in-memory server; the QueryClient and router are real.
 */

vi.mock("@/lib/server/onboarding.functions", () => ({
	saveOnboardingStep: vi.fn(),
	getOnboardingSession: vi.fn(),
}));

const SAMPLE_SONG = {
	id: "song-uuid",
	spotifyTrackId: "spotify:track:abc",
	slug: "artist-name",
	name: "Name",
	artist: "Artist",
	artistId: null,
	artistImageUrl: null,
	album: null,
	albumArtUrl: null,
	genres: [],
	analysis: null,
};

function sessionFor(step: SaveableOnboardingStep): OnboardingSession {
	if (step === "song-walkthrough" || step === "match-walkthrough") {
		return { status: step, song: SAMPLE_SONG } as OnboardingSession;
	}
	return { status: step } as OnboardingSession;
}

// The server only reports a step once it has been saved, so a read that races
// ahead of the save returns the stale session.
let serverSession: OnboardingSession;

async function renderNavigation() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	queryClient.setQueryData(ONBOARDING_SESSION_QUERY_KEY, {
		session: serverSession,
		theme: null,
	});
	const hook: { current: ReturnType<typeof useStepNavigation> | null } = {
		current: null,
	};
	function Harness() {
		hook.current = useStepNavigation();
		return null;
	}
	const { router } = await renderWithRouter(
		<QueryClientProvider client={queryClient}>
			<Harness />
		</QueryClientProvider>,
		{ url: "/onboarding?step=syncing" },
	);
	const navigateTo = (step: SaveableOnboardingStep) =>
		act(() =>
			(hook.current as ReturnType<typeof useStepNavigation>).navigateTo(step),
		);
	return { router, queryClient, navigateTo };
}

function cachedStatus(queryClient: QueryClient) {
	return queryClient.getQueryData<{ session: OnboardingSession }>(
		ONBOARDING_SESSION_QUERY_KEY,
	)?.session.status;
}

describe("useStepNavigation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		serverSession = { status: "syncing" } as OnboardingSession;
		vi.mocked(saveOnboardingStep).mockImplementation((async ({
			data,
		}: {
			data: { step: SaveableOnboardingStep };
		}) => {
			serverSession = sessionFor(data.step);
			return { success: true };
		}) as never);
		vi.mocked(getOnboardingSession).mockImplementation((async () => ({
			session: serverSession,
			theme: null,
		})) as never);
	});

	it.each([
		["song-walkthrough", "/liked-songs"],
		["match-walkthrough", "/match"],
		["flag-playlists", "/playlists"],
		["plan-selection", "/onboarding?step=plan-selection"],
	] as const)("saving %s lands on %s", async (step, href) => {
		const { router, navigateTo } = await renderNavigation();

		await navigateTo(step);

		expect(router.state.location.href).toBe(href);
	});

	it("has the saved step's session in the cache before the navigation lands", async () => {
		const { router, queryClient, navigateTo } = await renderNavigation();
		const statusWhenNavigating: unknown[] = [];
		router.subscribe("onBeforeNavigate", () => {
			statusWhenNavigating.push(cachedStatus(queryClient));
		});

		await navigateTo("song-walkthrough");

		expect(statusWhenNavigating).toEqual(["song-walkthrough"]);
		expect(router.state.location.pathname).toBe("/liked-songs");
	});

	it("stays put and never reads the session when the save fails", async () => {
		vi.mocked(saveOnboardingStep).mockRejectedValue(new Error("Network error"));
		const { router, queryClient, navigateTo } = await renderNavigation();

		await navigateTo("song-walkthrough");

		expect(router.state.location.href).toBe("/onboarding?step=syncing");
		expect(getOnboardingSession).not.toHaveBeenCalled();
		expect(cachedStatus(queryClient)).toBe("syncing");
	});
});
