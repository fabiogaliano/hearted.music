import { beforeEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

const mockAuthContext = {
	session: { accountId: "acct-1" },
	account: null,
};

const mockGetLatestMatchSnapshot = vi.fn();
const mockGetMatchResults = vi.fn();
const mockGetMatchResultsForSong = vi.fn();
const mockGetMatchDecisions = vi.fn();
const mockGetNewItemIds = vi.fn();

const mockRpc = vi.fn();
const mockSelect = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFrom: ReturnType<typeof vi.fn> = vi.fn(() => ({
	select: mockSelect,
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

vi.mock("@/lib/domains/taste/song-matching/queries", () => ({
	getLatestMatchSnapshot: (...args: unknown[]) =>
		mockGetLatestMatchSnapshot(...args),
	getMatchResults: (...args: unknown[]) => mockGetMatchResults(...args),
	getMatchResultsForSong: (...args: unknown[]) =>
		mockGetMatchResultsForSong(...args),
}));

vi.mock("@/lib/data/match-decision-queries", () => ({
	getMatchDecisions: (...args: unknown[]) => mockGetMatchDecisions(...args),
	insertMatchDecision: vi.fn(),
	insertMatchDecisions: vi.fn(),
}));

vi.mock("@/lib/domains/library/liked-songs/status-queries", () => ({
	getNewItemIds: (...args: unknown[]) => mockGetNewItemIds(...args),
}));

const { getMatchingSession, getSongSuggestions, getSongMatches } = await import(
	"../matching.functions"
);

describe("getMatchingSession (billing-aware)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("counts only entitled songs in totalSongs", async () => {
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockGetMatchResults.mockResolvedValue(
			Result.ok([
				{ song_id: "song-1", playlist_id: "pl-1", score: 90 },
				{ song_id: "song-2", playlist_id: "pl-1", score: 80 },
				{ song_id: "song-3", playlist_id: "pl-1", score: 70 },
			]),
		);
		mockGetMatchDecisions.mockResolvedValue(Result.ok([]));

		mockRpc.mockResolvedValue({
			data: [{ song_id: "song-1" }, { song_id: "song-3" }],
			error: null,
		});

		const result = await getMatchingSession();

		expect(result).toEqual({ snapshotId: "snap-1", totalSongs: 2 });
		expect(mockRpc).toHaveBeenCalledWith(
			"select_entitled_data_enriched_liked_song_ids",
			{ p_account_id: "acct-1" },
		);
	});

	it("excludes revoked songs from count", async () => {
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockGetMatchResults.mockResolvedValue(
			Result.ok([
				{ song_id: "song-1", playlist_id: "pl-1", score: 90 },
				{ song_id: "song-2", playlist_id: "pl-1", score: 80 },
			]),
		);
		mockGetMatchDecisions.mockResolvedValue(Result.ok([]));

		// No songs entitled
		mockRpc.mockResolvedValue({ data: [], error: null });

		const result = await getMatchingSession();

		expect(result).toEqual({ snapshotId: "snap-1", totalSongs: 0 });
	});

	it("defaults to empty entitled set on RPC error", async () => {
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockGetMatchResults.mockResolvedValue(
			Result.ok([{ song_id: "song-1", playlist_id: "pl-1", score: 90 }]),
		);
		mockGetMatchDecisions.mockResolvedValue(Result.ok([]));

		mockRpc.mockResolvedValue({
			data: null,
			error: { code: "500", message: "rpc error" },
		});

		const result = await getMatchingSession();

		expect(result).toEqual({ snapshotId: "snap-1", totalSongs: 0 });
	});

	it("returns null when no snapshot exists", async () => {
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok(null));

		const result = await getMatchingSession();

		expect(result).toBeNull();
	});
});

describe("getSongSuggestions (billing-aware)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns matches for an entitled song", async () => {
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));

		// Song is entitled
		mockRpc.mockResolvedValue({ data: true, error: null });

		mockGetMatchResultsForSong.mockResolvedValue(
			Result.ok([
				{ song_id: "song-1", playlist_id: "pl-1", score: 85 },
				{ song_id: "song-1", playlist_id: "pl-2", score: 75 },
			]),
		);
		mockGetMatchDecisions.mockResolvedValue(Result.ok([]));

		mockSelect.mockReturnValue({
			in: vi.fn().mockResolvedValue({
				data: [
					{ id: "pl-1", name: "Playlist 1" },
					{ id: "pl-2", name: "Playlist 2" },
				],
				error: null,
			}),
		});

		const result = await getSongSuggestions({
			data: { songId: "song-1" },
		});

		expect(result).not.toBeNull();
		expect(result?.matches).toHaveLength(2);
		expect(result?.matches[0].playlistName).toBe("Playlist 1");
		expect(mockRpc).toHaveBeenCalledWith("is_account_song_entitled", {
			p_account_id: "acct-1",
			p_song_id: "song-1",
		});
	});

	it("returns null for a locked song", async () => {
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));

		// Song is NOT entitled
		mockRpc.mockResolvedValue({ data: false, error: null });

		const result = await getSongSuggestions({
			data: { songId: "song-locked" },
		});

		expect(result).toBeNull();
	});

	it("returns null when entitlement RPC errors", async () => {
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));

		mockRpc.mockResolvedValue({
			data: null,
			error: { code: "500", message: "rpc error" },
		});

		const result = await getSongSuggestions({
			data: { songId: "song-1" },
		});

		expect(result).toBeNull();
	});
});

