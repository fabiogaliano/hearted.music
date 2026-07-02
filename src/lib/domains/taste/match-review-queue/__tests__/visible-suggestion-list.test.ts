/**
 * Unit tests for the visible suggestion list derivation helper (MSR-22).
 */

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/domains/taste/song-matching/queries", () => ({
	getMatchPairsForSong: vi.fn(),
	getMatchPairsForPlaylist: vi.fn(),
	getMatchRankingsForSong: vi.fn(),
	getMatchRankingsForPlaylist: vi.fn(),
}));

vi.mock("@/lib/domains/taste/song-matching/decision-queries", () => ({
	getMatchDecisionsForSongs: vi.fn(),
	getMatchDecisionsForPlaylist: vi.fn(),
}));

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { SongFilterMetadata } from "@/lib/domains/taste/match-filters/predicates";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import type {
	MatchReviewQueueItemDto,
	MatchReviewSubject,
} from "@/lib/domains/taste/match-review-queue/types";
import type {
	MatchPairInput,
	RankingInput,
} from "@/lib/domains/taste/match-review-queue/visible-suggestion-list";
import {
	computeVisibleSuggestionList,
	deriveVisibleSuggestions,
} from "@/lib/domains/taste/match-review-queue/visible-suggestion-list";
import {
	getMatchDecisionsForPlaylist,
	getMatchDecisionsForSongs,
} from "@/lib/domains/taste/song-matching/decision-queries";
import {
	getMatchPairsForPlaylist,
	getMatchPairsForSong,
	getMatchRankingsForPlaylist,
	getMatchRankingsForSong,
} from "@/lib/domains/taste/song-matching/queries";
import { DatabaseError } from "@/lib/shared/errors/database";

const SONG_SUBJECT: MatchReviewSubject = {
	orientation: "song",
	songId: "song-1",
};

const PLAYLIST_SUBJECT: MatchReviewSubject = {
	orientation: "playlist",
	playlistId: "pl-1",
};

function makePair(
	override: Partial<MatchPairInput> & { playlistId?: string; songId?: string },
): MatchPairInput {
	return {
		songId: "song-1",
		playlistId: "pl-x",
		score: 0.8,
		fusedScore: null,
		...override,
	};
}

function makeRanking(
	override: Partial<RankingInput> & { playlistId?: string; songId?: string },
): RankingInput {
	return {
		songId: "song-1",
		playlistId: "pl-x",
		rank: 1,
		orderingScore: 0.9,
		...override,
	};
}

describe("deriveVisibleSuggestions — strictness filtering", () => {
	it("includes pairs at exactly the minScore threshold", () => {
		const pairs = [
			makePair({ playlistId: "pl-1", score: 0.5, fusedScore: null }),
		];
		const result = deriveVisibleSuggestions(
			SONG_SUBJECT,
			pairs,
			[],
			new Set(),
			0.5,
		);
		expect(result).toHaveLength(1);
		expect(result[0].playlistId).toBe("pl-1");
	});

	it("excludes pairs below the minScore threshold", () => {
		const pairs = [
			makePair({ playlistId: "pl-1", score: 0.49, fusedScore: null }),
		];
		const result = deriveVisibleSuggestions(
			SONG_SUBJECT,
			pairs,
			[],
			new Set(),
			0.5,
		);
		expect(result).toHaveLength(0);
	});

	it("uses fused_score when present instead of score for strictness", () => {
		// score is below threshold but fused_score is above — fused wins (E7)
		const pairs = [
			makePair({ playlistId: "pl-1", score: 0.3, fusedScore: 0.7 }),
		];
		const result = deriveVisibleSuggestions(
			SONG_SUBJECT,
			pairs,
			[],
			new Set(),
			0.5,
		);
		expect(result).toHaveLength(1);
	});

	it("filters by fused_score when fused_score is below threshold even if score is above", () => {
		const pairs = [
			makePair({ playlistId: "pl-1", score: 0.8, fusedScore: 0.3 }),
		];
		const result = deriveVisibleSuggestions(
			SONG_SUBJECT,
			pairs,
			[],
			new Set(),
			0.5,
		);
		expect(result).toHaveLength(0);
	});
});

describe("deriveVisibleSuggestions — decided-pair removal", () => {
	it("excludes pairs present in decidedPairKeys", () => {
		const pairs = [
			makePair({ songId: "song-1", playlistId: "pl-decided" }),
			makePair({ songId: "song-1", playlistId: "pl-undecided" }),
		];
		const result = deriveVisibleSuggestions(
			SONG_SUBJECT,
			pairs,
			[],
			new Set(["song-1:pl-decided"]),
			0.0,
		);
		expect(result).toHaveLength(1);
		expect(result[0].playlistId).toBe("pl-undecided");
	});

	it("returns empty when all pairs are decided", () => {
		const pairs = [
			makePair({ songId: "song-1", playlistId: "pl-1" }),
			makePair({ songId: "song-1", playlistId: "pl-2" }),
		];
		const result = deriveVisibleSuggestions(
			SONG_SUBJECT,
			pairs,
			[],
			new Set(["song-1:pl-1", "song-1:pl-2"]),
			0.0,
		);
		expect(result).toHaveLength(0);
	});
});

describe("deriveVisibleSuggestions — ranked pairs ordering", () => {
	it("assigns modelRank from the ranking row", () => {
		const pairs = [makePair({ playlistId: "pl-1", score: 0.8 })];
		const rankings = [makeRanking({ playlistId: "pl-1", rank: 3 })];
		const result = deriveVisibleSuggestions(
			SONG_SUBJECT,
			pairs,
			rankings,
			new Set(),
			0.0,
		);
		expect(result[0].modelRank).toBe(3);
	});

	it("sorts ranked pairs by fitScore descending before modelRank", () => {
		const pairs = [
			makePair({ playlistId: "pl-a", score: 0.6 }),
			makePair({ playlistId: "pl-b", score: 0.9 }),
			makePair({ playlistId: "pl-c", score: 0.7 }),
		];
		const rankings = [
			makeRanking({ playlistId: "pl-a", rank: 2 }),
			makeRanking({ playlistId: "pl-b", rank: 1 }),
			makeRanking({ playlistId: "pl-c", rank: 3 }),
		];
		const result = deriveVisibleSuggestions(
			SONG_SUBJECT,
			pairs,
			rankings,
			new Set(),
			0.0,
		);
		expect(result.map((s) => s.playlistId)).toEqual(["pl-b", "pl-c", "pl-a"]);
	});

	it("uses modelRank as the tiebreaker when ranked pairs share fitScore", () => {
		const pairs = [
			makePair({ playlistId: "pl-a", score: 0.8 }),
			makePair({ playlistId: "pl-b", score: 0.8 }),
		];
		const rankings = [
			makeRanking({ playlistId: "pl-a", rank: 2 }),
			makeRanking({ playlistId: "pl-b", rank: 1 }),
		];
		const result = deriveVisibleSuggestions(
			SONG_SUBJECT,
			pairs,
			rankings,
			new Set(),
			0.0,
		);
		expect(result.map((s) => s.playlistId)).toEqual(["pl-b", "pl-a"]);
		expect(result[0].visibleRank).toBe(1);
		expect(result[1].visibleRank).toBe(2);
	});
});

