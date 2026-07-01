import type { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/match-review-queue.functions", () => ({
	startOrResumeMatchReview: vi.fn(),
}));

import { matchReviewKeys } from "@/features/matching/queries";
import { startOrResumeMatchReview } from "@/lib/server/match-review-queue.functions";
import {
	bootstrapReadyMatchQueue,
	bootstrapRetryDelayMs,
} from "../bootstrap-ready-queue";

function makeFakeQueryClient(): {
	queryClient: QueryClient;
	invalidateQueries: ReturnType<typeof vi.fn>;
} {
	const invalidateQueries = vi.fn().mockResolvedValue(undefined);
	const queryClient = { invalidateQueries } as unknown as QueryClient;
	return { queryClient, invalidateQueries };
}

beforeEach(() => {
	vi.resetAllMocks();
});

describe("bootstrapReadyMatchQueue", () => {
	it("creates/resumes the session for the given orientation, then invalidates its review query", async () => {
		// Transition under test: no_snapshot → first visible match ready. The queue
		// must be created (startOrResume) and the review query refetched so the page
		// mounts the now-ready queue instead of stranding on no-context.
		vi.mocked(startOrResumeMatchReview).mockResolvedValue({
			sessionId: "sess-1",
			itemIds: ["item-1"],
			firstUnresolvedItemId: "item-1",
			total: 1,
			caughtUp: false,
		} as never);
		const { queryClient, invalidateQueries } = makeFakeQueryClient();

		await bootstrapReadyMatchQueue({
			mode: "song",
			accountId: "acct-1",
			queryClient,
		});

		expect(startOrResumeMatchReview).toHaveBeenCalledWith({
			data: { orientation: "song" },
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: matchReviewKeys.review("acct-1", "song"),
		});
	});

	it("passes the playlist orientation through and invalidates the playlist review query", async () => {
		vi.mocked(startOrResumeMatchReview).mockResolvedValue({
			sessionId: "sess-2",
			itemIds: [],
			firstUnresolvedItemId: null,
			total: 0,
			caughtUp: true,
		} as never);
		const { queryClient, invalidateQueries } = makeFakeQueryClient();

		await bootstrapReadyMatchQueue({
			mode: "playlist",
			accountId: "acct-2",
			queryClient,
		});

		expect(startOrResumeMatchReview).toHaveBeenCalledWith({
			data: { orientation: "playlist" },
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: matchReviewKeys.review("acct-2", "playlist"),
		});
	});

	it("does NOT invalidate until the session create/resume resolves", async () => {
		// Ordering guard: invalidating before the session row exists would refetch
		// "no session" and leave the page stranded.
		let resolveStart!: () => void;
		const startPromise = new Promise<void>((res) => {
			resolveStart = res;
		});
		vi.mocked(startOrResumeMatchReview).mockReturnValue(
			startPromise.then(() => ({
				sessionId: "sess-3",
				itemIds: ["item-1"],
				firstUnresolvedItemId: "item-1",
				total: 1,
				caughtUp: false,
			})) as never,
		);
		const { queryClient, invalidateQueries } = makeFakeQueryClient();

		const done = bootstrapReadyMatchQueue({
			mode: "song",
			accountId: "acct-3",
			queryClient,
		});

		expect(invalidateQueries).not.toHaveBeenCalled();

		resolveStart();
		await done;

		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: matchReviewKeys.review("acct-3", "song"),
		});
	});

	it("retries with backoff until create succeeds, then invalidates exactly once", async () => {
		// The stranding bug: a failed create must not dead-end on "building". The
		// loop retries transient failures and only invalidates after it succeeds.
		vi.mocked(startOrResumeMatchReview)
			.mockRejectedValueOnce(new Error("transient-1"))
			.mockRejectedValueOnce(new Error("transient-2"))
			.mockResolvedValueOnce({
				sessionId: "sess-4",
				itemIds: ["item-1"],
				firstUnresolvedItemId: "item-1",
				total: 1,
				caughtUp: false,
			} as never);
		const { queryClient, invalidateQueries } = makeFakeQueryClient();
		const delays: number[] = [];
		const sleep = vi.fn(async (ms: number) => {
			delays.push(ms);
		});

		await bootstrapReadyMatchQueue({
			mode: "song",
			accountId: "acct-4",
			queryClient,
			sleep,
		});

		expect(startOrResumeMatchReview).toHaveBeenCalledTimes(3);
		// Backoff between the two failures: 2s then 4s.
		expect(delays).toEqual([2_000, 4_000]);
		expect(invalidateQueries).toHaveBeenCalledTimes(1);
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: matchReviewKeys.review("acct-4", "song"),
		});
	});

	it("stops retrying once the abort signal fires (unmount / condition cleared)", async () => {
		vi.mocked(startOrResumeMatchReview).mockRejectedValue(
			new Error("persistent"),
		);
		const controller = new AbortController();
		const { queryClient, invalidateQueries } = makeFakeQueryClient();
		// Abort during the first backoff so the loop exits instead of retrying forever.
		const sleep = vi.fn(async () => {
			controller.abort();
		});

		await bootstrapReadyMatchQueue({
			mode: "song",
			accountId: "acct-5",
			queryClient,
			signal: controller.signal,
			sleep,
		});

		expect(startOrResumeMatchReview).toHaveBeenCalledTimes(1);
		expect(invalidateQueries).not.toHaveBeenCalled();
	});

	it("does not attempt at all when already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const { queryClient, invalidateQueries } = makeFakeQueryClient();

		await bootstrapReadyMatchQueue({
			mode: "song",
			accountId: "acct-6",
			queryClient,
			signal: controller.signal,
		});

		expect(startOrResumeMatchReview).not.toHaveBeenCalled();
		expect(invalidateQueries).not.toHaveBeenCalled();
	});
});

describe("bootstrapRetryDelayMs", () => {
	it("grows exponentially from 2s and caps at 30s", () => {
		expect(bootstrapRetryDelayMs(0)).toBe(2_000);
		expect(bootstrapRetryDelayMs(1)).toBe(4_000);
		expect(bootstrapRetryDelayMs(2)).toBe(8_000);
		expect(bootstrapRetryDelayMs(3)).toBe(16_000);
		// 32s would exceed the cap → clamped to 30s, and stays there.
		expect(bootstrapRetryDelayMs(4)).toBe(30_000);
		expect(bootstrapRetryDelayMs(10)).toBe(30_000);
	});
});
