import { describe, expect, it, vi } from "vitest";

// The bootstrap query's job (P0) is to seed the review cache from the same server
// round-trip so the queue useSuspenseQuery resolves without a second getMatchReview
// call. Mock the server function so the test drives the seeding contract directly.
const startOrResumeMatchReviewMock = vi.fn();

vi.mock("@/lib/server/match-review-queue.functions", () => ({
	getMatchReview: vi.fn(),
	getMatchReviewSummary: vi.fn(),
	getPreferredMatchReviewSummary: vi.fn(),
	presentMatchReviewItem: vi.fn(),
	startOrResumeMatchReview: (...args: unknown[]) =>
		startOrResumeMatchReviewMock(...args),
	syncActiveMatchReviewSessions: vi.fn(),
}));

vi.mock("@/features/dashboard/queries", () => ({
	dashboardKeys: { all: ["dashboard"] },
}));

import {
	matchReviewBootstrapQueryOptions,
	matchReviewKeys,
} from "@/features/matching/queries";

describe("matchReviewBootstrapQueryOptions", () => {
	function fakeContext(setQueryData: ReturnType<typeof vi.fn>) {
		// Only `client.setQueryData` is read by the queryFn; the rest of the
		// QueryFunctionContext is filled to satisfy the call shape.
		return {
			client: { setQueryData },
			queryKey: matchReviewKeys.bootstrap("acct-1", "song"),
			signal: new AbortController().signal,
			meta: undefined,
		} as never;
	}

	it("seeds the review cache from the bootstrap result and returns start metadata", async () => {
		const review = {
			sessionId: "session-1",
			items: [
				{
					id: "item-1",
					position: 0,
					state: "pending",
					subject: { orientation: "song", songId: "song-1" },
					sourceSnapshotId: "snap-1",
				},
			],
			total: 1,
			caughtUp: false,
			hiddenReviewItemCount: 0,
		};
		startOrResumeMatchReviewMock.mockResolvedValue({
			sessionId: "session-1",
			itemIds: ["item-1"],
			firstUnresolvedItemId: "item-1",
			total: 1,
			caughtUp: false,
			review,
		});

		const setQueryData = vi.fn();
		const options = matchReviewBootstrapQueryOptions("acct-1", "song");
		const queryFn = options.queryFn;
		if (typeof queryFn !== "function") throw new Error("expected a queryFn");

		const result = await queryFn(fakeContext(setQueryData));

		// The full review payload is seeded under the review key — the queue query
		// reads it from cache instead of firing a second getMatchReview round-trip.
		expect(setQueryData).toHaveBeenCalledTimes(1);
		expect(setQueryData).toHaveBeenCalledWith(
			matchReviewKeys.review("acct-1", "song"),
			review,
		);
		// Bootstrap only creates/resumes once per (account, orientation) mount.
		expect(startOrResumeMatchReviewMock).toHaveBeenCalledTimes(1);
		expect(startOrResumeMatchReviewMock).toHaveBeenCalledWith({
			data: { orientation: "song" },
		});
		// The bootstrap cache entry holds only the start metadata — review is stripped
		// so the payload isn't duplicated across two cache keys.
		expect(result).toEqual({
			sessionId: "session-1",
			itemIds: ["item-1"],
			firstUnresolvedItemId: "item-1",
			total: 1,
			caughtUp: false,
		});
		expect(result).not.toHaveProperty("review");
	});

	it("seeds under the orientation-scoped review key for playlist mode", async () => {
		const review = {
			sessionId: "session-2",
			items: [],
			total: 0,
			caughtUp: true,
			hiddenReviewItemCount: 2,
		};
		startOrResumeMatchReviewMock.mockResolvedValue({
			sessionId: "session-2",
			itemIds: [],
			firstUnresolvedItemId: null,
			total: 0,
			caughtUp: true,
			review,
		});

		const setQueryData = vi.fn();
		const options = matchReviewBootstrapQueryOptions("acct-1", "playlist");
		const queryFn = options.queryFn;
		if (typeof queryFn !== "function") throw new Error("expected a queryFn");

		await queryFn(fakeContext(setQueryData));

		expect(setQueryData).toHaveBeenCalledWith(
			matchReviewKeys.review("acct-1", "playlist"),
			review,
		);
	});
});