describe("deriveVisibleSuggestions — unranked pairs fallback ordering", () => {
	it("sorts unranked pairs by fitScore descending", () => {
		const pairs = [
			makePair({ playlistId: "pl-low", score: 0.6 }),
			makePair({ playlistId: "pl-high", score: 0.9 }),
		];
		const result = deriveVisibleSuggestions(
			SONG_SUBJECT,
			pairs,
			[], // no rankings
			new Set(),
			0.0,
		);
		expect(result[0].playlistId).toBe("pl-high");
		expect(result[1].playlistId).toBe("pl-low");
	});

	it("breaks fitScore ties by playlist_id asc in song orientation", () => {
		const pairs = [
			makePair({ playlistId: "pl-z", score: 0.8 }),
			makePair({ playlistId: "pl-a", score: 0.8 }),
		];
		const result = deriveVisibleSuggestions(
			SONG_SUBJECT,
			pairs,
			[],
			new Set(),
			0.0,
		);
		expect(result[0].playlistId).toBe("pl-a");
		expect(result[1].playlistId).toBe("pl-z");
	});

	it("breaks fitScore ties by song_id asc in playlist orientation", () => {
		const pairs: MatchPairInput[] = [
			{ songId: "song-z", playlistId: "pl-1", score: 0.8, fusedScore: null },
			{ songId: "song-a", playlistId: "pl-1", score: 0.8, fusedScore: null },
		];
		const result = deriveVisibleSuggestions(
			PLAYLIST_SUBJECT,
			pairs,
			[],
			new Set(),
			0.0,
		);
		expect(result[0].songId).toBe("song-a");
		expect(result[1].songId).toBe("song-z");
	});

	it("assigns synthetic modelRank starting after max ranked pair rank", () => {
		const pairs = [
			makePair({ playlistId: "pl-ranked", score: 0.9 }),
			makePair({ playlistId: "pl-unranked", score: 0.7 }),
		];
		const rankings = [makeRanking({ playlistId: "pl-ranked", rank: 5 })];
		const result = deriveVisibleSuggestions(
			SONG_SUBJECT,
			pairs,
			rankings,
			new Set(),
			0.0,
		);
		const unranked = result.find((s) => s.playlistId === "pl-unranked");
		// Synthetic rank = maxRankedModelRank (5) + 1 = 6
		expect(unranked?.modelRank).toBe(6);
	});

	it("assigns modelRank starting at 1 when no ranked pairs exist", () => {
		const pairs = [
			makePair({ playlistId: "pl-high", score: 0.9 }),
			makePair({ playlistId: "pl-low", score: 0.5 }),
		];
		const result = deriveVisibleSuggestions(
			SONG_SUBJECT,
			pairs,
			[], // no rankings
			new Set(),
			0.0,
		);
		expect(result[0].modelRank).toBe(1);
		expect(result[1].modelRank).toBe(2);
	});
});

describe("deriveVisibleSuggestions — mixed ranked and unranked pairs", () => {
	it("orders all visible pairs by fitScore, with contiguous visibleRank", () => {
		const pairs = [
			makePair({ playlistId: "pl-ranked-2", score: 0.8 }),
			makePair({ playlistId: "pl-unranked", score: 0.95 }), // high score but no ranking
			makePair({ playlistId: "pl-ranked-1", score: 0.6 }),
		];
		const rankings = [
			makeRanking({ playlistId: "pl-ranked-2", rank: 2 }),
			makeRanking({ playlistId: "pl-ranked-1", rank: 1 }),
		];
		const result = deriveVisibleSuggestions(
			SONG_SUBJECT,
			pairs,
			rankings,
			new Set(),
			0.0,
		);
		expect(result.map((s) => s.playlistId)).toEqual([
			"pl-unranked",
			"pl-ranked-2",
			"pl-ranked-1",
		]);
		// visibleRank is dense 1, 2, 3
		expect(result.map((s) => s.visibleRank)).toEqual([1, 2, 3]);
	});
});

describe("deriveVisibleSuggestions — dense visibleRank after filtering", () => {
	it("visibleRank is dense when pairs are removed by strictness", () => {
		const pairs = [
			makePair({ playlistId: "pl-pass", score: 0.8 }),
			makePair({ playlistId: "pl-fail", score: 0.2 }),
		];
		const result = deriveVisibleSuggestions(
			SONG_SUBJECT,
			pairs,
			[],
			new Set(),
			0.5,
		);
		expect(result).toHaveLength(1);
		expect(result[0].visibleRank).toBe(1);
	});

	it("visibleRank is dense when pairs are removed by decided filter", () => {
		const pairs = [
			makePair({ songId: "song-1", playlistId: "pl-a", score: 0.8 }),
			makePair({ songId: "song-1", playlistId: "pl-b", score: 0.7 }),
			makePair({ songId: "song-1", playlistId: "pl-c", score: 0.6 }),
		];
		const rankings = [
			makeRanking({ songId: "song-1", playlistId: "pl-a", rank: 1 }),
			makeRanking({ songId: "song-1", playlistId: "pl-b", rank: 2 }),
			makeRanking({ songId: "song-1", playlistId: "pl-c", rank: 3 }),
		];
		const decided = new Set(["song-1:pl-b"]);
		const result = deriveVisibleSuggestions(
			SONG_SUBJECT,
			pairs,
			rankings,
			decided,
			0.0,
		);
		expect(result.map((s) => s.playlistId)).toEqual(["pl-a", "pl-c"]);
		// Dense: 1, 2 — not 1, 3
		expect(result.map((s) => s.visibleRank)).toEqual([1, 2]);
	});
});

