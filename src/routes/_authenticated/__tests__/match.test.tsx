import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingSession } from "@/lib/domains/library/accounts/onboarding-session";
import { isExtensionInstalled } from "@/lib/extension/detect";
import { getActiveJobs } from "@/lib/server/jobs.functions";
import {
	readMatchDeckCard,
	startOrResumeMatchDeck,
} from "@/lib/server/match-deck.functions";
import { screen } from "@/test/utils/render";
import { renderMatchRoute } from "./match-route-harness";

/**
 * /match's URL canonicalisation and cold-entry loader (RB, N1): mounts the
 * real route under a memory router with a real QueryClient and observes the
 * resulting location, server-fn reads, and rendered card. Only the server fns,
 * the extension transport, and Sentry are mocked.
 */

vi.mock("@/lib/server/match-deck.functions", () => ({
	startOrResumeMatchDeck: vi.fn(),
	readMatchDeckCard: vi.fn(),
	submitMatchDeckAction: vi.fn(),
}));

vi.mock("@/lib/server/jobs.functions", () => ({ getActiveJobs: vi.fn() }));

vi.mock("@/lib/server/settings.functions", () => ({
	setMatchViewModePreference: vi.fn(),
}));

vi.mock("@/lib/extension/detect", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/extension/detect")>()),
	isExtensionInstalled: vi.fn(),
	getSpotifyAccountStatus: vi.fn(),
}));

vi.mock("@/lib/observability/sentry", () => ({ captureRouteError: vi.fn() }));

const BUILDING = { status: "building" };

// Unavailable is the lightest presentation that still mounts the real card UI.
function unavailable(itemId: string) {
	return {
		status: "unavailable",
		itemId,
		reason: "not-entitled",
		message: "This playlist is no longer available to match.",
	};
}

function retryableError(itemId: string) {
	return {
		status: "retryable-error",
		itemId,
		message: "Couldn't load this match card. Try again.",
	};
}

function deckView(currentPresentation: object, nextPresentation: object) {
	return {
		itemIds: ["item-1", "item-2"],
		cards: {
			current: {
				itemId: "item-1",
				position: 0,
				presentation: currentPresentation,
			},
			next: { itemId: "item-2", position: 1, presentation: nextPresentation },
		},
		progress: {
			total: 2,
			remaining: 2,
			caughtUp: false,
			hiddenReviewItemCount: 0,
		},
	};
}

const WALKTHROUGH_SESSION: OnboardingSession = {
	status: "song-walkthrough",
	song: {
		id: "song-1",
		spotifyTrackId: "spotify-track-1",
		slug: "song-1",
		name: "Song One",
		artist: "Artist One",
		artistId: null,
		artistImageUrl: null,
		album: null,
		albumArtUrl: null,
		genres: [],
		analysis: null,
	},
};

let queryClient: QueryClient;

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	vi.mocked(startOrResumeMatchDeck).mockResolvedValue(BUILDING as never);
	vi.mocked(getActiveJobs).mockResolvedValue({
		enrichment: null,
		matchSnapshotRefresh: null,
		firstVisibleMatchReady: false,
	} as never);
	vi.mocked(isExtensionInstalled).mockResolvedValue(false);
});

afterEach(() => {
	queryClient.clear();
	vi.useRealTimers();
});

describe("/match URL canonicalisation (A3)", () => {
	it("replaces mode=playlist with bare /match instead of pushing (a push would loop Back into the redirect)", async () => {
		const { router, history } = await renderMatchRoute({
			queryClient,
			url: "/match?mode=playlist",
		});

		expect(router.state.location.href).toBe("/match");
		expect(history.length).toBe(1);
		expect(startOrResumeMatchDeck).toHaveBeenCalledWith({
			data: { orientation: "playlist" },
		});
	});

	it.each([
		["/match", "playlist"],
		["/match?mode=song", "song"],
	])("keeps canonical %s and reads the %s-orientation deck", async (url, orientation) => {
		const { router } = await renderMatchRoute({ queryClient, url });

		expect(router.state.location.href).toBe(url);
		expect(startOrResumeMatchDeck).toHaveBeenCalledTimes(1);
		expect(startOrResumeMatchDeck).toHaveBeenCalledWith({
			data: { orientation },
		});
	});
});

describe("/match loader — cold-entry deck read (RB)", () => {
	it("never reads the deck for a walkthrough session", async () => {
		await renderMatchRoute({
			queryClient,
			onboardingSession: WALKTHROUGH_SESSION,
		});

		expect(startOrResumeMatchDeck).not.toHaveBeenCalled();
	});

	it("renders the baked current card and next card from the loader's seed, with no per-card reads", async () => {
		vi.mocked(startOrResumeMatchDeck).mockResolvedValue(
			deckView(unavailable("item-1"), unavailable("item-2")) as never,
		);

		await renderMatchRoute({ queryClient });

		expect(
			screen.getByRole("status", { name: /unavailable/i }),
		).toBeInTheDocument();
		expect(readMatchDeckCard).not.toHaveBeenCalled();
	});

	it("N1: re-reads a baked retryable-error card instead of pinning it, so cold entry never lands on the card-load error", async () => {
		vi.mocked(startOrResumeMatchDeck).mockResolvedValue(
			deckView(retryableError("item-1"), unavailable("item-2")) as never,
		);
		vi.mocked(readMatchDeckCard).mockResolvedValue(
			unavailable("item-1") as never,
		);

		await renderMatchRoute({ queryClient });

		expect(readMatchDeckCard).toHaveBeenCalledTimes(1);
		expect(readMatchDeckCard).toHaveBeenCalledWith({
			data: { itemId: "item-1" },
		});
		expect(
			screen.queryByRole("status", { name: /card load error/i }),
		).not.toBeInTheDocument();
		expect(
			screen.getByRole("status", { name: /unavailable/i }),
		).toBeInTheDocument();
	});
});
