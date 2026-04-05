import { beforeEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

const mockAuthContext = {
	session: { accountId: "acct-1" },
	account: null,
};

// Mocks for fetchDashboardStats dependencies
const mockGetLikedSongCount = vi.fn();
const mockGetAnalyzedCountForAccount = vi.fn();
const mockGetLastCompletedSync = vi.fn();
const mockGetLikedSongStats = vi.fn();
const mockGetPlaylistCount = vi.fn();

// Mocks for fetchMatchPreviews dependencies
const mockGetLatestMatchSnapshot = vi.fn();
const mockGetUndecidedSongs = vi.fn();
const mockGetNewItemIds = vi.fn();

// Supabase mock
const mockRpc = vi.fn();
const mockSelect = vi.fn();
const mockIn = vi.fn();
const mockFrom = vi.fn(() => ({
	select: mockSelect.mockReturnValue({
		in: mockIn,
	}),
}));

vi.mock("@tanstack/react-start", () => {
	const builder = (): Record<string, unknown> => ({
		middleware: () => builder(),
		inputValidator: () => builder(),
		handler: (fn: Function) => (input?: { data?: unknown }) =>
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

vi.mock("@/lib/data/jobs", () => ({
	getLastCompletedSync: (...args: unknown[]) =>
		mockGetLastCompletedSync(...args),
}));

vi.mock("@/lib/domains/library/liked-songs/queries", () => ({
	getCount: (...args: unknown[]) => mockGetLikedSongCount(...args),
	getRecentWithDetails: vi.fn().mockResolvedValue(Result.ok([])),
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
	getUndecidedSongs: (...args: unknown[]) => mockGetUndecidedSongs(...args),
}));

const { getDashboardStats, getMatchPreviews } = await import(
	"../dashboard.functions"
);

describe("getDashboardStats (billing-aware)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns analyzedPercent from the entitlement-aware RPC result", async () => {
		mockGetLikedSongCount.mockResolvedValue(Result.ok(10));
		mockGetAnalyzedCountForAccount.mockResolvedValue(Result.ok(3));
		mockGetLastCompletedSync.mockResolvedValue(Result.ok(null));
		mockGetLikedSongStats.mockResolvedValue(Result.ok({ new_suggestions: 0 }));
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
		mockGetLikedSongStats.mockResolvedValue(Result.ok({ new_suggestions: 0 }));
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
		mockGetLikedSongStats.mockResolvedValue(Result.ok({ new_suggestions: 0 }));
		mockGetPlaylistCount.mockResolvedValue(Result.ok(0));

		const stats = await getDashboardStats();

		expect(stats.analyzedPercent).toBe(0);
	});
});

describe("getMatchPreviews (billing-aware)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("filters undecided songs to only entitled songs", async () => {
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockGetUndecidedSongs.mockResolvedValue([
			{ songId: "song-1", maxScore: 90 },
			{ songId: "song-2", maxScore: 80 },
			{ songId: "song-3", maxScore: 70 },
		]);
		mockGetNewItemIds.mockResolvedValue(Result.ok([]));

		// Only song-1 and song-3 are entitled
		mockRpc.mockResolvedValue({
			data: [{ song_id: "song-1" }, { song_id: "song-3" }],
			error: null,
		});

		mockIn.mockResolvedValue({
			data: [
				{ id: "song-1", image_url: "img1.jpg" },
				{ id: "song-3", image_url: "img3.jpg" },
			],
			error: null,
		});

		const previews = await getMatchPreviews();

		expect(mockRpc).toHaveBeenCalledWith(
			"select_entitled_data_enriched_liked_song_ids",
			{ p_account_id: "acct-1" },
		);

		// song-2 should be excluded (not entitled)
		expect(previews).toHaveLength(2);
		expect(previews[0]).toEqual({ id: 1, image: "img1.jpg" });
		expect(previews[1]).toEqual({ id: 2, image: "img3.jpg" });
	});

	it("returns empty when no undecided songs are entitled", async () => {
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockGetUndecidedSongs.mockResolvedValue([
			{ songId: "song-1", maxScore: 90 },
		]);
		mockGetNewItemIds.mockResolvedValue(Result.ok([]));

		// No entitled songs
		mockRpc.mockResolvedValue({ data: [], error: null });

		mockIn.mockResolvedValue({ data: [], error: null });

		const previews = await getMatchPreviews();

		expect(previews).toHaveLength(0);
	});

	it("returns empty when no snapshot exists", async () => {
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok(null));

		const previews = await getMatchPreviews();

		expect(previews).toHaveLength(0);
	});

	it("handles entitlement RPC error gracefully (filters all out)", async () => {
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockGetUndecidedSongs.mockResolvedValue([
			{ songId: "song-1", maxScore: 90 },
		]);
		mockGetNewItemIds.mockResolvedValue(Result.ok([]));

		mockRpc.mockResolvedValue({
			data: null,
			error: { code: "500", message: "rpc error" },
		});

		mockIn.mockResolvedValue({ data: [], error: null });

		const previews = await getMatchPreviews();

		expect(previews).toHaveLength(0);
	});
});