describe("deriveVisibleSuggestions — orientation correctness", () => {
	it("song orientation: suggestions carry playlist IDs from the subject's song pairs", () => {
		const pairs: MatchPairInput[] = [
			{ songId: "song-1", playlistId: "pl-1", score: 0.8, fusedScore: null },
			{ songId: "song-1", playlistId: "pl-2", score: 0.7, fusedScore: null },
		];
		const result = deriveVisibleSuggestions(
			{ orientation: "song", songId: "song-1" },
			pairs,
			[],
			new Set(),
			0.0,
		);
		expect(result).toHaveLength(2);
		// Each suggestion carries the (song-1, pl-X) pair
		expect(result.map((s) => s.songId)).toEqual(["song-1", "song-1"]);
		expect(result.map((s) => s.playlistId)).toContain("pl-1");
		expect(result.map((s) => s.playlistId)).toContain("pl-2");
	});

	it("playlist orientation: suggestions carry song IDs from the subject's playlist pairs", () => {
		const pairs: MatchPairInput[] = [
			{ songId: "song-a", playlistId: "pl-1", score: 0.8, fusedScore: null },
			{ songId: "song-b", playlistId: "pl-1", score: 0.7, fusedScore: null },
		];
		const result = deriveVisibleSuggestions(
			{ orientation: "playlist", playlistId: "pl-1" },
			pairs,
			[],
			new Set(),
			0.0,
		);
		expect(result).toHaveLength(2);
		expect(result.map((s) => s.playlistId)).toEqual(["pl-1", "pl-1"]);
		expect(result.map((s) => s.songId)).toContain("song-a");
		expect(result.map((s) => s.songId)).toContain("song-b");
	});
});

describe("deriveVisibleSuggestions — determinism", () => {
	it("produces the same order for the same input regardless of input array order", () => {
		const pairsAscending: MatchPairInput[] = [
			{ songId: "song-1", playlistId: "pl-a", score: 0.7, fusedScore: null },
			{ songId: "song-1", playlistId: "pl-b", score: 0.8, fusedScore: null },
			{ songId: "song-1", playlistId: "pl-c", score: 0.6, fusedScore: null },
		];
		const pairsDescending = [...pairsAscending].reverse();

		const subject: MatchReviewSubject = {
			orientation: "song",
			songId: "song-1",
		};
		const r1 = deriveVisibleSuggestions(
			subject,
			pairsAscending,
			[],
			new Set(),
			0.0,
		);
		const r2 = deriveVisibleSuggestions(
			subject,
			pairsDescending,
			[],
			new Set(),
			0.0,
		);

		expect(r1.map((s) => s.playlistId)).toEqual(r2.map((s) => s.playlistId));
	});
});

describe("deriveVisibleSuggestions — edge cases", () => {
	it("returns empty array for empty input", () => {
		const result = deriveVisibleSuggestions(
			SONG_SUBJECT,
			[],
			[],
			new Set(),
			0.5,
		);
		expect(result).toHaveLength(0);
	});

	it("ignores ranking rows for pairs that are filtered out by strictness", () => {
		const pairs = [makePair({ playlistId: "pl-filtered", score: 0.1 })];
		const rankings = [makeRanking({ playlistId: "pl-filtered", rank: 1 })];
		const result = deriveVisibleSuggestions(
			SONG_SUBJECT,
			pairs,
			rankings,
			new Set(),
			0.5,
		);
		expect(result).toHaveLength(0);
	});

	it("ignores ranking rows for pairs that are decided", () => {
		const pairs = [
			makePair({ songId: "song-1", playlistId: "pl-1", score: 0.9 }),
		];
		const rankings = [
			makeRanking({ songId: "song-1", playlistId: "pl-1", rank: 1 }),
		];
		const decided = new Set(["song-1:pl-1"]);
		const result = deriveVisibleSuggestions(
			SONG_SUBJECT,
			pairs,
			rankings,
			decided,
			0.0,
		);
		expect(result).toHaveLength(0);
	});

	it("handles ranking rows for pairs not present in pairs input (extra rows)", () => {
		const pairs = [makePair({ playlistId: "pl-1", score: 0.8 })];
		const rankings = [
			makeRanking({ playlistId: "pl-1", rank: 1 }),
			// Extra ranking row that has no matching pair — should be ignored
			makeRanking({ playlistId: "pl-ghost", rank: 2 }),
		];
		const result = deriveVisibleSuggestions(
			SONG_SUBJECT,
			pairs,
			rankings,
			new Set(),
			0.0,
		);
		expect(result).toHaveLength(1);
		expect(result[0].playlistId).toBe("pl-1");
	});
});

describe("deriveVisibleSuggestions — fitScore correctness", () => {
	it("fitScore is fused_score when fused_score is present", () => {
		const pairs = [
			makePair({ playlistId: "pl-1", score: 0.5, fusedScore: 0.85 }),
		];
		const result = deriveVisibleSuggestions(
			SONG_SUBJECT,
			pairs,
			[],
			new Set(),
			0.0,
		);
		expect(result[0].fitScore).toBe(0.85);
	});

	it("fitScore falls back to score when fused_score is null", () => {
		const pairs = [
			makePair({ playlistId: "pl-1", score: 0.72, fusedScore: null }),
		];
		const result = deriveVisibleSuggestions(
			SONG_SUBJECT,
			pairs,
			[],
			new Set(),
			0.0,
		);
		expect(result[0].fitScore).toBe(0.72);
	});
});

const DRIVER_ACCOUNT_ID = "acct-driver";
const DRIVER_SNAPSHOT_ID = "snap-driver";

