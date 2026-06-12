import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	addSongToPlaylist,
	dismissSong,
	getMatchingSession,
	getOrderedUndecidedSongIds,
	getSongMatches,
	getSongSuggestions,
} from "../matching.functions";

const {
	mockAuthContext,
	mockGetLatestMatchSnapshot,
	mockGetMatchResults,
	mockGetMatchResultDetailsForSong,
	mockGetMatchResultsForSong,
	mockGetServedRanksForSong,
	mockGetMatchDecisionsForSongs,
	mockGetNewItemIds,
	mockUpsertMatchDecision,
	mockUpsertMatchDecisions,
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
		mockGetMatchResultDetailsForSong: vi.fn(),
		mockGetMatchResultsForSong: vi.fn(),
		mockGetServedRanksForSong: vi.fn(),
		mockGetMatchDecisionsForSongs: vi.fn(),
		mockGetNewItemIds: vi.fn(),
		mockUpsertMatchDecision: vi.fn(),
		mockUpsertMatchDecisions: vi.fn(),
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
	getMatchResultDetailsForSong: (...args: unknown[]) =>
		mockGetMatchResultDetailsForSong(...args),
	getMatchResultsForSong: (...args: unknown[]) =>
		mockGetMatchResultsForSong(...args),
	getServedRanksForSong: (...args: unknown[]) =>
		mockGetServedRanksForSong(...args),
}));

vi.mock("@/lib/domains/taste/song-matching/decision-queries", () => ({
	getMatchDecisionsForSongs: (...args: unknown[]) =>
		mockGetMatchDecisionsForSongs(...args),
	upsertMatchDecision: (...args: unknown[]) => mockUpsertMatchDecision(...args),
	upsertMatchDecisions: (...args: unknown[]) =>
		mockUpsertMatchDecisions(...args),
}));

vi.mock("@/lib/domains/library/liked-songs/status-queries", () => ({
	getNewItemIds: (...args: unknown[]) => mockGetNewItemIds(...args),
}));

