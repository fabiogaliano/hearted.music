import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeJobsKeys } from "@/lib/hooks/active-jobs-keys";
import { accountEventsConnectionKey } from "@/lib/hooks/useAccountEvents";
import { getActiveJobs } from "@/lib/server/jobs.functions";
import { startOrResumeMatchDeck } from "@/lib/server/match-deck.functions";
import { act } from "@/test/utils/render";
import { ACCOUNT_ID, advance, renderMatchRoute } from "./match-route-harness";

/**
 * QueueMatchPage's building-recovery poll (M8): mounts the real /match route
 * under a memory router with a real QueryClient, and counts deck reads as
 * fake time advances. Only the server fns are mocked.
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

vi.mock("@/lib/observability/sentry", () => ({ captureRouteError: vi.fn() }));

// Mirrors BUILDING_POLL_INTERVAL_MS / MAX_BUILDING_POLLS in match.tsx — the
// literal contract the poll must keep; a deliberate constant change should
// update this alongside it.
const BUILDING_POLL_INTERVAL_MS = 3_000;
const MAX_BUILDING_POLLS = 5;

const BUILDING = { status: "building" };
// Caught up with nothing to show: renders the empty state, not the deck UI.
const READY = {
	itemIds: [],
	cards: { current: null, next: null },
	progress: {
		total: 0,
		remaining: 0,
		caughtUp: true,
		hiddenReviewItemCount: 0,
	},
};

let queryClient: QueryClient;

async function renderMatchPage({
	firstVisibleMatchReady,
	streamConnected = false,
}: {
	firstVisibleMatchReady: boolean;
	streamConnected?: boolean;
}) {
	const activeJobs = {
		enrichment: null,
		matchSnapshotRefresh: null,
		firstMatchReady: firstVisibleMatchReady,
		firstVisibleMatchReady,
	};
	vi.mocked(getActiveJobs).mockResolvedValue(activeJobs as never);
	queryClient.setQueryData(activeJobsKeys.byAccount(ACCOUNT_ID), activeJobs);
	if (streamConnected) {
		queryClient.setQueryData(
			accountEventsConnectionKey(ACCOUNT_ID),
			"connected",
		);
	}

	await renderMatchRoute({ queryClient });
}

const deckReads = () => vi.mocked(startOrResumeMatchDeck).mock.calls.length;

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	vi.mocked(startOrResumeMatchDeck).mockResolvedValue(BUILDING as never);
});

afterEach(() => {
	queryClient.clear();
	vi.useRealTimers();
});

describe("M8 — building-recovery poll is bounded, not one-shot", () => {
	it("keeps polling on a fixed interval while still building and a first visible match is ready", async () => {
		await renderMatchPage({ firstVisibleMatchReady: true });
		expect(deckReads()).toBe(1); // the loader's read

		await advance(BUILDING_POLL_INTERVAL_MS - 1);
		expect(deckReads()).toBe(1);
		await advance(1);
		expect(deckReads()).toBe(2);
		await advance(BUILDING_POLL_INTERVAL_MS);
		expect(deckReads()).toBe(3);
	});

	it("stops polling once MAX_BUILDING_POLLS is reached (bounded, not indefinite — the old one-shot effect's failure mode)", async () => {
		await renderMatchPage({ firstVisibleMatchReady: true });

		await advance(BUILDING_POLL_INTERVAL_MS * (MAX_BUILDING_POLLS + 5));

		expect(deckReads()).toBe(1 + MAX_BUILDING_POLLS);
	});

	it("does not poll when firstVisibleMatchReady is false, even while still building", async () => {
		await renderMatchPage({ firstVisibleMatchReady: false });

		await advance(BUILDING_POLL_INTERVAL_MS * 3);

		expect(deckReads()).toBe(1);
	});

	it("quiets the building fallback once the stream is connected", async () => {
		await renderMatchPage({
			firstVisibleMatchReady: true,
			streamConnected: true,
		});

		await advance(BUILDING_POLL_INTERVAL_MS * 3);

		expect(deckReads()).toBe(1);
	});

	it("stops polling once the deck is no longer building", async () => {
		await renderMatchPage({ firstVisibleMatchReady: true });
		vi.mocked(startOrResumeMatchDeck).mockResolvedValue(READY as never);

		await advance(BUILDING_POLL_INTERVAL_MS); // this poll resolves the deck
		expect(deckReads()).toBe(2);
		await advance(BUILDING_POLL_INTERVAL_MS * 3);

		expect(deckReads()).toBe(2);
	});

	it("gives a later building spell its own fresh bounded window instead of an exhausted counter", async () => {
		await renderMatchPage({ firstVisibleMatchReady: true });
		await advance(BUILDING_POLL_INTERVAL_MS * (MAX_BUILDING_POLLS + 2));
		expect(deckReads()).toBe(1 + MAX_BUILDING_POLLS); // exhausted

		// The deck resolves (e.g. a refocus refetch), which is what clears the
		// baseline — exhausting the bound alone does not.
		vi.mocked(startOrResumeMatchDeck).mockResolvedValue(READY as never);
		await act(() =>
			queryClient.invalidateQueries({ queryKey: ["match-deck"] }),
		);
		await advance(0);
		// A later, distinct building spell (a fresh mid-session publish) must
		// get its own bounded window, not inherit the old exhausted baseline.
		vi.mocked(startOrResumeMatchDeck).mockResolvedValue(BUILDING as never);
		await act(() =>
			queryClient.invalidateQueries({ queryKey: ["match-deck"] }),
		);
		await advance(0);
		const readsBeforeSecondSpell = deckReads();

		await advance(BUILDING_POLL_INTERVAL_MS * (MAX_BUILDING_POLLS + 2));

		expect(deckReads() - readsBeforeSecondSpell).toBe(MAX_BUILDING_POLLS);
	});
});
