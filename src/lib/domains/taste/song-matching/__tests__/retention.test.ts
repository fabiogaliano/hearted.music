import { describe, expect, it } from "vitest";
import {
	MATCH_STORED_PAIRS_PER_PLAYLIST,
	MATCH_STORED_PAIRS_PER_SONG,
	retainStoredMatchPairs,
} from "../retention";
import type { MatchResult } from "../types";

const ZERO_FACTORS = { embedding: 0, audio: 0, genre: 0 };

/** Build a minimal MatchResult for retention tests. */
function makePair(
	songId: string,
	playlistId: string,
	fusedScore: number,
): MatchResult {
	return {
		songId,
		playlistId,
		score: fusedScore,
		rank: 0,
		factors: ZERO_FACTORS,
		normalizedFactors: ZERO_FACTORS,
		fusedScore,
		confidence: 1,
		fromCache: false,
	};
}

describe("retainStoredMatchPairs", () => {
	it("returns empty array for empty input", () => {
		const result = retainStoredMatchPairs({
			thresholdedPairs: [],
			perSongLimit: 5,
			perPlaylistLimit: 5,
		});
		expect(result).toEqual([]);
	});

	it("retains a pair in song-top-N that is outside playlist-top-N", () => {
		// song-s1 has one playlist p1 (score 0.9) — in song top-1.
		// playlist-p1 has many songs so s1 falls outside playlist top-1.
		const pairs = [
			makePair("s1", "p1", 0.9),
			makePair("s2", "p1", 0.99),
			makePair("s3", "p1", 0.98),
		];
		// perPlaylistLimit=1 means only s2 survives the playlist-top-N.
		// perSongLimit=1 for each song: s1→p1 survives song-top-1, s2→p1, s3→p1.
		const result = retainStoredMatchPairs({
			thresholdedPairs: pairs,
			perSongLimit: 1,
			perPlaylistLimit: 1,
		});
		const keys = result.map((r) => `${r.songId}:${r.playlistId}`);
		// s1:p1 is in song-top-1 for s1, so it must be retained.
		expect(keys).toContain("s1:p1");
		// s2:p1 is in both song-top-1 for s2 and playlist-top-1 for p1.
		expect(keys).toContain("s2:p1");
	});

	it("retains a pair in playlist-top-N that is outside song-top-N", () => {
		// Song s1 has two playlists. perSongLimit=1 keeps only p1 for s1.
		// But p2 has perPlaylistLimit=10 so s1:p2 survives via playlist orientation.
		const pairs = [
			makePair("s1", "p1", 0.9), // song-top-1 for s1
			makePair("s1", "p2", 0.5), // NOT in song-top-1 for s1
			makePair("s2", "p2", 0.4), // p2 also has s2 (lower score)
		];
		const result = retainStoredMatchPairs({
			thresholdedPairs: pairs,
			perSongLimit: 1,
			perPlaylistLimit: 10,
		});
		const keys = result.map((r) => `${r.songId}:${r.playlistId}`);
		expect(keys).toContain("s1:p1");
		// s1:p2 is in playlist-top-N for p2, so retained even though it missed song-top-1.
		expect(keys).toContain("s1:p2");
		expect(keys).toContain("s2:p2");
	});

	it("no starvation — pairs from both orientations coexist in output", () => {
		// Two songs, two playlists, each song has one strong match.
		// Song s1 strongly fits p1 and weakly fits p2.
		// Song s2 weakly fits p1 and strongly fits p2.
		const pairs = [
			makePair("s1", "p1", 0.95),
			makePair("s1", "p2", 0.4),
			makePair("s2", "p1", 0.4),
			makePair("s2", "p2", 0.95),
		];
		// Song top-1: s1→p1, s2→p2. Playlist top-1: p1→s1 (score 0.95), p2→s2 (score 0.95).
		// s1:p2 and s2:p1 are excluded from both top-1 sets.
		const result = retainStoredMatchPairs({
			thresholdedPairs: pairs,
			perSongLimit: 1,
			perPlaylistLimit: 1,
		});
		const keys = result.map((r) => `${r.songId}:${r.playlistId}`);
		expect(keys).toContain("s1:p1");
		expect(keys).toContain("s2:p2");
		// Weak pairs below both top-1 thresholds should be excluded.
		expect(keys).not.toContain("s1:p2");
		expect(keys).not.toContain("s2:p1");
	});

	it("collapses duplicate pairs — (songId, playlistId) appears at most once", () => {
		// A pair present in both song-top-N and playlist-top-N should appear once.
		const pairs = [makePair("s1", "p1", 0.8), makePair("s1", "p2", 0.7)];
		const result = retainStoredMatchPairs({
			thresholdedPairs: pairs,
			perSongLimit: 5,
			perPlaylistLimit: 5,
		});
		const keys = result.map((r) => `${r.songId}:${r.playlistId}`);
		const unique = new Set(keys);
		expect(keys.length).toBe(unique.size);
		expect(keys).toContain("s1:p1");
		expect(keys).toContain("s1:p2");
	});

	it("returns deterministic order: songId asc, fusedScore desc, playlistId asc", () => {
		const pairs = [
			makePair("s2", "p1", 0.7),
			makePair("s1", "p2", 0.6),
			makePair("s1", "p1", 0.8),
			makePair("s2", "p2", 0.9),
		];
		const result = retainStoredMatchPairs({
			thresholdedPairs: pairs,
			perSongLimit: 5,
			perPlaylistLimit: 5,
		});
		const keys = result.map((r) => `${r.songId}:${r.playlistId}`);
		// Expected: s1:p1 (s1, 0.8), s1:p2 (s1, 0.6), s2:p2 (s2, 0.9), s2:p1 (s2, 0.7)
		expect(keys).toEqual(["s1:p1", "s1:p2", "s2:p2", "s2:p1"]);
	});

	it("tie-breaking on playlistId asc when fusedScores are equal (song orientation)", () => {
		// Two playlists with identical scores for the same song — p1 < p2 lexically.
		const pairs = [makePair("s1", "p2", 0.7), makePair("s1", "p1", 0.7)];
		// perSongLimit=1 should retain p1 (alphabetically first on tie).
		const result = retainStoredMatchPairs({
			thresholdedPairs: pairs,
			perSongLimit: 1,
			perPlaylistLimit: 10,
		});
		const keys = result.map((r) => `${r.songId}:${r.playlistId}`);
		expect(keys).toContain("s1:p1");
		// p2 falls outside song-top-1 but is retained via playlist-top-10.
		expect(keys).toContain("s1:p2");
	});

	it("assigns provisional legacy per-song ranks matching sort order", () => {
		const pairs = [
			makePair("s1", "p2", 0.6),
			makePair("s1", "p1", 0.8),
			makePair("s2", "p1", 0.9),
		];
		const result = retainStoredMatchPairs({
			thresholdedPairs: pairs,
			perSongLimit: 5,
			perPlaylistLimit: 5,
		});
		// s1 group: p1 (0.8) rank=1, p2 (0.6) rank=2.
		const s1p1 = result.find((r) => r.songId === "s1" && r.playlistId === "p1");
		const s1p2 = result.find((r) => r.songId === "s1" && r.playlistId === "p2");
		const s2p1 = result.find((r) => r.songId === "s2" && r.playlistId === "p1");
		expect(s1p1?.rank).toBe(1);
		expect(s1p2?.rank).toBe(2);
		// s2 group: p1 (0.9) rank=1.
		expect(s2p1?.rank).toBe(1);
	});

	it("respects perSongLimit: drops low-scoring playlists for a song beyond the limit", () => {
		const pairs = [
			makePair("s1", "p1", 0.9),
			makePair("s1", "p2", 0.8),
			makePair("s1", "p3", 0.7),
		];
		// With perSongLimit=2, p3 is only retained if playlist-top-N saves it.
		// perPlaylistLimit=0 makes playlist-top-N contribute nothing.
		const result = retainStoredMatchPairs({
			thresholdedPairs: pairs,
			perSongLimit: 2,
			perPlaylistLimit: 0,
		});
		const keys = result.map((r) => `${r.songId}:${r.playlistId}`);
		expect(keys).toContain("s1:p1");
		expect(keys).toContain("s1:p2");
		expect(keys).not.toContain("s1:p3");
	});

	it("respects perPlaylistLimit: drops low-scoring songs for a playlist beyond the limit", () => {
		const pairs = [
			makePair("s1", "p1", 0.9),
			makePair("s2", "p1", 0.8),
			makePair("s3", "p1", 0.7),
		];
		// With perPlaylistLimit=2, s3 is only retained if song-top-N saves it.
		// perSongLimit=0 makes song-top-N contribute nothing.
		const result = retainStoredMatchPairs({
			thresholdedPairs: pairs,
			perSongLimit: 0,
			perPlaylistLimit: 2,
		});
		const keys = result.map((r) => `${r.songId}:${r.playlistId}`);
		expect(keys).toContain("s1:p1");
		expect(keys).toContain("s2:p1");
		expect(keys).not.toContain("s3:p1");
	});

	it("constants equal DEFAULT_MATCHING_CONFIG.maxResultsPerSong (10)", () => {
		expect(MATCH_STORED_PAIRS_PER_SONG).toBe(10);
		expect(MATCH_STORED_PAIRS_PER_PLAYLIST).toBe(10);
	});
});