function makeSongItem(
	overrides?: Partial<MatchReviewQueueItemDto>,
): MatchReviewQueueItemDto {
	return {
		id: "item-d1",
		sessionId: "sess-d1",
		accountId: DRIVER_ACCOUNT_ID,
		subject: { orientation: "song", songId: "song-d1" },
		sourceSnapshotId: DRIVER_SNAPSHOT_ID,
		position: 0,
		state: "active",
		resolution: null,
		sourceScore: 0.8,
		wasNewAtEnqueue: false,
		presentedAt: null,
		resolvedAt: null,
		visiblePairsCapturedAt: null,
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

function makePlaylistItem(): MatchReviewQueueItemDto {
	return makeSongItem({
		subject: { orientation: "playlist", playlistId: "pl-d1" },
	});
}

/**
 * Builds a chain where `.maybeSingle()` is the terminal — all other methods
 * return the chain itself. Used for queries like
 * `supabase.from("X").select(...).eq(...).maybeSingle()`.
 */
function makeMaybeChain(
	result: { data: unknown; error: null } = { data: null, error: null },
) {
	const chain = {
		select: vi.fn(),
		eq: vi.fn(),
		in: vi.fn(),
		is: vi.fn(),
		order: vi.fn(),
		limit: vi.fn(),
		maybeSingle: vi.fn().mockResolvedValue(result),
	};
	chain.select.mockReturnValue(chain);
	chain.eq.mockReturnValue(chain);
	chain.in.mockReturnValue(chain);
	chain.is.mockReturnValue(chain);
	chain.order.mockReturnValue(chain);
	chain.limit.mockReturnValue(chain);
	return chain;
}

/**
 * Builds a chain where `.in()` is the terminal (returns a resolved Promise).
 * Used for queries like `supabase.from("X").select(...).in("id", ids)`.
 */
function makeInTerminalChain(
	result: { data: unknown; error: null } = { data: [], error: null },
) {
	const chain = {
		select: vi.fn(),
		eq: vi.fn(),
		in: vi.fn().mockResolvedValue(result),
		is: vi.fn(),
		order: vi.fn(),
		limit: vi.fn(),
		maybeSingle: vi.fn().mockResolvedValue(result),
	};
	chain.select.mockReturnValue(chain);
	chain.eq.mockReturnValue(chain);
	chain.is.mockReturnValue(chain);
	chain.order.mockReturnValue(chain);
	chain.limit.mockReturnValue(chain);
	return chain;
}

/**
 * Builds a chain where `.is()` is the terminal (returns a resolved Promise).
 * Used for queries like `supabase.from("liked_song").select(...).in(...).eq(...).is(...)`.
 */
function makeIsTerminalChain(
	result: { data: unknown; error: null } = { data: [], error: null },
) {
	const chain = {
		select: vi.fn(),
		eq: vi.fn(),
		in: vi.fn(),
		is: vi.fn().mockResolvedValue(result),
		order: vi.fn(),
		limit: vi.fn(),
		maybeSingle: vi.fn().mockResolvedValue(result),
	};
	chain.select.mockReturnValue(chain);
	chain.eq.mockReturnValue(chain);
	chain.in.mockReturnValue(chain);
	chain.order.mockReturnValue(chain);
	chain.limit.mockReturnValue(chain);
	return chain;
}

describe("computeVisibleSuggestionList — async driver", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Default: everything returns empty/null data. Individual tests override.
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi
				.fn()
				.mockReturnValue(makeMaybeChain({ data: null, error: null })),
			rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);
	});

	it("returns not-entitled/song-not-entitled when song entitlement RPC returns false", async () => {
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi
				.fn()
				.mockReturnValue(makeMaybeChain({ data: null, error: null })),
			rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		const result = await computeVisibleSuggestionList(makeSongItem(), 0.5);

		expect(result).toEqual({
			kind: "not-entitled",
			reason: "song-not-entitled",
		});
	});

	it("returns not-entitled/playlist-not-owned when playlist row is missing", async () => {
		// Ownership check returns null (not found); new DB calls are never reached.
		const from = vi
			.fn()
			.mockReturnValue(makeMaybeChain({ data: null, error: null }));

		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from,
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		const result = await computeVisibleSuggestionList(makePlaylistItem(), 0.5);

		expect(result).toEqual({
			kind: "not-entitled",
			reason: "playlist-not-owned",
		});
	});

	it("returns db-error when a query fails after entitlement passes", async () => {
		// Song entitlement passes via rpc; fetchSongFilterMeta runs in parallel with
		// pairs but returns null data (no error). pairsResult fails → db-error.
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
			from: vi
				.fn()
				.mockReturnValue(makeMaybeChain({ data: null, error: null })),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		const dbError = new DatabaseError({ code: "PGRST301", message: "timeout" });
		vi.mocked(getMatchPairsForSong).mockResolvedValue(Result.err(dbError));
		vi.mocked(getMatchRankingsForSong).mockResolvedValue(
			Result.ok<never[], never>([]),
		);
		vi.mocked(getMatchDecisionsForSongs).mockResolvedValue(
			Result.ok<never[], never>([]),
		);

		const result = await computeVisibleSuggestionList(makeSongItem(), 0.5);

		expect(result.kind).toBe("db-error");
		if (result.kind === "db-error") {
			expect(result.error).toBeInstanceOf(DatabaseError);
		}
	});

	it("returns ok with dense visibleRank and correct orientation for song subject", async () => {
		// Song entitlement via rpc; from is used by fetchSongFilterMeta (×2:
		// song + liked_song via maybySingle), then fetchPlaylistsMatchFilters (.in
		// terminal), then fetchOwnedPlaylistIds (.in terminal). Ownership returns
		// both suggestion playlists so neither is filtered out.
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
			from: vi
				.fn()
				.mockReturnValueOnce(makeMaybeChain({ data: null, error: null }))
				.mockReturnValueOnce(makeMaybeChain({ data: null, error: null }))
				.mockReturnValueOnce(makeInTerminalChain({ data: [], error: null }))
				.mockReturnValue(
					makeInTerminalChain({
						data: [{ id: "pl-a" }, { id: "pl-b" }],
						error: null,
					}),
				),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		vi.mocked(getMatchPairsForSong).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-d1",
					playlist_id: "pl-a",
					score: 0.9,
					fused_score: null,
				},
				{
					song_id: "song-d1",
					playlist_id: "pl-b",
					score: 0.7,
					fused_score: null,
				},
			]),
		);
		vi.mocked(getMatchRankingsForSong).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-d1",
					playlist_id: "pl-a",
					rank: 1,
					ordering_score: 0.9,
				},
				{
					song_id: "song-d1",
					playlist_id: "pl-b",
					rank: 2,
					ordering_score: 0.7,
				},
			]),
		);
		vi.mocked(getMatchDecisionsForSongs).mockResolvedValue(
			Result.ok<never[], never>([]),
		);

		const result = await computeVisibleSuggestionList(makeSongItem(), 0.0);

		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.list.orientation).toBe("song");
			expect(result.list.suggestions).toHaveLength(2);
			// Ranked by modelRank asc: pl-a (rank 1) then pl-b (rank 2)
			expect(result.list.suggestions[0].playlistId).toBe("pl-a");
			expect(result.list.suggestions[0].visibleRank).toBe(1);
			expect(result.list.suggestions[1].visibleRank).toBe(2);
		}
	});

	it("returns ok with dense visibleRank and correct orientation for playlist subject", async () => {
		// Call order for from:
		// 1. checkPlaylistOwned: from("playlist").select.eq.eq.maybySingle → {data: {id}}
		// 2. fetchPlaylistsMatchFilters: from("playlist").select.in → {data: []}
		// 3. fetchSongsFilterMeta song: from("song").select.in → {data: []}
		// 4. fetchSongsFilterMeta liked: from("liked_song").select.in.eq.is → {data: []}
		const from = vi
			.fn()
			.mockReturnValueOnce(
				makeMaybeChain({ data: { id: "pl-d1" }, error: null }),
			)
			.mockReturnValueOnce(makeInTerminalChain({ data: [], error: null }))
			.mockReturnValueOnce(makeInTerminalChain({ data: [], error: null }))
			.mockReturnValue(makeIsTerminalChain({ data: [], error: null }));

		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from,
			// Suggestion-song entitlement (fetchEntitledSongIds): both songs entitled.
			rpc: vi.fn().mockResolvedValue({
				data: [{ song_id: "song-x" }, { song_id: "song-y" }],
				error: null,
			}),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		vi.mocked(getMatchPairsForPlaylist).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-x",
					playlist_id: "pl-d1",
					score: 0.85,
					fused_score: null,
				},
				{
					song_id: "song-y",
					playlist_id: "pl-d1",
					score: 0.65,
					fused_score: null,
				},
			]),
		);
		vi.mocked(getMatchRankingsForPlaylist).mockResolvedValue(
			Result.ok<never[], never>([]),
		);
		vi.mocked(getMatchDecisionsForPlaylist).mockResolvedValue(
			Result.ok<never[], never>([]),
		);

		const result = await computeVisibleSuggestionList(makePlaylistItem(), 0.0);

		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.list.orientation).toBe("playlist");
			expect(result.list.suggestions).toHaveLength(2);
			// No rankings → sorted by fitScore desc: song-x (0.85) then song-y (0.65)
			expect(result.list.suggestions[0].songId).toBe("song-x");
			expect(result.list.suggestions[0].visibleRank).toBe(1);
			expect(result.list.suggestions[1].visibleRank).toBe(2);
		}
	});

	it("playlist orientation: song absent from DB metadata is hidden when an active filter is set", async () => {
		// The song row is absent from the song table (fetchSongsFilterMeta returns
		// an empty map). The driver substitutes an all-null SongFilterMetadata struct
		// so passesAllMatchFilters runs and fails the language filter — matching the
		// write-time behavior where absent metadata fails active filters.
		const from = vi
			.fn()
			.mockReturnValueOnce(
				makeMaybeChain({ data: { id: "pl-d1" }, error: null }),
			)
			// fetchPlaylistsMatchFilters: playlist has a language filter
			.mockReturnValueOnce(
				makeInTerminalChain({
					data: [
						{
							id: "pl-d1",
							match_filters: { version: 1, languages: { codes: ["en"] } },
						},
					],
					error: null,
				}),
			)
			// fetchSongsFilterMeta song query: song absent → empty result
			.mockReturnValueOnce(makeInTerminalChain({ data: [], error: null }))
			// fetchSongsFilterMeta liked_song query
			.mockReturnValue(makeIsTerminalChain({ data: [], error: null }));

		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from,
			// song-absent is entitled, so it reaches the language filter (the point of
			// this test) rather than being dropped by the entitlement guard first.
			rpc: vi.fn().mockResolvedValue({
				data: [{ song_id: "song-absent" }],
				error: null,
			}),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		vi.mocked(getMatchPairsForPlaylist).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-absent",
					playlist_id: "pl-d1",
					score: 0.9,
					fused_score: null,
				},
			]),
		);
		vi.mocked(getMatchRankingsForPlaylist).mockResolvedValue(
			Result.ok<never[], never>([]),
		);
		vi.mocked(getMatchDecisionsForPlaylist).mockResolvedValue(
			Result.ok<never[], never>([]),
		);

		const result = await computeVisibleSuggestionList(makePlaylistItem(), 0.0);

		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			// Absent song gets all-null metadata → language filter fails → hidden
			expect(result.list.suggestions).toHaveLength(0);
		}
	});

	it("song mode: excludes a foreign/deleted suggestion playlist before capture (Finding 3)", async () => {
		// pl-a is owned; pl-b is not (deleted/transferred). Only pl-a survives, and
		// the surviving suggestion keeps a dense visibleRank.
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
			from: vi
				.fn()
				.mockReturnValueOnce(makeMaybeChain({ data: null, error: null }))
				.mockReturnValueOnce(makeMaybeChain({ data: null, error: null }))
				.mockReturnValueOnce(makeInTerminalChain({ data: [], error: null }))
				.mockReturnValue(
					makeInTerminalChain({ data: [{ id: "pl-a" }], error: null }),
				),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		vi.mocked(getMatchPairsForSong).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-d1",
					playlist_id: "pl-a",
					score: 0.9,
					fused_score: null,
				},
				{
					song_id: "song-d1",
					playlist_id: "pl-b",
					score: 0.7,
					fused_score: null,
				},
			]),
		);
		vi.mocked(getMatchRankingsForSong).mockResolvedValue(
			Result.ok<never[], never>([]),
		);
		vi.mocked(getMatchDecisionsForSongs).mockResolvedValue(
			Result.ok<never[], never>([]),
		);

		const result = await computeVisibleSuggestionList(makeSongItem(), 0.0);

		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.list.suggestions).toHaveLength(1);
			expect(result.list.suggestions[0].playlistId).toBe("pl-a");
			expect(result.list.suggestions[0].visibleRank).toBe(1);
		}
	});

	it("playlist mode: excludes a non-entitled suggestion song before capture (Finding 3)", async () => {
		// song-x is entitled, song-y is not. Only song-x survives with a dense rank.
		const from = vi
			.fn()
			.mockReturnValueOnce(
				makeMaybeChain({ data: { id: "pl-d1" }, error: null }),
			)
			.mockReturnValueOnce(makeInTerminalChain({ data: [], error: null }))
			.mockReturnValueOnce(makeInTerminalChain({ data: [], error: null }))
			.mockReturnValue(makeIsTerminalChain({ data: [], error: null }));

		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from,
			rpc: vi.fn().mockResolvedValue({
				data: [{ song_id: "song-x" }],
				error: null,
			}),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		vi.mocked(getMatchPairsForPlaylist).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-x",
					playlist_id: "pl-d1",
					score: 0.85,
					fused_score: null,
				},
				{
					song_id: "song-y",
					playlist_id: "pl-d1",
					score: 0.65,
					fused_score: null,
				},
			]),
		);
		vi.mocked(getMatchRankingsForPlaylist).mockResolvedValue(
			Result.ok<never[], never>([]),
		);
		vi.mocked(getMatchDecisionsForPlaylist).mockResolvedValue(
			Result.ok<never[], never>([]),
		);

		const result = await computeVisibleSuggestionList(makePlaylistItem(), 0.0);

		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.list.suggestions).toHaveLength(1);
			expect(result.list.suggestions[0].songId).toBe("song-x");
			expect(result.list.suggestions[0].visibleRank).toBe(1);
		}
	});

	it("song mode: a suggestion-playlist ownership query failure yields db-error (Finding 3)", async () => {
		// The ownership query fails — surface as db-error so the card is retryable
		// rather than rendering an empty/unavailable suggestion set.
		const ownershipError = {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			in: vi.fn().mockResolvedValue({
				data: null,
				error: { code: "PGRST500", message: "ownership query failed" },
			}),
		};
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
			from: vi
				.fn()
				.mockReturnValueOnce(makeMaybeChain({ data: null, error: null }))
				.mockReturnValueOnce(makeMaybeChain({ data: null, error: null }))
				.mockReturnValueOnce(makeInTerminalChain({ data: [], error: null }))
				.mockReturnValue(ownershipError),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		vi.mocked(getMatchPairsForSong).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-d1",
					playlist_id: "pl-a",
					score: 0.9,
					fused_score: null,
				},
			]),
		);
		vi.mocked(getMatchRankingsForSong).mockResolvedValue(
			Result.ok<never[], never>([]),
		);
		vi.mocked(getMatchDecisionsForSongs).mockResolvedValue(
			Result.ok<never[], never>([]),
		);

		const result = await computeVisibleSuggestionList(makeSongItem(), 0.0);

		expect(result.kind).toBe("db-error");
	});

	it("playlist mode: a suggestion-song entitlement failure yields db-error (Finding 3)", async () => {
		const from = vi
			.fn()
			.mockReturnValueOnce(
				makeMaybeChain({ data: { id: "pl-d1" }, error: null }),
			)
			.mockReturnValueOnce(makeInTerminalChain({ data: [], error: null }))
			.mockReturnValueOnce(makeInTerminalChain({ data: [], error: null }))
			.mockReturnValue(makeIsTerminalChain({ data: [], error: null }));

		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from,
			// Entitlement RPC fails — surface as db-error (retryable).
			rpc: vi.fn().mockResolvedValue({
				data: null,
				error: { code: "PGRST500", message: "entitlement rpc failed" },
			}),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		vi.mocked(getMatchPairsForPlaylist).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-x",
					playlist_id: "pl-d1",
					score: 0.85,
					fused_score: null,
				},
			]),
		);
		vi.mocked(getMatchRankingsForPlaylist).mockResolvedValue(
			Result.ok<never[], never>([]),
		);
		vi.mocked(getMatchDecisionsForPlaylist).mockResolvedValue(
			Result.ok<never[], never>([]),
		);

		const result = await computeVisibleSuggestionList(makePlaylistItem(), 0.0);

		expect(result.kind).toBe("db-error");
	});
});

