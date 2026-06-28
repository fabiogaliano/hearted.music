import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addSongToPlaylist, getSongSuggestions } from "../matching.functions";

const {
	mockAuthContext,
	mockGetLatestMatchSnapshot,
	mockGetMatchResults,
	mockGetMatchResultsForSong,
	mockGetMatchPairsForSong,
	mockGetMatchRankingsForSong,
	mockGetServedRanksForSong,
	mockGetMatchDecisionsForSongs,
	mockGetNewItemIds,
	mockUpsertMatchDecision,
	mockResolveMinMatchScore,
	mockRpc,
	mockSelect,
	mockFrom,
} = vi.hoisted(() => {
	const mockSelect = vi.fn();
	const mockFrom: ReturnType<typeof vi.fn> = vi.fn(() => ({
		select: mockSelect,
	}));
	return {
		mockAuthContext: {
			session: { accountId: "acct-1" },
			account: null,
		},
		mockGetLatestMatchSnapshot: vi.fn(),
		mockGetMatchResults: vi.fn(),
		mockGetMatchResultsForSong: vi.fn(),
		mockGetMatchPairsForSong: vi.fn(),
		mockGetMatchRankingsForSong: vi.fn(),
		mockGetServedRanksForSong: vi.fn(),
		mockGetMatchDecisionsForSongs: vi.fn(),
		mockGetNewItemIds: vi.fn(),
		mockUpsertMatchDecision: vi.fn(),
		// Default 0 = no read-time bar, so existing entitlement/ordering
		// expectations are unaffected. clearAllMocks keeps this implementation.
		mockResolveMinMatchScore: vi.fn().mockResolvedValue(0),
		mockRpc: vi.fn(),
		mockSelect,
		mockFrom,
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

vi.mock("@/lib/domains/taste/song-matching/queries", () => ({
	getLatestMatchSnapshot: (...args: unknown[]) =>
		mockGetLatestMatchSnapshot(...args),
	getMatchResults: (...args: unknown[]) => mockGetMatchResults(...args),
	getMatchResultsForSong: (...args: unknown[]) =>
		mockGetMatchResultsForSong(...args),
	getMatchPairsForSong: (...args: unknown[]) =>
		mockGetMatchPairsForSong(...args),
	getMatchRankingsForSong: (...args: unknown[]) =>
		mockGetMatchRankingsForSong(...args),
	getServedRanksForSong: (...args: unknown[]) =>
		mockGetServedRanksForSong(...args),
}));

vi.mock("@/lib/domains/taste/song-matching/decision-queries", () => ({
	getMatchDecisionsForSongs: (...args: unknown[]) =>
		mockGetMatchDecisionsForSongs(...args),
	upsertMatchDecision: (...args: unknown[]) => mockUpsertMatchDecision(...args),
}));

vi.mock("@/lib/domains/library/liked-songs/status-queries", () => ({
	getNewItemIds: (...args: unknown[]) => mockGetNewItemIds(...args),
}));

vi.mock("@/lib/domains/library/accounts/preferences-queries", () => ({
	resolveMinMatchScore: (...args: unknown[]) =>
		mockResolveMinMatchScore(...args),
}));

describe("getSongSuggestions (billing-aware)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns matches ordered by song-orientation model rank, not raw score", async () => {
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockRpc.mockResolvedValue({ data: true, error: null });

		// pl-1 has the higher raw score but lower model rank — the ranking wins.
		mockGetMatchPairsForSong.mockResolvedValue(
			Result.ok([
				{
					song_id: "song-1",
					playlist_id: "pl-1",
					score: 0.85,
					fused_score: 0.8,
				},
				{
					song_id: "song-1",
					playlist_id: "pl-2",
					score: 0.75,
					fused_score: 0.9,
				},
			]),
		);
		mockGetMatchRankingsForSong.mockResolvedValue(
			Result.ok([
				{
					song_id: "song-1",
					playlist_id: "pl-2",
					rank: 1,
					ordering_score: 0.9,
				},
				{
					song_id: "song-1",
					playlist_id: "pl-1",
					rank: 2,
					ordering_score: 0.8,
				},
			]),
		);
		mockGetMatchDecisionsForSongs.mockResolvedValue(Result.ok([]));

		mockSelect.mockReturnValue({
			in: vi.fn().mockResolvedValue({
				data: [
					{ id: "pl-1", name: "Playlist 1", spotify_id: "sp-pl-1" },
					{ id: "pl-2", name: "Playlist 2", spotify_id: "sp-pl-2" },
				],
				error: null,
			}),
		});

		const result = await getSongSuggestions({ data: { songId: "song-1" } });

		expect(result).not.toBeNull();
		expect(result?.matches).toHaveLength(2);
		// pl-2 is rank 1 despite lower raw score — model rank wins.
		expect(result?.matches[0].playlistName).toBe("Playlist 2");
		// fitScore (strictnessScore = fused_score) is used, never legacy raw score.
		expect(result?.matches[0].fitScore).toBeCloseTo(0.9);
		expect(result?.matches[1].playlistName).toBe("Playlist 1");
		expect(result?.matches[1].fitScore).toBeCloseTo(0.8);
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

	it("excludes pairs below minScore and filters decided pairs", async () => {
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockRpc.mockResolvedValue({ data: true, error: null });
		// pl-3 has fitScore below the 0.5 minScore bar — must be filtered out.
		// pl-4 is already decided — must be excluded.
		mockGetMatchPairsForSong.mockResolvedValue(
			Result.ok([
				{
					song_id: "song-1",
					playlist_id: "pl-3",
					score: 0.3,
					fused_score: 0.3,
				},
				{
					song_id: "song-1",
					playlist_id: "pl-4",
					score: 0.9,
					fused_score: 0.9,
				},
				{
					song_id: "song-1",
					playlist_id: "pl-5",
					score: 0.8,
					fused_score: 0.7,
				},
			]),
		);
		mockGetMatchRankingsForSong.mockResolvedValue(Result.ok([]));
		mockGetMatchDecisionsForSongs.mockResolvedValue(
			Result.ok([{ song_id: "song-1", playlist_id: "pl-4" }]),
		);
		mockResolveMinMatchScore.mockResolvedValue(0.5);

		mockSelect.mockReturnValue({
			in: vi.fn().mockResolvedValue({
				data: [{ id: "pl-5", name: "Playlist 5", spotify_id: "sp-pl-5" }],
				error: null,
			}),
		});

		const result = await getSongSuggestions({ data: { songId: "song-1" } });

		expect(result?.matches).toHaveLength(1);
		expect(result?.matches[0].playlistName).toBe("Playlist 5");
		// fitScore = fused_score = 0.7, not the raw score 0.8.
		expect(result?.matches[0].fitScore).toBeCloseTo(0.7);
	});
});

describe("match decision ownership checks", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUpsertMatchDecision.mockResolvedValue(Result.ok({ id: "dec-1" }));
	});

	it("rejects addSongToPlaylist when the song is not owned by the account", async () => {
		mockFrom.mockImplementation((table: string) => {
			if (table === "liked_song") {
				return {
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								is: vi.fn().mockReturnValue({
									maybeSingle: vi
										.fn()
										.mockResolvedValue({ data: null, error: null }),
								}),
							}),
						}),
					}),
				};
			}
			if (table === "playlist") {
				return {
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							in: vi.fn().mockResolvedValue({
								data: [{ id: "pl-1" }],
								error: null,
							}),
						}),
					}),
				};
			}
			return { select: vi.fn() };
		});

		const result = await addSongToPlaylist({
			data: { songId: "song-1", playlistId: "pl-1" },
		});

		expect(result).toEqual({ success: false });
		expect(mockUpsertMatchDecision).not.toHaveBeenCalled();
	});
});