describe("getMatchingSession (billing-aware)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// The session now carries the ordered ids (via getOrderedUndecidedSongIds),
		// which fetches newness — default it so each test only sets what it asserts.
		mockGetNewItemIds.mockResolvedValue(Result.ok([]));
	});

	it("returns only entitled songs in songIds (ordered) with matching totalSongs", async () => {
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockGetMatchResults.mockResolvedValue(
			Result.ok([
				{ song_id: "song-1", playlist_id: "pl-1", score: 90 },
				{ song_id: "song-2", playlist_id: "pl-1", score: 80 },
				{ song_id: "song-3", playlist_id: "pl-1", score: 70 },
			]),
		);
		mockGetMatchDecisionsForSongs.mockResolvedValue(Result.ok([]));

		mockRpc.mockResolvedValue({
			data: [{ song_id: "song-1" }, { song_id: "song-3" }],
			error: null,
		});

		const result = await getMatchingSession();

		// song-2 filtered out (not entitled); song-1 (score 90) before song-3 (70).
		expect(result).toEqual({
			snapshotId: "snap-1",
			songIds: ["song-1", "song-3"],
			totalSongs: 2,
		});
		expect(mockRpc).toHaveBeenCalledWith(
			"select_entitled_data_enriched_liked_song_ids",
			{ p_account_id: "acct-1" },
		);
	});

	it("excludes revoked songs from songIds/count", async () => {
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockGetMatchResults.mockResolvedValue(
			Result.ok([
				{ song_id: "song-1", playlist_id: "pl-1", score: 90 },
				{ song_id: "song-2", playlist_id: "pl-1", score: 80 },
			]),
		);
		mockGetMatchDecisionsForSongs.mockResolvedValue(Result.ok([]));

		// No songs entitled
		mockRpc.mockResolvedValue({ data: [], error: null });

		const result = await getMatchingSession();

		expect(result).toEqual({
			snapshotId: "snap-1",
			songIds: [],
			totalSongs: 0,
		});
	});

	it("defaults to empty entitled set on RPC error", async () => {
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockGetMatchResults.mockResolvedValue(
			Result.ok([{ song_id: "song-1", playlist_id: "pl-1", score: 90 }]),
		);
		mockGetMatchDecisionsForSongs.mockResolvedValue(Result.ok([]));

		mockRpc.mockResolvedValue({
			data: null,
			error: { code: "500", message: "rpc error" },
		});

		const result = await getMatchingSession();

		expect(result).toEqual({
			snapshotId: "snap-1",
			songIds: [],
			totalSongs: 0,
		});
	});

	it("returns null when no snapshot exists", async () => {
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok(null));

		const result = await getMatchingSession();

		expect(result).toBeNull();
	});

	it("scopes decision lookup to songs in the snapshot", async () => {
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockGetMatchResults.mockResolvedValue(
			Result.ok([
				{ song_id: "song-1", playlist_id: "pl-1", score: 90 },
				{ song_id: "song-2", playlist_id: "pl-2", score: 80 },
				{ song_id: "song-1", playlist_id: "pl-3", score: 70 },
			]),
		);
		mockGetMatchDecisionsForSongs.mockResolvedValue(Result.ok([]));
		mockRpc.mockResolvedValue({
			data: [{ song_id: "song-1" }, { song_id: "song-2" }],
			error: null,
		});

		await getMatchingSession();

		expect(mockGetMatchDecisionsForSongs).toHaveBeenCalledWith("acct-1", [
			"song-1",
			"song-2",
		]);
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
		mockGetMatchDecisionsForSongs.mockResolvedValue(Result.ok([]));

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
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
	});

	// `songId` is now client-supplied, so the handler fetches details for that one
	// song (factors/rank + decisions) instead of indexing a positional offset.
	function setupSongFetch(
		songId: string,
		opts: {
			detailRows?: Array<{
				playlist_id: string;
				score: number;
				rank: number | null;
				factors: unknown;
			}>;
			decisions?: Array<{ song_id: string; playlist_id: string }>;
		} = {},
	) {
		mockGetMatchResultDetailsForSong.mockResolvedValue(
			Result.ok(
				opts.detailRows ?? [
					{ playlist_id: "pl-1", score: 90, rank: 1, factors: {} },
				],
			),
		);
		mockGetMatchDecisionsForSongs.mockResolvedValue(
			Result.ok(opts.decisions ?? []),
		);

		const eqSingle = vi.fn().mockResolvedValue({
			data: {
				id: songId,
				spotify_id: "sp-song-1",
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
					match_intent: "intent",
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

	it("returns null when snapshot does not belong to the account", async () => {
		mockGetLatestMatchSnapshot.mockResolvedValue(
			Result.ok({ id: "snap-other" }),
		);

		const result = await getSongMatches({
			data: { snapshotId: "snap-1", songId: "song-1" },
		});

		expect(result).toBeNull();
		// Bails before any per-song fetch or entitlement check.
		expect(mockGetMatchResultDetailsForSong).not.toHaveBeenCalled();
		expect(mockRpc).not.toHaveBeenCalled();
	});

	it("returns null for a song the account is not entitled to", async () => {
		// Owns the snapshot, but the per-song entitlement gate fails.
		mockRpc.mockResolvedValue({ data: false, error: null });

		const result = await getSongMatches({
			data: { snapshotId: "snap-1", songId: "song-1" },
		});

		expect(result).toBeNull();
		expect(mockRpc).toHaveBeenCalledWith("is_account_song_entitled", {
			p_account_id: "acct-1",
			p_song_id: "song-1",
		});
		expect(mockGetMatchResultDetailsForSong).not.toHaveBeenCalled();
	});

	it("returns null when the entitlement RPC errors", async () => {
		mockRpc.mockResolvedValue({
			data: null,
			error: { code: "500", message: "rpc error" },
		});

		const result = await getSongMatches({
			data: { snapshotId: "snap-1", songId: "song-1" },
		});

		expect(result).toBeNull();
	});

	it("returns the song with empty matches when every pair is already decided", async () => {
		// Previous can revisit a song whose only pair is decided — it must return
		// the song with matches: [], never null (which would blank the page).
		mockRpc.mockResolvedValue({ data: true, error: null });
		setupSongFetch("song-1", {
			detailRows: [{ playlist_id: "pl-1", score: 90, rank: 1, factors: {} }],
			decisions: [{ song_id: "song-1", playlist_id: "pl-1" }],
		});

		const result = await getSongMatches({
			data: { snapshotId: "snap-1", songId: "song-1" },
		});

		expect(result).not.toBeNull();
		expect(result?.song.id).toBe("song-1");
		expect(result?.matches).toEqual([]);
	});

	it("returns matches for an entitled song", async () => {
		mockRpc.mockResolvedValue({ data: true, error: null });
		setupSongFetch("song-1");

		const result = await getSongMatches({
			data: { snapshotId: "snap-1", songId: "song-1" },
		});

		expect(result).not.toBeNull();
		expect(result?.song.id).toBe("song-1");
		expect(result?.matches).toHaveLength(1);
		expect(result?.matches[0].playlist.id).toBe("pl-1");
		// match_intent is mapped onto the response's `description` field.
		expect(result?.matches[0].playlist.description).toBe("intent");
	});

	it("returns analysis for entitled songs", async () => {
		mockRpc.mockResolvedValue({ data: true, error: null });
		setupSongFetch("song-1");

		const result = await getSongMatches({
			data: { snapshotId: "snap-1", songId: "song-1" },
		});

		expect(result).not.toBeNull();
		expect(result?.song.analysis).toEqual({ headline: "Great song" });
	});
});

describe("getOrderedUndecidedSongIds", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("orders by isNew desc, then maxScore desc, then songId asc — and filters to entitled", async () => {
		mockGetMatchResults.mockResolvedValue(
			Result.ok([
				{ song_id: "song-z", playlist_id: "pl-1", score: 90 },
				{ song_id: "song-a", playlist_id: "pl-1", score: 90 },
				{ song_id: "song-m", playlist_id: "pl-1", score: 90 },
				{ song_id: "song-low", playlist_id: "pl-1", score: 10 },
				{ song_id: "song-locked", playlist_id: "pl-1", score: 99 },
			]),
		);
		mockGetMatchDecisionsForSongs.mockResolvedValue(Result.ok([]));
		// song-m is "new" → sorts ahead of equally-scored song-a/song-z.
		mockGetNewItemIds.mockResolvedValue(Result.ok(["song-m"]));
		mockRpc.mockResolvedValue({
			data: [
				{ song_id: "song-z" },
				{ song_id: "song-a" },
				{ song_id: "song-m" },
				{ song_id: "song-low" },
			],
			error: null,
		});

		const ids = await getOrderedUndecidedSongIds("snap-1", "acct-1");

		// song-locked excluded (not entitled); song-m first (new); then the two
		// score-90 songs by songId asc (song-a < song-z); then song-low (score 10).
		expect(ids).toEqual(["song-m", "song-a", "song-z", "song-low"]);
	});

	it("returns empty when the newness lookup fails", async () => {
		mockGetMatchResults.mockResolvedValue(
			Result.ok([{ song_id: "song-a", playlist_id: "pl-1", score: 50 }]),
		);
		mockGetMatchDecisionsForSongs.mockResolvedValue(Result.ok([]));
		mockGetNewItemIds.mockResolvedValue(Result.err(new Error("boom")));
		mockRpc.mockResolvedValue({ data: [{ song_id: "song-a" }], error: null });

		const ids = await getOrderedUndecidedSongIds("snap-1", "acct-1");

		expect(ids).toEqual([]);
	});

	it("excludes songs whose every pair is already decided", async () => {
		mockGetMatchResults.mockResolvedValue(
			Result.ok([
				{ song_id: "song-a", playlist_id: "pl-1", score: 50 },
				{ song_id: "song-b", playlist_id: "pl-1", score: 90 },
			]),
		);
		// song-a's only pair is decided → drops out; song-b stays.
		mockGetMatchDecisionsForSongs.mockResolvedValue(
			Result.ok([{ song_id: "song-a", playlist_id: "pl-1" }]),
		);
		mockGetNewItemIds.mockResolvedValue(Result.ok([]));
		mockRpc.mockResolvedValue({
			data: [{ song_id: "song-a" }, { song_id: "song-b" }],
			error: null,
		});

		const ids = await getOrderedUndecidedSongIds("snap-1", "acct-1");

		expect(ids).toEqual(["song-b"]);
	});
});

describe("match decision ownership checks", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUpsertMatchDecision.mockResolvedValue(Result.ok({ id: "dec-1" }));
		mockUpsertMatchDecisions.mockResolvedValue(Result.ok([{ id: "dec-1" }]));
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

	it("rejects dismissSong when any playlist is not owned by the account", async () => {
		mockFrom.mockImplementation((table: string) => {
			if (table === "liked_song") {
				return {
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								is: vi.fn().mockReturnValue({
									maybeSingle: vi.fn().mockResolvedValue({
										data: { song_id: "song-1" },
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
								data: [{ id: "pl-1" }],
								error: null,
							}),
						}),
					}),
				};
			}
			return { select: vi.fn() };
		});

		const result = await dismissSong({
			data: { songId: "song-1", playlistIds: ["pl-1", "pl-2"] },
		});

		expect(result).toEqual({ success: false });
		expect(mockUpsertMatchDecisions).not.toHaveBeenCalled();
	});
});