// ============================================================================
// deriveVisibleSuggestions — read-time filter predicates (MSR-36)
// ============================================================================

describe("deriveVisibleSuggestions — read-time filter predicates", () => {
	const songSubject: MatchReviewSubject = {
		orientation: "song",
		songId: "song-1",
	};

	function makePairWithMeta(
		playlistId: string,
		meta: SongFilterMetadata,
		filters: PlaylistMatchFiltersV1,
	): MatchPairInput {
		return {
			songId: "song-1",
			playlistId,
			score: 0.8,
			fusedScore: null,
			songMeta: meta,
			playlistFilters: filters,
		};
	}

	const NOW_MS = new Date("2024-06-01T00:00:00Z").getTime();
	const DEFAULT_META: SongFilterMetadata = {
		language: "en",
		languageSecondary: null,
		releaseYear: 2020,
		vocalGender: "female",
		likedAt: new Date("2023-01-15T00:00:00Z").getTime(),
	};

	it("passes pairs whose song meets all active filters", () => {
		const pair = makePairWithMeta("pl-1", DEFAULT_META, {
			version: 1,
			languages: { codes: ["en"] },
			vocalGender: "female",
		});
		const result = deriveVisibleSuggestions(
			songSubject,
			[pair],
			[],
			new Set(),
			0.0,
			NOW_MS,
		);
		expect(result).toHaveLength(1);
	});

	it("AND across types: fails if any filter fails", () => {
		const pair = makePairWithMeta(
			"pl-1",
			{ ...DEFAULT_META, vocalGender: "male" },
			{ version: 1, languages: { codes: ["en"] }, vocalGender: "female" },
		);
		const result = deriveVisibleSuggestions(
			songSubject,
			[pair],
			[],
			new Set(),
			0.0,
			NOW_MS,
		);
		expect(result).toHaveLength(0);
	});

	it("OR within languages: passes if secondary language matches", () => {
		const pair = makePairWithMeta(
			"pl-1",
			{ ...DEFAULT_META, language: "fr", languageSecondary: "en" },
			{ version: 1, languages: { codes: ["en"] } },
		);
		const result = deriveVisibleSuggestions(
			songSubject,
			[pair],
			[],
			new Set(),
			0.0,
			NOW_MS,
		);
		expect(result).toHaveLength(1);
	});

	it("OR within languages: fails if neither primary nor secondary matches", () => {
		const pair = makePairWithMeta(
			"pl-1",
			{ ...DEFAULT_META, language: "fr", languageSecondary: "de" },
			{ version: 1, languages: { codes: ["en"] } },
		);
		const result = deriveVisibleSuggestions(
			songSubject,
			[pair],
			[],
			new Set(),
			0.0,
			NOW_MS,
		);
		expect(result).toHaveLength(0);
	});

	it("missing language metadata fails language filter", () => {
		const pair = makePairWithMeta(
			"pl-1",
			{ ...DEFAULT_META, language: null, languageSecondary: null },
			{ version: 1, languages: { codes: ["en"] } },
		);
		const result = deriveVisibleSuggestions(
			songSubject,
			[pair],
			[],
			new Set(),
			0.0,
			NOW_MS,
		);
		expect(result).toHaveLength(0);
	});

	it("missing vocalGender metadata fails vocalGender filter", () => {
		const pair = makePairWithMeta(
			"pl-1",
			{ ...DEFAULT_META, vocalGender: null },
			{ version: 1, vocalGender: "female" },
		);
		const result = deriveVisibleSuggestions(
			songSubject,
			[pair],
			[],
			new Set(),
			0.0,
			NOW_MS,
		);
		expect(result).toHaveLength(0);
	});

	it("missing releaseYear metadata fails releaseYear filter", () => {
		const pair = makePairWithMeta(
			"pl-1",
			{ ...DEFAULT_META, releaseYear: null },
			{ version: 1, releaseYear: { kind: "after", start: 2000 } },
		);
		const result = deriveVisibleSuggestions(
			songSubject,
			[pair],
			[],
			new Set(),
			0.0,
			NOW_MS,
		);
		expect(result).toHaveLength(0);
	});

	it("liked-at before boundary: fails when likedAt is after endDate", () => {
		const pair = makePairWithMeta(
			"pl-1",
			{ ...DEFAULT_META, likedAt: new Date("2023-01-15T00:00:00Z").getTime() },
			{ version: 1, likedAt: { kind: "before", endDate: "2022-12-31" } },
		);
		const result = deriveVisibleSuggestions(
			songSubject,
			[pair],
			[],
			new Set(),
			0.0,
			NOW_MS,
		);
		expect(result).toHaveLength(0);
	});

	it("liked-at before boundary: passes when likedAt is before endDate", () => {
		const pair = makePairWithMeta(
			"pl-1",
			{ ...DEFAULT_META, likedAt: new Date("2023-01-15T00:00:00Z").getTime() },
			{ version: 1, likedAt: { kind: "before", endDate: "2024-01-01" } },
		);
		const result = deriveVisibleSuggestions(
			songSubject,
			[pair],
			[],
			new Set(),
			0.0,
			NOW_MS,
		);
		expect(result).toHaveLength(1);
	});

	it("active filter + songMeta undefined excludes the pair (missing metadata fails filters)", () => {
		// An absent songMeta is treated as all-null metadata inside the pure
		// function, so an active language filter fails — no "unknown" pass-through.
		const pair: MatchPairInput = {
			songId: "song-1",
			playlistId: "pl-1",
			score: 0.8,
			fusedScore: null,
			playlistFilters: { version: 1, languages: { codes: ["en"] } },
		};
		const result = deriveVisibleSuggestions(
			songSubject,
			[pair],
			[],
			new Set(),
			0.0,
			NOW_MS,
		);
		expect(result).toHaveLength(0);
	});

	it("active filter + songMeta null excludes the pair (missing metadata fails filters)", () => {
		const pair: MatchPairInput = {
			songId: "song-1",
			playlistId: "pl-1",
			score: 0.8,
			fusedScore: null,
			songMeta: null,
			playlistFilters: { version: 1, languages: { codes: ["en"] } },
		};
		const result = deriveVisibleSuggestions(
			songSubject,
			[pair],
			[],
			new Set(),
			0.0,
			NOW_MS,
		);
		expect(result).toHaveLength(0);
	});

	it("filter object with no active constraints passes even when songMeta is null", () => {
		// Distinguishes "active filter" from "filter object present": with no
		// constraints there is nothing to fail, so missing metadata still passes —
		// preserving the "no filter applied" path.
		const pair: MatchPairInput = {
			songId: "song-1",
			playlistId: "pl-1",
			score: 0.8,
			fusedScore: null,
			songMeta: null,
			playlistFilters: { version: 1 },
		};
		const result = deriveVisibleSuggestions(
			songSubject,
			[pair],
			[],
			new Set(),
			0.0,
			NOW_MS,
		);
		expect(result).toHaveLength(1);
	});

	it("no filter applied when playlistFilters is absent", () => {
		const pair: MatchPairInput = {
			songId: "song-1",
			playlistId: "pl-1",
			score: 0.8,
			fusedScore: null,
			songMeta: DEFAULT_META,
		};
		const result = deriveVisibleSuggestions(
			songSubject,
			[pair],
			[],
			new Set(),
			0.0,
			NOW_MS,
		);
		expect(result).toHaveLength(1);
	});

	it("no filter applied when playlistFilters is null", () => {
		const pair: MatchPairInput = {
			songId: "song-1",
			playlistId: "pl-1",
			score: 0.8,
			fusedScore: null,
			songMeta: DEFAULT_META,
			playlistFilters: null,
		};
		const result = deriveVisibleSuggestions(
			songSubject,
			[pair],
			[],
			new Set(),
			0.0,
			NOW_MS,
		);
		expect(result).toHaveLength(1);
	});

	it("playlist with no active filters passes regardless of metadata", () => {
		const pair = makePairWithMeta(
			"pl-1",
			{ ...DEFAULT_META, language: null },
			{ version: 1 },
		);
		const result = deriveVisibleSuggestions(
			songSubject,
			[pair],
			[],
			new Set(),
			0.0,
			NOW_MS,
		);
		expect(result).toHaveLength(1);
	});
});

