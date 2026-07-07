import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dashboardKeys } from "@/features/dashboard/queries";
import { matchDeckKeys } from "@/features/matching/deck-queries";
import {
	matchReviewKeys,
	matchReviewSummaryKeys,
	runMatchSnapshotRefreshEffects,
} from "@/features/matching/queries";
import { playlistKeys } from "@/features/playlists/queries";
import type { ActiveJobs } from "@/lib/server/jobs.functions";
import { useActiveJobs } from "../useActiveJobs";

vi.mock("@/lib/server/jobs.functions", () => ({
	getActiveJobs: vi.fn(),
}));

import { getActiveJobs } from "@/lib/server/jobs.functions";

const ACCOUNT_ID = "test-account-123";

function makeFakeQueryClient(): {
	invalidateQueries: ReturnType<typeof vi.fn>;
} & Pick<QueryClient, "invalidateQueries"> {
	return {
		invalidateQueries: vi.fn().mockResolvedValue(undefined),
	} as unknown as { invalidateQueries: ReturnType<typeof vi.fn> } & Pick<
		QueryClient,
		"invalidateQueries"
	>;
}

beforeEach(() => {
	vi.resetAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("runMatchSnapshotRefreshEffects", () => {
	it("(a) invalidates matchDeckKeys.deckRoot and no longer invalidates matchReviewKeys.reviewsRoot", async () => {
		const qc = makeFakeQueryClient();

		await runMatchSnapshotRefreshEffects(
			qc as unknown as QueryClient,
			ACCOUNT_ID,
		);

		const calledKeys = (
			qc.invalidateQueries as ReturnType<typeof vi.fn>
		).mock.calls.map(
			(call: Array<{ queryKey?: unknown }>) => call[0]?.queryKey,
		);
		// Deck read model: the bounded deck read re-runs across every
		// (account, orientation) deck query. Appends are worker-driven now, and the
		// legacy reviewsRoot review-list family is gone.
		expect(calledKeys).toContainEqual(matchDeckKeys.deckRoot);
		expect(calledKeys).not.toContainEqual(matchReviewKeys.reviewsRoot);
	});

	it("(c) invalidates exactly the deck, summary, and dashboard keys (5 total)", async () => {
		// deckRoot + summariesRoot + dashboard stats/pageData/matchPreviews. No
		// request-path sync and no legacy reviewsRoot invalidation remain.
		const qc = makeFakeQueryClient();

		await runMatchSnapshotRefreshEffects(
			qc as unknown as QueryClient,
			ACCOUNT_ID,
		);

		expect(qc.invalidateQueries).toHaveBeenCalledTimes(5);

		const calledKeys = (
			qc.invalidateQueries as ReturnType<typeof vi.fn>
		).mock.calls.map(
			(call: Array<{ queryKey?: unknown }>) => call[0]?.queryKey,
		);

		expect(calledKeys).toContainEqual(matchDeckKeys.deckRoot);
		expect(calledKeys).toContainEqual(matchReviewSummaryKeys.summariesRoot);
		expect(calledKeys).toContainEqual(dashboardKeys.stats(ACCOUNT_ID));
		expect(calledKeys).toContainEqual(dashboardKeys.matchPreviews(ACCOUNT_ID));
		expect(calledKeys).toContainEqual(dashboardKeys.pageData(ACCOUNT_ID));
	});

	it("(d) does not invalidate playlist data (outside the plan's Phase 6 set)", async () => {
		// playlistKeys.all was a carry-over from enrichment invalidation; a match
		// snapshot refresh does not change playlist rows, so refetching them is waste.
		const qc = makeFakeQueryClient();

		await runMatchSnapshotRefreshEffects(
			qc as unknown as QueryClient,
			ACCOUNT_ID,
		);

		const calledKeys = (
			qc.invalidateQueries as ReturnType<typeof vi.fn>
		).mock.calls.map(
			(call: Array<{ queryKey?: unknown }>) => call[0]?.queryKey,
		);

		expect(calledKeys).not.toContainEqual(playlistKeys.all);
	});
});

// Minimal ActiveJobs shape used by the hook tests — progress fields are
// irrelevant to the assertions here so they are omitted.
function makeActiveJobs(overrides: Partial<ActiveJobs> = {}): ActiveJobs {
	return {
		enrichment: null,
		matchSnapshotRefresh: null,
		firstMatchReady: false,
		firstVisibleMatchReady: false,
		...overrides,
	};
}

describe("useActiveJobs return shape", () => {
	let queryClient: QueryClient;

	function wrapper({ children }: { children: ReactNode }) {
		return createElement(
			QueryClientProvider,
			{ client: queryClient },
			children,
		);
	}

	beforeEach(() => {
		vi.clearAllMocks();
		// No retries so tests resolve on first response without timer manipulation.
		queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
	});

	it("exposes firstVisibleMatchReady from server response", async () => {
		vi.mocked(getActiveJobs).mockResolvedValue(
			makeActiveJobs({ firstVisibleMatchReady: true }),
		);

		const { result } = renderHook(() => useActiveJobs(ACCOUNT_ID), { wrapper });

		await waitFor(() => {
			expect(result.current.firstVisibleMatchReady).toBe(true);
		});
	});

	it("defaults firstVisibleMatchReady to false before data loads", () => {
		// Never resolves — simulates an in-flight request.
		vi.mocked(getActiveJobs).mockReturnValue(new Promise(() => {}) as never);

		const { result } = renderHook(() => useActiveJobs(ACCOUNT_ID), { wrapper });

		// Synchronous check: data is undefined → hook must return false, not undefined.
		expect(result.current.firstVisibleMatchReady).toBe(false);
	});

	it("exposes matchSnapshotRefreshProgress when a refresh job is active", async () => {
		const refreshProgress = {
			done: 3,
			total: 10,
			succeeded: 3,
			failed: 0,
		};
		vi.mocked(getActiveJobs).mockResolvedValue(
			makeActiveJobs({
				matchSnapshotRefresh: {
					id: "job-1",
					status: "running",
					progress: refreshProgress,
				},
			}),
		);

		const { result } = renderHook(() => useActiveJobs(ACCOUNT_ID), { wrapper });

		await waitFor(() => {
			expect(result.current.matchSnapshotRefreshProgress).toEqual(
				refreshProgress,
			);
			expect(result.current.isMatchSnapshotRefreshRunning).toBe(true);
		});
	});

	it("returns null matchSnapshotRefreshProgress when no refresh job is active", async () => {
		vi.mocked(getActiveJobs).mockResolvedValue(
			makeActiveJobs({ matchSnapshotRefresh: null }),
		);

		const { result } = renderHook(() => useActiveJobs(ACCOUNT_ID), { wrapper });

		await waitFor(() => {
			expect(result.current.matchSnapshotRefreshProgress).toBeNull();
		});
	});
});
