/**
 * Unit tests for deriveDecidedPairRanks.
 *
 * Tests only the pure function — no Supabase, no services.
 * Fixtures are minimal MatchResult-shaped objects (only score and playlistId
 * are used by the rank-derivation algorithm).
 */

import { describe, it, expect } from "vitest";
import { deriveDecidedPairRanks } from "../run-config";
import type { MatchResult } from "@/lib/domains/taste/song-matching/types";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeResult(playlistId: string, score: number): MatchResult {
  return {
    songId: "", // unused by deriveDecidedPairRanks (comes from the map key)
    playlistId,
    score,
    rank: 1, // original rank; irrelevant — we recompute
    factors: { embedding: 0, audio: 0, genre: 0 },
    normalizedFactors: { embedding: 0, audio: 0, genre: 0 },
    fusedScore: score,
    confidence: 1,
    fromCache: false,
  };
}

function makeMatches(
  entries: [songId: string, results: Array<[playlistId: string, score: number]>][],
): Map<string, MatchResult[]> {
  return new Map(
    entries.map(([songId, results]) => [
      songId,
      results.map(([pid, score]) => makeResult(pid, score)),
    ]),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deriveDecidedPairRanks", () => {
  it("assigns rank 1 to the highest-scoring song for a playlist", () => {
    const matches = makeMatches([
      ["song-A", [["playlist-1", 0.9]]],
      ["song-B", [["playlist-1", 0.7]]],
      ["song-C", [["playlist-1", 0.5]]],
    ]);

    const pairs = [
      { songId: "song-A", playlistId: "playlist-1" },
      { songId: "song-B", playlistId: "playlist-1" },
      { songId: "song-C", playlistId: "playlist-1" },
    ];

    const ranks = deriveDecidedPairRanks(matches, pairs);

    expect(ranks.get("song-A:playlist-1")).toBe(1);
    expect(ranks.get("song-B:playlist-1")).toBe(2);
    expect(ranks.get("song-C:playlist-1")).toBe(3);
  });

  it("returns null for a decided pair whose song is absent from matches", () => {
    const matches = makeMatches([
      ["song-A", [["playlist-1", 0.8]]],
    ]);

    const pairs = [
      { songId: "song-A", playlistId: "playlist-1" },
      { songId: "song-MISSING", playlistId: "playlist-1" },
    ];

    const ranks = deriveDecidedPairRanks(matches, pairs);

    expect(ranks.get("song-A:playlist-1")).toBe(1);
    expect(ranks.get("song-MISSING:playlist-1")).toBeNull();
  });

  it("returns null when the decided pair's playlist has no matches at all", () => {
    const matches = makeMatches([
      ["song-A", [["playlist-1", 0.8]]],
    ]);

    const pairs = [
      { songId: "song-A", playlistId: "playlist-EMPTY" },
    ];

    const ranks = deriveDecidedPairRanks(matches, pairs);

    expect(ranks.get("song-A:playlist-EMPTY")).toBeNull();
  });

  it("is independent across playlists — rank 1 is per-playlist, not global", () => {
    const matches = makeMatches([
      ["song-A", [["playlist-1", 0.9], ["playlist-2", 0.4]]],
      ["song-B", [["playlist-1", 0.5], ["playlist-2", 0.95]]],
    ]);

    const pairs = [
      { songId: "song-A", playlistId: "playlist-1" },
      { songId: "song-B", playlistId: "playlist-1" },
      { songId: "song-A", playlistId: "playlist-2" },
      { songId: "song-B", playlistId: "playlist-2" },
    ];

    const ranks = deriveDecidedPairRanks(matches, pairs);

    // playlist-1: song-A (#1 at 0.9), song-B (#2 at 0.5)
    expect(ranks.get("song-A:playlist-1")).toBe(1);
    expect(ranks.get("song-B:playlist-1")).toBe(2);

    // playlist-2: song-B (#1 at 0.95), song-A (#2 at 0.4) — independent ordering
    expect(ranks.get("song-B:playlist-2")).toBe(1);
    expect(ranks.get("song-A:playlist-2")).toBe(2);
  });

  it("breaks ties by songId asc for stable, deterministic ordering", () => {
    // Exact same score — alphabetically earlier songId should rank first
    const matches = makeMatches([
      ["song-AAA", [["playlist-1", 0.75]]],
      ["song-BBB", [["playlist-1", 0.75]]],
      ["song-CCC", [["playlist-1", 0.75]]],
    ]);

    const pairs = [
      { songId: "song-AAA", playlistId: "playlist-1" },
      { songId: "song-BBB", playlistId: "playlist-1" },
      { songId: "song-CCC", playlistId: "playlist-1" },
    ];

    const ranks = deriveDecidedPairRanks(matches, pairs);

    expect(ranks.get("song-AAA:playlist-1")).toBe(1);
    expect(ranks.get("song-BBB:playlist-1")).toBe(2);
    expect(ranks.get("song-CCC:playlist-1")).toBe(3);
  });

  it("handles a single song × single playlist correctly", () => {
    const matches = makeMatches([
      ["song-only", [["pl-only", 0.6]]],
    ]);

    const pairs = [{ songId: "song-only", playlistId: "pl-only" }];
    const ranks = deriveDecidedPairRanks(matches, pairs);

    expect(ranks.get("song-only:pl-only")).toBe(1);
  });

  it("returns empty map when no pairs are provided", () => {
    const matches = makeMatches([
      ["song-A", [["pl-1", 0.8]]],
    ]);

    const ranks = deriveDecidedPairRanks(matches, []);
    expect(ranks.size).toBe(0);
  });

  it("handles a song matched to multiple playlists independently", () => {
    const matches = makeMatches([
      ["song-X", [["pl-1", 0.8], ["pl-2", 0.3]]],
      ["song-Y", [["pl-1", 0.9], ["pl-2", 0.7]]],
    ]);

    const pairs = [
      { songId: "song-X", playlistId: "pl-1" },
      { songId: "song-Y", playlistId: "pl-1" },
      { songId: "song-X", playlistId: "pl-2" },
      { songId: "song-Y", playlistId: "pl-2" },
    ];

    const ranks = deriveDecidedPairRanks(matches, pairs);

    expect(ranks.get("song-Y:pl-1")).toBe(1);
    expect(ranks.get("song-X:pl-1")).toBe(2);

    expect(ranks.get("song-Y:pl-2")).toBe(1);
    expect(ranks.get("song-X:pl-2")).toBe(2);
  });

  it("returns null for a song that matched one playlist but is queried for a different one", () => {
    // song-A matched pl-1 (score 0.8) but did NOT match pl-2 at all.
    // A decided pair querying song-A × pl-2 must yield null, not a rank from pl-1.
    const matches = makeMatches([
      ["song-A", [["pl-1", 0.8]]],
      ["song-B", [["pl-2", 0.9]]],
    ]);

    const pairs = [
      { songId: "song-A", playlistId: "pl-1" },
      { songId: "song-A", playlistId: "pl-2" }, // song-A is absent from pl-2
      { songId: "song-B", playlistId: "pl-2" },
    ];

    const ranks = deriveDecidedPairRanks(matches, pairs);

    expect(ranks.get("song-A:pl-1")).toBe(1);
    expect(ranks.get("song-A:pl-2")).toBeNull(); // no cross-playlist leakage
    expect(ranks.get("song-B:pl-2")).toBe(1);
  });
});