describe("match decision served-context logging", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUpsertMatchDecision.mockResolvedValue(Result.ok({ id: "dec-1" }));
		mockUpsertMatchDecisions.mockResolvedValue(Result.ok([{ id: "dec-1" }]));
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

	it("logs snapshot_id and served_rank for a surfaced add", async () => {
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
			{ snapshotId: "snap-1", servedRank: 3 },
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
			{ snapshotId: null, servedRank: null },
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
			{ snapshotId: null, servedRank: null },
		);
	});

	it("logs a null served_rank when the song was surfaced but not for this playlist", async () => {
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
			{ snapshotId: "snap-1", servedRank: null },
		);
	});

	it("dismiss keeps surfaced and implicit negatives distinct in one snapshot", async () => {
		mockOwnership({ ownedPlaylistIds: ["pl-surfaced", "pl-implicit"] });
		// Only pl-surfaced has a match_result row in the snapshot.
		mockGetServedRanksForSong.mockResolvedValue(
			Result.ok([{ playlist_id: "pl-surfaced", rank: 2 }]),
		);

		await dismissSong({
			data: {
				songId: "song-1",
				playlistIds: ["pl-surfaced", "pl-implicit"],
				snapshotId: "snap-1",
			},
		});

		expect(mockUpsertMatchDecisions).toHaveBeenCalledWith([
			{
				accountId: "acct-1",
				songId: "song-1",
				playlistId: "pl-surfaced",
				decision: "dismissed",
				snapshotId: "snap-1",
				servedRank: 2,
			},
			{
				accountId: "acct-1",
				songId: "song-1",
				playlistId: "pl-implicit",
				decision: "dismissed",
				snapshotId: "snap-1",
				servedRank: null,
			},
		]);
	});

	it("dismiss degrades to a null snapshot when the lookup fails", async () => {
		mockOwnership({ ownedPlaylistIds: ["pl-1"] });
		// Ownership and ranks resolve in ONE query now, so a lookup failure means
		// ownership is unverified too — the linkage degrades to null rather than
		// asserting a false "owned but never surfaced" (implicit negative).
		mockGetServedRanksForSong.mockResolvedValue(
			Result.err(new Error("lookup failed")),
		);

		await dismissSong({
			data: { songId: "song-1", playlistIds: ["pl-1"], snapshotId: "snap-1" },
		});

		expect(mockUpsertMatchDecisions).toHaveBeenCalledWith([
			{
				accountId: "acct-1",
				songId: "song-1",
				playlistId: "pl-1",
				decision: "dismissed",
				snapshotId: null,
				servedRank: null,
			},
		]);
	});
});