describe("match decision served-context logging", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUpsertMatchDecision.mockResolvedValue(Result.ok({ id: "dec-1" }));
	});

	// Wires the ownership reads the handlers run before they log a decision:
	// liked_song (song owned), playlist (playlists owned). Snapshot ownership is
	// resolved inside getServedRanksForSong, mocked per test.
	function mockOwnership(
		opts: { songOwned?: boolean; ownedPlaylistIds?: string[] } = {},
	) {
		const { songOwned = true, ownedPlaylistIds = ["pl-1"] } = opts;
		mockFrom.mockImplementation((table: string) => {
			if (table === "liked_song") {
				return {
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								is: vi.fn().mockReturnValue({
									maybeSingle: vi.fn().mockResolvedValue({
										data: songOwned ? { song_id: "song-1" } : null,
										error: null,
									}),
								}),
							}),
						}),
					}),
				};
			}
			if (table === "playlist") {
				return {
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							in: vi.fn().mockResolvedValue({
								data: ownedPlaylistIds.map((id) => ({ id })),
								error: null,
							}),
						}),
					}),
				};
			}
			return { select: vi.fn() };
		});
	}

	it("logs snapshot_id and model_rank for a surfaced add", async () => {
		mockOwnership();
		mockGetServedRanksForSong.mockResolvedValue(
			Result.ok([{ playlist_id: "pl-1", rank: 3 }]),
		);

		const result = await addSongToPlaylist({
			data: { songId: "song-1", playlistId: "pl-1", snapshotId: "snap-1" },
		});

		expect(result).toEqual({ success: true });
		expect(mockGetServedRanksForSong).toHaveBeenCalledWith(
			"snap-1",
			"acct-1",
			"song-1",
		);
		expect(mockUpsertMatchDecision).toHaveBeenCalledWith(
			"acct-1",
			"song-1",
			"pl-1",
			"added",
			{ snapshotId: "snap-1", modelRank: 3 },
		);
	});

	it("logs a null snapshot when no snapshotId is supplied", async () => {
		mockOwnership();

		await addSongToPlaylist({ data: { songId: "song-1", playlistId: "pl-1" } });

		// No correlation id → no served-ranks lookup, decision logged unlinked.
		expect(mockGetServedRanksForSong).not.toHaveBeenCalled();
		expect(mockUpsertMatchDecision).toHaveBeenCalledWith(
			"acct-1",
			"song-1",
			"pl-1",
			"added",
			{ snapshotId: null, modelRank: null },
		);
	});

	it("degrades to a null snapshot when the snapshot is not owned by the account", async () => {
		mockOwnership();
		// getServedRanksForSong resolves null for a missing/foreign snapshot.
		mockGetServedRanksForSong.mockResolvedValue(Result.ok(null));

		const result = await addSongToPlaylist({
			data: {
				songId: "song-1",
				playlistId: "pl-1",
				snapshotId: "snap-foreign",
			},
		});

		// A stale/forged snapshot id is dropped (FK-safe), never blocks the add.
		expect(result).toEqual({ success: true });
		expect(mockUpsertMatchDecision).toHaveBeenCalledWith(
			"acct-1",
			"song-1",
			"pl-1",
			"added",
			{ snapshotId: null, modelRank: null },
		);
	});

	it("logs a null model_rank when the song was surfaced but not for this playlist", async () => {
		mockOwnership({ ownedPlaylistIds: ["pl-2"] });
		// The song is in the snapshot, but only for pl-9 — pl-2 was never top-K.
		mockGetServedRanksForSong.mockResolvedValue(
			Result.ok([{ playlist_id: "pl-9", rank: 1 }]),
		);

		await addSongToPlaylist({
			data: { songId: "song-1", playlistId: "pl-2", snapshotId: "snap-1" },
		});

		expect(mockUpsertMatchDecision).toHaveBeenCalledWith(
			"acct-1",
			"song-1",
			"pl-2",
			"added",
			{ snapshotId: "snap-1", modelRank: null },
		);
	});
});
