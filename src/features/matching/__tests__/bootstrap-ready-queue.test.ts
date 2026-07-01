import type { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/match-review-queue.functions", () => ({
	startOrResumeMatchReview: vi.fn(),
}));

import { matchReviewKeys } from "@/features/matching/queries";
import { startOrResumeMatchReview } from "@/lib/server/match-review-queue.functions";
import { bootstrapReadyMatchQueue } from "../bootstrap-ready-queue";

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
});