describe("getSongMatches (billing-aware)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function setupEntitledSongMatches(entitledSongIds: string[]) {
		mockGetMatchResults.mockResolvedValue(
			Result.ok([
				{ song_id: "song-1", playlist_id: "pl-1", score: 90 },
				{ song_id: "song-2", playlist_id: "pl-1", score: 80 },
				{ song_id: "song-3", playlist_id: "pl-1", score: 70 },
			]),
		);
		mockGetMatchDecisions.mockResolvedValue(Result.ok([]));
		mockGetNewItemIds.mockResolvedValue(Result.ok([]));

		// Entitlement RPC (called via select_entitled_data_enriched_liked_song_ids)
		mockRpc.mockResolvedValue({
			data: entitledSongIds.map((id) => ({ song_id: id })),
			error: null,
		});
	}

	function setupSongDetailMocks(songId: string) {
		// Chain for supabase.from("song").select("*").eq("id", songId).single()
		const eqSingle = vi.fn().mockResolvedValue({
			data: {
				id: songId,
				name: "Test Song",
				artists: ["Test Artist"],
				album_name: "Test Album",
				image_url: "img.jpg",
				genres: ["pop"],
			},
			error: null,
		});
		const eqAnalysis = vi.fn().mockReturnValue({
			order: vi.fn().mockReturnValue({
				limit: vi.fn().mockReturnValue({
					maybeSingle: vi.fn().mockResolvedValue({
						data: { analysis: { headline: "Great song" } },
						error: null,
					}),
				}),
			}),
		});
		const eqAudio = vi.fn().mockReturnValue({
			maybeSingle: vi.fn().mockResolvedValue({
				data: { tempo: 120, energy: 0.8, valence: 0.6 },
				error: null,
			}),
		});
		const eqPlaylistIn = vi.fn().mockResolvedValue({
			data: [
				{
					id: "pl-1",
					name: "Playlist 1",
					description: "desc",
					song_count: 10,
					spotify_id: "sp-pl-1",
				},
			],
			error: null,
		});

		mockFrom.mockImplementation((table: string) => {
			if (table === "song") {
				return {
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({ single: eqSingle }),
					}),
				};
			}
			if (table === "song_analysis") {
				return { select: vi.fn().mockReturnValue({ eq: eqAnalysis }) };
			}
			if (table === "song_audio_feature") {
				return { select: vi.fn().mockReturnValue({ eq: eqAudio }) };
			}
			if (table === "playlist") {
				return {
					select: vi.fn().mockReturnValue({ in: eqPlaylistIn }),
				};
			}
			return {
				select: vi.fn().mockReturnValue({ in: vi.fn(), eq: vi.fn() }),
			};
		});
	}

	it("filters undecided songs to only entitled ones", async () => {
		setupEntitledSongMatches(["song-1", "song-3"]);
		setupSongDetailMocks("song-1");

		const result = await getSongMatches({
			data: { snapshotId: "snap-1", offset: 0 },
		});

		expect(result).not.toBeNull();
		expect(result?.song.id).toBe("song-1");
		expect(mockRpc).toHaveBeenCalledWith(
			"select_entitled_data_enriched_liked_song_ids",
			{ p_account_id: "acct-1" },
		);
	});

	it("skips revoked song at offset 0 and selects next entitled song", async () => {
		// song-1 has highest score but is NOT entitled
		setupEntitledSongMatches(["song-2", "song-3"]);
		setupSongDetailMocks("song-2");

		const result = await getSongMatches({
			data: { snapshotId: "snap-1", offset: 0 },
		});

		expect(result).not.toBeNull();
		// song-2 should be at offset 0 since song-1 is filtered out
		expect(result?.song.id).toBe("song-2");
	});

	it("returns null when offset exceeds entitled song count", async () => {
		setupEntitledSongMatches(["song-1"]);

		const result = await getSongMatches({
			data: { snapshotId: "snap-1", offset: 1 },
		});

		expect(result).toBeNull();
	});

	it("returns null when no songs are entitled (RPC error)", async () => {
		mockGetMatchResults.mockResolvedValue(
			Result.ok([{ song_id: "song-1", playlist_id: "pl-1", score: 90 }]),
		);
		mockGetMatchDecisions.mockResolvedValue(Result.ok([]));
		mockGetNewItemIds.mockResolvedValue(Result.ok([]));

		mockRpc.mockResolvedValue({
			data: null,
			error: { code: "500", message: "rpc error" },
		});

		const result = await getSongMatches({
			data: { snapshotId: "snap-1", offset: 0 },
		});

		expect(result).toBeNull();
	});

	it("self-hosted user sees all matches when all songs entitled", async () => {
		setupEntitledSongMatches(["song-1", "song-2", "song-3"]);
		setupSongDetailMocks("song-1");

		const result = await getSongMatches({
			data: { snapshotId: "snap-1", offset: 0 },
		});

		expect(result).not.toBeNull();
		expect(result?.song.id).toBe("song-1");
	});

	it("returns analysis for entitled songs", async () => {
		setupEntitledSongMatches(["song-1"]);
		setupSongDetailMocks("song-1");

		const result = await getSongMatches({
			data: { snapshotId: "snap-1", offset: 0 },
		});

		expect(result).not.toBeNull();
		expect(result?.song.analysis).toEqual({ headline: "Great song" });
	});
});
