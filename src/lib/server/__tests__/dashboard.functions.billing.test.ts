import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDashboardStats, getMatchPreviews } from "../dashboard.functions";

const {
	mockAuthContext,
	mockGetLikedSongCount,
	mockGetAnalyzedCountForAccount,
	mockGetLastCompletedSync,
	mockGetLikedSongStats,
	mockGetPlaylistCount,
	mockGetLatestMatchSnapshot,
	mockGetOrderedUndecidedSongIds,
	mockGetNewItemIds,
	mockRpc,
	mockIn,
	mockFrom,
} = vi.hoisted(() => {
	const mockSelect = vi.fn();
	const mockIn = vi.fn();
	return {
		mockAuthContext: {
			session: { accountId: "acct-1" },
			account: null,
		},
		mockGetLikedSongCount: vi.fn(),
		mockGetAnalyzedCountForAccount: vi.fn(),
		mockGetLastCompletedSync: vi.fn(),
		mockGetLikedSongStats: vi.fn(),
		mockGetPlaylistCount: vi.fn(),
		mockGetLatestMatchSnapshot: vi.fn(),
		mockGetOrderedUndecidedSongIds: vi.fn(),
		mockGetNewItemIds: vi.fn(),
		mockRpc: vi.fn(),
		mockIn,
		mockFrom: vi.fn(() => ({
			select: mockSelect.mockReturnValue({
				in: mockIn,
			}),
		})),
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

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({
		rpc: mockRpc,
		from: mockFrom,
	}),
}));

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
	getStats: (...args: unknown[]) => mockGetLikedSongStats(...args),
}));

vi.mock("@/lib/domains/enrichment/content-analysis/queries", () => ({
	getAnalyzedCountForAccount: (...args: unknown[]) =>
		mockGetAnalyzedCountForAccount(...args),
}));

vi.mock("@/lib/domains/library/liked-songs/status-queries", () => ({
	getNewItemIds: (...args: unknown[]) => mockGetNewItemIds(...args),
}));

vi.mock("@/lib/domains/taste/song-matching/queries", () => ({
	getLatestMatchSnapshot: (...args: unknown[]) =>
		mockGetLatestMatchSnapshot(...args),
}));

vi.mock("@/lib/domains/library/playlists/queries", () => ({
	getPlaylistCount: (...args: unknown[]) => mockGetPlaylistCount(...args),
}));

vi.mock("@/lib/server/matching.functions", () => ({
	getOrderedUndecidedSongIds: (...args: unknown[]) =>
		mockGetOrderedUndecidedSongIds(...args),
}));

vi.mock("@/lib/domains/library/accounts/preferences-queries", () => ({
	resolveMinMatchScore: () => Promise.resolve(0),
}));

describe("getDashboardStats (billing-aware)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns analyzedPercent from the entitlement-aware RPC result", async () => {
		mockGetLikedSongCount.mockResolvedValue(Result.ok(10));
		mockGetAnalyzedCountForAccount.mockResolvedValue(Result.ok(3));
		mockGetLastCompletedSync.mockResolvedValue(Result.ok(null));
		mockGetLikedSongStats.mockResolvedValue(Result.ok({ has_suggestions: 0 }));
		mockGetPlaylistCount.mockResolvedValue(Result.ok(2));

		const stats = await getDashboardStats();

		expect(stats.analyzedPercent).toBe(30);
		expect(stats.totalSongs).toBe(10);
		expect(mockGetAnalyzedCountForAccount).toHaveBeenCalledWith("acct-1");
	});

	it("returns 0 analyzedPercent when RPC returns 0 (locked songs not counted)", async () => {
		mockGetLikedSongCount.mockResolvedValue(Result.ok(5));
		mockGetAnalyzedCountForAccount.mockResolvedValue(Result.ok(0));
		mockGetLastCompletedSync.mockResolvedValue(Result.ok(null));
		mockGetLikedSongStats.mockResolvedValue(Result.ok({ has_suggestions: 0 }));
		mockGetPlaylistCount.mockResolvedValue(Result.ok(0));

		const stats = await getDashboardStats();

		expect(stats.analyzedPercent).toBe(0);
	});

	it("handles analyzedCount error gracefully (defaults to 0)", async () => {
		mockGetLikedSongCount.mockResolvedValue(Result.ok(5));
		mockGetAnalyzedCountForAccount.mockResolvedValue(
			Result.err(new Error("db error")),
		);
		mockGetLastCompletedSync.mockResolvedValue(Result.ok(null));
		mockGetLikedSongStats.mockResolvedValue(Result.ok({ has_suggestions: 0 }));
		mockGetPlaylistCount.mockResolvedValue(Result.ok(0));

		const stats = await getDashboardStats();

		expect(stats.analyzedPercent).toBe(0);
	});
});

describe("getMatchPreviews (billing-aware)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// Ordering + entitlement filtering now live in getOrderedUndecidedSongIds
	// (mocked here, tested directly in matching.functions.billing.test.ts). These
	// tests cover the dashboard's slice-3 + image-mapping contract on top of it.
	it("builds previews from the first 3 ordered, entitled song ids", async () => {
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockGetOrderedUndecidedSongIds.mockResolvedValue({
			songIds: ["song-1", "song-3"],
			hiddenSongCount: 0,
		});

		mockIn.mockResolvedValue({
			data: [
				{ id: "song-1", image_url: "img1.jpg" },
				{ id: "song-3", image_url: "img3.jpg" },
			],
			error: null,
		});

		const previews = await getMatchPreviews();

		expect(mockGetOrderedUndecidedSongIds).toHaveBeenCalledWith(
			"snap-1",
			"acct-1",
		);
		expect(previews).toHaveLength(2);
		expect(previews[0]).toEqual({ id: 1, image: "img1.jpg" });
		expect(previews[1]).toEqual({ id: 2, image: "img3.jpg" });
	});

	it("caps previews at the first 3 ids", async () => {
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockGetOrderedUndecidedSongIds.mockResolvedValue({
			songIds: ["song-1", "song-2", "song-3", "song-4", "song-5"],
			hiddenSongCount: 0,
		});

		mockIn.mockResolvedValue({
			data: [
				{ id: "song-1", image_url: "img1.jpg" },
				{ id: "song-2", image_url: "img2.jpg" },
				{ id: "song-3", image_url: "img3.jpg" },
			],
			error: null,
		});

		const previews = await getMatchPreviews();

		expect(mockIn).toHaveBeenCalledWith("id", ["song-1", "song-2", "song-3"]);
		expect(previews).toHaveLength(3);
	});

	it("returns empty when no songs are undecided/entitled", async () => {
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockGetOrderedUndecidedSongIds.mockResolvedValue({
			songIds: [],
			hiddenSongCount: 0,
		});

		const previews = await getMatchPreviews();

		expect(previews).toHaveLength(0);
		// No ids → no image lookup.
		expect(mockIn).not.toHaveBeenCalled();
	});

	it("returns empty when no snapshot exists", async () => {
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok(null));

		const previews = await getMatchPreviews();

		expect(previews).toHaveLength(0);
		expect(mockGetOrderedUndecidedSongIds).not.toHaveBeenCalled();
	});
});
