import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDashboardStats, getMatchPreviews } from "../dashboard.functions";

const {
	mockAuthContext,
	mockGetLikedSongCount,
	mockGetAnalyzedCountForAccount,
	mockGetLastCompletedSync,
	mockGetPlaylistCount,
	mockResolveMatchReviewSummary,
} = vi.hoisted(() => {
	return {
		mockAuthContext: {
			session: { accountId: "acct-1" },
			account: null,
		},
		mockGetLikedSongCount: vi.fn(),
		mockGetAnalyzedCountForAccount: vi.fn(),
		mockGetLastCompletedSync: vi.fn(),
		mockGetPlaylistCount: vi.fn(),
		// Phase 7: dashboard stats and previews now source their queue-aware
		// count and preview images from resolveMatchReviewSummary.
		mockResolveMatchReviewSummary: vi.fn(),
	};
});

vi.mock("@tanstack/react-start", () => {
	const builder = (): Record<string, unknown> => ({
		middleware: () => builder(),
		inputValidator: () => builder(),
		handler:
			(
				fn: (args: {
					context: typeof mockAuthContext;
					data: unknown;
				}) => unknown,
			) =>
			(input?: { data?: unknown }) =>
				fn({ context: mockAuthContext, data: input?.data }),
	});
	return {
		createServerFn: builder,
		createMiddleware: () => ({
			server: () => ({}),
			type: () => ({ server: () => ({}) }),
		}),
	};
});

vi.mock("@/lib/platform/auth/auth.middleware", () => ({
	authMiddleware: {},
}));

vi.mock("@/lib/platform/jobs/sync-phase-jobs", () => ({
	getLastCompletedSync: (...args: unknown[]) =>
		mockGetLastCompletedSync(...args),
}));

vi.mock("@/lib/domains/library/liked-songs/queries", () => ({
	getCount: (...args: unknown[]) => mockGetLikedSongCount(...args),
	getRecentWithDetails: vi.fn(),
}));

vi.mock("@/lib/domains/enrichment/content-analysis/queries", () => ({
	getAnalyzedCountForAccount: (...args: unknown[]) =>
		mockGetAnalyzedCountForAccount(...args),
}));

vi.mock("@/lib/domains/library/playlists/queries", () => ({
	getPlaylistCount: (...args: unknown[]) => mockGetPlaylistCount(...args),
}));

// Phase 7: resolveMatchReviewSummary is the new source for CTA count + previews.
// We mock at the module level so dashboard.functions.ts picks it up.
vi.mock("@/lib/server/match-review-queue.functions", () => ({
	resolveMatchReviewSummary: (...args: unknown[]) =>
		mockResolveMatchReviewSummary(...args),
	// Other exports from the module are not exercised by these tests.
	getMatchReviewSummary: vi.fn(),
	syncActiveMatchReviewSessions: vi.fn(),
	startOrResumeMatchReview: vi.fn(),
	getMatchReview: vi.fn(),
	getMatchReviewItem: vi.fn(),
	markMatchReviewItemPresented: vi.fn(),
	addSongToPlaylistFromQueueItem: vi.fn(),
	dismissMatchReviewItem: vi.fn(),
	finishMatchReviewItem: vi.fn(),
}));