/**
 * Returns a chain where the maybySingle terminal resolves with a DB error.
 * Used to simulate fetchSongFilterMeta failures without altering other queries.
 */
function makeMaybySingleErrorChain(code: string, message: string) {
	const error = { code, message };
	const chain = {
		select: vi.fn(),
		eq: vi.fn(),
		in: vi.fn(),
		is: vi.fn(),
		order: vi.fn(),
		limit: vi.fn(),
		maybeSingle: vi.fn().mockResolvedValue({ data: null, error }),
	};
	chain.select.mockReturnValue(chain);
	chain.eq.mockReturnValue(chain);
	chain.in.mockReturnValue(chain);
	chain.is.mockReturnValue(chain);
	chain.order.mockReturnValue(chain);
	chain.limit.mockReturnValue(chain);
	return chain;
}

/**
 * Returns a chain where the .in() terminal resolves with a DB error.
 * Used to simulate fetchPlaylistsMatchFilters and fetchSongsFilterMeta failures.
 */
function makeInTerminalErrorChain(code: string, message: string) {
	const error = { code, message };
	const chain = {
		select: vi.fn(),
		eq: vi.fn(),
		in: vi.fn().mockResolvedValue({ data: null, error }),
		is: vi.fn(),
		order: vi.fn(),
		limit: vi.fn(),
		maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
	};
	chain.select.mockReturnValue(chain);
	chain.eq.mockReturnValue(chain);
	chain.is.mockReturnValue(chain);
	chain.order.mockReturnValue(chain);
	chain.limit.mockReturnValue(chain);
	return chain;
}

