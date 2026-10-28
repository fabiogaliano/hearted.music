import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	activeJobsKeys,
	dashboardKeys,
	invalidateMatchSnapshotQueries,
	matchDeckKeys,
	matchReviewSummaryKeys,
	playlistKeys,
} from "@/lib/query-keys";
import type { ActiveJobs } from "@/lib/workflows/library-processing/active-jobs";
import { accountEventsConnectionKey } from "../useAccountEvents";
import { useActiveJobCompletionEffects, useActiveJobs } from "../useActiveJobs";

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

describe("invalidateMatchSnapshotQueries", () => {
	it("(a) invalidates matchDeckKeys.deckRoot", async () => {
		const qc = makeFakeQueryClient();

		await invalidateMatchSnapshotQueries(
			qc as unknown as QueryClient,
			ACCOUNT_ID,
		);

		const calledKeys = (
			qc.invalidateQueries as ReturnType<typeof vi.fn>
		).mock.calls.map(
			(call: Array<{ queryKey?: unknown }>) => call[0]?.queryKey,
		);
		// Deck read model: the bounded deck read re-runs across every
		// (account, orientation) deck query. Appends are worker-driven now.
		expect(calledKeys).toContainEqual(matchDeckKeys.deckRoot);
	});

	it("(c) invalidates exactly the deck, summary, and dashboard keys (5 total)", async () => {
		// deckRoot + summariesRoot + dashboard stats/pageData/matchPreviews. No
		// request-path sync and no legacy reviewsRoot invalidation remain.
		const qc = makeFakeQueryClient();

		await invalidateMatchSnapshotQueries(
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

		await invalidateMatchSnapshotQueries(
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
		extensionSync: null,
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

	afterEach(() => {
		vi.useRealTimers();
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

	it("quiesces periodic polling while the account-events stream is connected", async () => {
		vi.useFakeTimers();
		queryClient.setQueryData(
			accountEventsConnectionKey(ACCOUNT_ID),
			"connected",
		);
		vi.mocked(getActiveJobs).mockResolvedValue(makeActiveJobs());

		renderHook(() => useActiveJobs(ACCOUNT_ID), { wrapper });

		await act(async () => {
			await Promise.resolve();
		});
		expect(getActiveJobs).toHaveBeenCalledTimes(1);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(20_000);
		});

		expect(getActiveJobs).toHaveBeenCalledTimes(1);
	});

	it("backs off and stops fallback polling after 5 consecutive failures (polled a failing server every 15 s forever)", async () => {
		vi.useFakeTimers();
		vi.mocked(getActiveJobs).mockRejectedValue(new Error("503"));

		renderHook(() => useActiveJobs(ACCOUNT_ID), { wrapper });

		await act(async () => {
			await vi.advanceTimersByTimeAsync(29_000);
		});
		// The first retry waits 30 s, not one 15 s poll interval.
		expect(getActiveJobs).toHaveBeenCalledTimes(1);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
		});
		expect(getActiveJobs).toHaveBeenCalledTimes(5);
	});

	it("resumes fallback polling while the stream is disconnected", async () => {
		vi.useFakeTimers();
		queryClient.setQueryData(
			accountEventsConnectionKey(ACCOUNT_ID),
			"disconnected",
		);
		vi.mocked(getActiveJobs).mockResolvedValue(makeActiveJobs());

		renderHook(() => useActiveJobs(ACCOUNT_ID), { wrapper });

		await act(async () => {
			await Promise.resolve();
		});
		expect(getActiveJobs).toHaveBeenCalledTimes(1);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(15_000);
			await Promise.resolve();
		});

		expect(getActiveJobs).toHaveBeenCalledTimes(2);
	});
});

describe("useActiveJobCompletionEffects", () => {
	let queryClient: QueryClient;

	function wrapper({ children }: { children: ReactNode }) {
		return createElement(
			QueryClientProvider,
			{ client: queryClient },
			children,
		);
	}

	beforeEach(() => {
		queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
	});

	function recentActivityInvalidations(spy: {
		mock: { calls: Parameters<QueryClient["invalidateQueries"]>[] };
	}) {
		return spy.mock.calls.filter(
			([options]) =>
				JSON.stringify(options?.queryKey) ===
				JSON.stringify(dashboardKeys.recentActivity(ACCOUNT_ID)),
		);
	}

	it("refreshes recent activity when the extension sync job finishes, not while it is queued (regression: new songs only showed after a page reload)", async () => {
		const syncJob = { id: "sync-1", status: "running" as const };
		vi.mocked(getActiveJobs).mockResolvedValue(
			makeActiveJobs({ extensionSync: syncJob }),
		);
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		// The effect only fires on a running → finished transition it has
		// rendered with, and React Query batches observer notifications, so each
		// step waits for the render that saw the state, not just for the fetch.
		const { result } = renderHook(
			() => {
				useActiveJobCompletionEffects(ACCOUNT_ID);
				return queryClient.getQueryData<ActiveJobs>(
					activeJobsKeys.byAccount(ACCOUNT_ID),
				)?.extensionSync;
			},
			{ wrapper },
		);
		await waitFor(() => expect(result.current).toEqual(syncJob));

		// Still running on the next read: nothing to refresh yet.
		await act(async () => {
			await queryClient.refetchQueries({
				queryKey: activeJobsKeys.byAccount(ACCOUNT_ID),
			});
		});
		expect(recentActivityInvalidations(invalidateSpy)).toHaveLength(0);

		vi.mocked(getActiveJobs).mockResolvedValue(makeActiveJobs());
		await act(async () => {
			await queryClient.refetchQueries({
				queryKey: activeJobsKeys.byAccount(ACCOUNT_ID),
			});
		});
		await waitFor(() => expect(result.current).toBeNull());

		await waitFor(() =>
			expect(recentActivityInvalidations(invalidateSpy)).toHaveLength(1),
		);
	});
});