describe("getDashboardStats (queue-aware)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns analyzedPercent from the entitlement-aware analyzed count", async () => {
		mockResolveMatchReviewSummary.mockResolvedValue({
			pendingCount: 3,
			previewImages: [],
			hasActiveQueue: true,
		});
		mockGetLikedSongCount.mockResolvedValue(Result.ok(10));
		mockGetAnalyzedCountForAccount.mockResolvedValue(Result.ok(3));
		mockGetLastCompletedSync.mockResolvedValue(Result.ok(null));
		mockGetPlaylistCount.mockResolvedValue(Result.ok(2));

		const stats = await getDashboardStats();

		expect(stats.analyzedPercent).toBe(30);
		expect(stats.totalSongs).toBe(10);
		expect(mockGetAnalyzedCountForAccount).toHaveBeenCalledWith("acct-1");
	});

	it("sources pendingReviewCount from the queue summary, not the snapshot RPC", async () => {
		mockResolveMatchReviewSummary.mockResolvedValue({
			pendingCount: 7,
			previewImages: [],
			hasActiveQueue: true,
		});
		mockGetLikedSongCount.mockResolvedValue(Result.ok(20));
		mockGetAnalyzedCountForAccount.mockResolvedValue(Result.ok(10));
		mockGetLastCompletedSync.mockResolvedValue(Result.ok(null));
		mockGetPlaylistCount.mockResolvedValue(Result.ok(3));

		const stats = await getDashboardStats();

		// The queue summary is the authoritative count; no snapshot RPC is called.
		expect(stats.pendingReviewCount).toBe(7);
		expect(mockResolveMatchReviewSummary).toHaveBeenCalledWith(
			"acct-1",
			"song",
		);
	});

	it("returns pendingReviewCount 0 when caught up", async () => {
		mockResolveMatchReviewSummary.mockResolvedValue({
			pendingCount: 0,
			previewImages: [],
			hasActiveQueue: false,
		});
		mockGetLikedSongCount.mockResolvedValue(Result.ok(5));
		mockGetAnalyzedCountForAccount.mockResolvedValue(Result.ok(5));
		mockGetLastCompletedSync.mockResolvedValue(Result.ok(null));
		mockGetPlaylistCount.mockResolvedValue(Result.ok(0));

		const stats = await getDashboardStats();

		expect(stats.pendingReviewCount).toBe(0);
	});

	it("returns 0 analyzedPercent when analyzed count errors (defaults to 0)", async () => {
		mockResolveMatchReviewSummary.mockResolvedValue({
			pendingCount: 0,
			previewImages: [],
			hasActiveQueue: false,
		});
		mockGetLikedSongCount.mockResolvedValue(Result.ok(5));
		mockGetAnalyzedCountForAccount.mockResolvedValue(
			Result.err(new Error("db error")),
		);
		mockGetLastCompletedSync.mockResolvedValue(Result.ok(null));
		mockGetPlaylistCount.mockResolvedValue(Result.ok(0));

		const stats = await getDashboardStats();

		expect(stats.analyzedPercent).toBe(0);
	});
});

describe("getMatchPreviews (queue-aware)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns previewImages from the queue summary", async () => {
		const previewImages = [
			{ id: 1, image: "img1.jpg", name: "Track 1", artist: "A1" },
			{ id: 2, image: "img2.jpg", name: "Track 2", artist: "A2" },
		];
		mockResolveMatchReviewSummary.mockResolvedValue({
			pendingCount: 5,
			previewImages,
			hasActiveQueue: true,
		});

		const previews = await getMatchPreviews();

		expect(previews).toEqual(previewImages);
		expect(mockResolveMatchReviewSummary).toHaveBeenCalledWith(
			"acct-1",
			"song",
		);
	});

	it("returns empty array when no previews available (caught up)", async () => {
		mockResolveMatchReviewSummary.mockResolvedValue({
			pendingCount: 0,
			previewImages: [],
			hasActiveQueue: false,
		});

		const previews = await getMatchPreviews();

		expect(previews).toHaveLength(0);
	});

	it("returns queue-ordered previews when active queue exists", async () => {
		// The queue service provides its own ordering; the resolver passes through
		// those images in order — no re-sorting in dashboard.functions.
		const ordered = [
			{ id: 1, image: "queue-first.jpg", name: "Track 1", artist: "A1" },
			{ id: 2, image: "queue-second.jpg", name: "Track 2", artist: "A2" },
			{ id: 3, image: "queue-third.jpg", name: "Track 3", artist: "A3" },
		];
		mockResolveMatchReviewSummary.mockResolvedValue({
			pendingCount: 15,
			previewImages: ordered,
			hasActiveQueue: true,
		});

		const previews = await getMatchPreviews();

		expect(previews).toEqual(ordered);
	});
});