describe("computeVisibleSuggestionList — filter-metadata retryable errors (MSR-37)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("song orientation: song metadata DB failure → db-error (not ok/empty)", async () => {
		// Entitlement passes but the song metadata query for read-time filters fails.
		// This must surface as db-error so the caller returns retryable-error instead
		// of silently hiding all suggestions by treating them as missing metadata.
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
			from: vi
				.fn()
				// fetchSongFilterMeta: song query → DB error
				.mockReturnValueOnce(
					makeMaybySingleErrorChain("PGRST301", "connection timeout"),
				)
				// fetchSongFilterMeta: liked_song query — also fails (both in Promise.all)
				.mockReturnValue(
					makeMaybySingleErrorChain("PGRST301", "connection timeout"),
				),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		vi.mocked(getMatchPairsForSong).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-d1",
					playlist_id: "pl-a",
					score: 0.9,
					fused_score: null,
				},
			]),
		);
		vi.mocked(getMatchRankingsForSong).mockResolvedValue(
			Result.ok<never[], never>([]),
		);
		vi.mocked(getMatchDecisionsForSongs).mockResolvedValue(
			Result.ok<never[], never>([]),
		);

		const result = await computeVisibleSuggestionList(makeSongItem(), 0.0);

		// Must be db-error, not ok with empty suggestions — the distinction ensures
		// the caller shows Retry rather than an empty/unavailable card state.
		expect(result.kind).toBe("db-error");
	});

	it("song orientation: playlist filter config DB failure → db-error", async () => {
		// Song metadata fetch succeeds; the playlist match_filters query fails.
		// The result must still be db-error so callers can retry rather than
		// incorrectly applying no filter (pass-through) or hiding all suggestions.
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
			from: vi
				.fn()
				// fetchSongFilterMeta: song row → success (no language, etc.)
				.mockReturnValueOnce(makeMaybeChain({ data: null, error: null }))
				// fetchSongFilterMeta: liked_song row → success
				.mockReturnValueOnce(makeMaybeChain({ data: null, error: null }))
				// fetchPlaylistsMatchFilters: .in() terminal → DB error
				.mockReturnValue(
					makeInTerminalErrorChain("PGRST301", "connection timeout"),
				),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		vi.mocked(getMatchPairsForSong).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-d1",
					playlist_id: "pl-a",
					score: 0.9,
					fused_score: null,
				},
			]),
		);
		vi.mocked(getMatchRankingsForSong).mockResolvedValue(
			Result.ok<never[], never>([]),
		);
		vi.mocked(getMatchDecisionsForSongs).mockResolvedValue(
			Result.ok<never[], never>([]),
		);

		const result = await computeVisibleSuggestionList(makeSongItem(), 0.0);

		expect(result.kind).toBe("db-error");
	});

	it("playlist orientation: song metadata DB failure → db-error", async () => {
		// Playlist ownership passes; the song metadata batch fetch fails.
		// A db-error here prevents wrongly hiding newly-liked songs whose metadata
		// is temporarily unavailable from transient DB errors.
		const from = vi
			.fn()
			// checkPlaylistOwned: from("playlist").maybySingle → owned
			.mockReturnValueOnce(
				makeMaybeChain({ data: { id: "pl-d1" }, error: null }),
			)
			// fetchPlaylistsMatchFilters: from("playlist").in() → no filters
			.mockReturnValueOnce(makeInTerminalChain({ data: [], error: null }))
			// fetchSongsFilterMeta: from("song").in() → DB error
			.mockReturnValueOnce(
				makeInTerminalErrorChain("PGRST301", "connection timeout"),
			)
			// fetchSongsFilterMeta: from("liked_song")... — won't be reached on error
			.mockReturnValue(makeIsTerminalChain({ data: [], error: null }));

		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from,
			// fetchEntitledSongIds runs in parallel with fetchSongsFilterMeta; the
			// metadata failure is what must surface as db-error, so entitlement is fine.
			rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		vi.mocked(getMatchPairsForPlaylist).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-x",
					playlist_id: "pl-d1",
					score: 0.85,
					fused_score: null,
				},
			]),
		);
		vi.mocked(getMatchRankingsForPlaylist).mockResolvedValue(
			Result.ok<never[], never>([]),
		);
		vi.mocked(getMatchDecisionsForPlaylist).mockResolvedValue(
			Result.ok<never[], never>([]),
		);

		const result = await computeVisibleSuggestionList(makePlaylistItem(), 0.0);

		expect(result.kind).toBe("db-error");
	});

	it("playlist orientation: playlist filter config DB failure → db-error", async () => {
		// Playlist ownership passes; the playlist match_filters fetch fails before
		// song metadata is even loaded. Must be db-error so that callers never
		// silently apply no-filter semantics on a transient failure.
		const from = vi
			.fn()
			// checkPlaylistOwned: from("playlist").maybySingle → owned
			.mockReturnValueOnce(
				makeMaybeChain({ data: { id: "pl-d1" }, error: null }),
			)
			// fetchPlaylistsMatchFilters: from("playlist").in() → DB error
			.mockReturnValue(
				makeInTerminalErrorChain("PGRST301", "connection timeout"),
			);

		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from,
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		vi.mocked(getMatchPairsForPlaylist).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-x",
					playlist_id: "pl-d1",
					score: 0.85,
					fused_score: null,
				},
			]),
		);
		vi.mocked(getMatchRankingsForPlaylist).mockResolvedValue(
			Result.ok<never[], never>([]),
		);
		vi.mocked(getMatchDecisionsForPlaylist).mockResolvedValue(
			Result.ok<never[], never>([]),
		);

		const result = await computeVisibleSuggestionList(makePlaylistItem(), 0.0);

		expect(result.kind).toBe("db-error");
	});
});
