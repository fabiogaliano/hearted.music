import { describe, expect, it } from "vitest";
import {
  computeDiff,
  computeVariantMetrics,
  formatDiffTable,
  buildResultJson,
  type DecidedPairRanks,
  type Decision,
} from "../metrics";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function pair(
  songId: string,
  playlistId: string,
  decision: Decision,
  servedRank: number | null,
  rankA: number | null,
  rankB: number | null,
): DecidedPairRanks {
  return { songId, playlistId, decision, servedRank, rankA, rankB };
}

// ---------------------------------------------------------------------------
// computeVariantMetrics — pairwise win rate
// ---------------------------------------------------------------------------

describe("computeVariantMetrics — pairwise win rate", () => {
  it("counts a win when added ranks above dismissed (lower number)", () => {
    const pairs = [
      pair("s1", "pl1", "added", 1, 1, 1),
      pair("s2", "pl1", "dismissed", 2, 3, 3),
    ];
    const m = computeVariantMetrics(pairs, "A");
    // added rank 1 < dismissed rank 3 → win
    expect(m.wins).toBe(1);
    expect(m.losses).toBe(0);
    expect(m.pairwiseWinRate).toBe(1);
  });

  it("counts a loss when added ranks below dismissed", () => {
    const pairs = [
      pair("s1", "pl1", "added", 1, 5, 5),
      pair("s2", "pl1", "dismissed", 2, 2, 2),
    ];
    const m = computeVariantMetrics(pairs, "A");
    expect(m.wins).toBe(0);
    expect(m.losses).toBe(1);
    expect(m.pairwiseWinRate).toBe(0);
  });

  it("counts a tie when added and dismissed have the same rank", () => {
    const pairs = [
      pair("s1", "pl1", "added", 1, 3, 3),
      pair("s2", "pl1", "dismissed", 2, 3, 3),
    ];
    const m = computeVariantMetrics(pairs, "A");
    expect(m.wins).toBe(0);
    expect(m.losses).toBe(0);
    expect(m.ties).toBe(1);
    // ties excluded from trials → winRate = 0 (0/0 → fallback to 0)
    expect(m.pairwiseWinRate).toBe(0);
  });

  it("pairs cross multiple added × dismissed within one playlist (cartesian product)", () => {
    // 2 added × 2 dismissed in pl1 → 4 pairs
    const pairs = [
      pair("a1", "pl1", "added", null, 1, 1),
      pair("a2", "pl1", "added", null, 2, 2),
      pair("d1", "pl1", "dismissed", null, 4, 4),
      pair("d2", "pl1", "dismissed", null, 5, 5),
    ];
    const m = computeVariantMetrics(pairs, "A");
    // all 4 pairs are wins (both added rank < both dismissed rank)
    expect(m.wins).toBe(4);
    expect(m.losses).toBe(0);
    expect(m.comparablePairs).toBe(4);
    expect(m.pairwiseWinRate).toBe(1);
  });

  it("does NOT compare across different playlists — cross-playlist isolation", () => {
    // added in pl1 vs dismissed in pl2 must NOT be compared
    const pairs = [
      pair("a1", "pl1", "added", null, 10, 10), // rank 10 in pl1
      pair("d1", "pl2", "dismissed", null, 1, 1), // rank 1 in pl2
    ];
    const m = computeVariantMetrics(pairs, "A");
    // no playlist has both added AND dismissed → 0 comparable pairs
    expect(m.comparablePairs).toBe(0);
    expect(m.wins).toBe(0);
    expect(m.losses).toBe(0);
  });

  it("uses variant B column when which='B'", () => {
    const pairs = [
      pair("s1", "pl1", "added", 1, 5, 1), // rankB=1 (good)
      pair("s2", "pl1", "dismissed", 2, 1, 5), // rankB=5 (bad)
    ];
    const mA = computeVariantMetrics(pairs, "A");
    const mB = computeVariantMetrics(pairs, "B");
    // A: added=5, dismissed=1 → loss
    expect(mA.losses).toBe(1);
    expect(mA.wins).toBe(0);
    // B: added=1, dismissed=5 → win
    expect(mB.wins).toBe(1);
    expect(mB.losses).toBe(0);
  });

  it("handles multiple playlists independently", () => {
    const pairs = [
      // pl1: win
      pair("a1", "pl1", "added", null, 1, 1),
      pair("d1", "pl1", "dismissed", null, 3, 3),
      // pl2: loss
      pair("a2", "pl2", "added", null, 5, 5),
      pair("d2", "pl2", "dismissed", null, 2, 2),
    ];
    const m = computeVariantMetrics(pairs, "A");
    expect(m.wins).toBe(1);
    expect(m.losses).toBe(1);
    expect(m.comparablePairs).toBe(2);
    expect(m.pairwiseWinRate).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// computeVariantMetrics — null rank handling in pairwise
// ---------------------------------------------------------------------------

describe("computeVariantMetrics — null rank in pairwise comparisons", () => {
  it("treats null rank as +Infinity: added=null, dismissed=rank5 → loss", () => {
    const pairs = [
      pair("s1", "pl1", "added", null, null, null), // fell out → +Inf
      pair("s2", "pl1", "dismissed", null, 5, 5),
    ];
    const m = computeVariantMetrics(pairs, "A");
    // Inf > 5 → loss
    expect(m.losses).toBe(1);
    expect(m.wins).toBe(0);
  });

  it("treats null rank as +Infinity: added=rank2, dismissed=null → win", () => {
    const pairs = [
      pair("s1", "pl1", "added", null, 2, 2),
      pair("s2", "pl1", "dismissed", null, null, null),
    ];
    const m = computeVariantMetrics(pairs, "A");
    // 2 < Inf → win
    expect(m.wins).toBe(1);
    expect(m.losses).toBe(0);
  });

  it("both null → tie, NOT counted as win or loss", () => {
    const pairs = [
      pair("s1", "pl1", "added", null, null, null),
      pair("s2", "pl1", "dismissed", null, null, null),
    ];
    const m = computeVariantMetrics(pairs, "A");
    // both null → both +Inf → tie
    expect(m.wins).toBe(0);
    expect(m.losses).toBe(0);
    expect(m.ties).toBe(1);
    // ties excluded from binomial trials
    expect(m.pValue).toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// computeVariantMetrics — binomial p-value
// ---------------------------------------------------------------------------

describe("computeVariantMetrics — binomial p-value", () => {
  it("p-value is very small when all 10 pairs are wins (10/10)", () => {
    const pairs: DecidedPairRanks[] = Array.from({ length: 10 }, (_, i) => [
      pair(`a${i}`, `pl${i}`, "added", null, 1, 1),
      pair(`d${i}`, `pl${i}`, "dismissed", null, 2, 2),
    ]).flat();
    const m = computeVariantMetrics(pairs, "A");
    expect(m.wins).toBe(10);
    expect(m.losses).toBe(0);
    // two-sided p for 10/10 = 2 * (0.5^10) ≈ 0.00195
    expect(m.pValue).toBeLessThan(0.01);
    expect(m.pValue).toBeGreaterThan(0);
  });

  it("p-value is near 1 for a 5/5 even split", () => {
    // 5 wins + 5 losses = 10 trials, exactly at H0 → p-value near 1
    const pairs: DecidedPairRanks[] = [];
    for (let i = 0; i < 5; i++) {
      // win: added rank 1 < dismissed rank 2
      pairs.push(pair(`aw${i}`, `plw${i}`, "added", null, 1, 1));
      pairs.push(pair(`dw${i}`, `plw${i}`, "dismissed", null, 2, 2));
    }
    for (let i = 0; i < 5; i++) {
      // loss: added rank 3 > dismissed rank 2
      pairs.push(pair(`al${i}`, `pll${i}`, "added", null, 3, 3));
      pairs.push(pair(`dl${i}`, `pll${i}`, "dismissed", null, 2, 2));
    }
    const m = computeVariantMetrics(pairs, "A");
    expect(m.wins).toBe(5);
    expect(m.losses).toBe(5);
    // p-value for 5/10 two-sided ≈ 1.0
    expect(m.pValue).toBeGreaterThan(0.9);
    expect(m.pValue).toBeLessThanOrEqual(1);
  });

  it("p-value is NaN when there are no win+loss trials (all ties)", () => {
    const pairs = [
      pair("s1", "pl1", "added", null, null, null),
      pair("s2", "pl1", "dismissed", null, null, null),
    ];
    const m = computeVariantMetrics(pairs, "A");
    expect(m.pValue).toBeNaN();
  });

  it("p-value is small for a strong 8/2 win ratio", () => {
    // 8 wins, 2 losses
    const pairs: DecidedPairRanks[] = [];
    for (let i = 0; i < 8; i++) {
      pairs.push(pair(`aw${i}`, `plw${i}`, "added", null, 1, 1));
      pairs.push(pair(`dw${i}`, `plw${i}`, "dismissed", null, 5, 5));
    }
    for (let i = 0; i < 2; i++) {
      pairs.push(pair(`al${i}`, `pll${i}`, "added", null, 5, 5));
      pairs.push(pair(`dl${i}`, `pll${i}`, "dismissed", null, 1, 1));
    }
    const m = computeVariantMetrics(pairs, "A");
    expect(m.wins).toBe(8);
    expect(m.losses).toBe(2);
    expect(m.pValue).toBeLessThan(0.15);
  });

  it("exact two-sided p-value 10 wins / 0 losses = 2 × 0.5^10 ≈ 0.001953125", () => {
    // Two-sided: only k=0 and k=10 have PMF ≤ PMF(10) under H0 p=0.5
    // p = 2 × (0.5)^10 = 2/1024 = 0.001953125
    const pairs: DecidedPairRanks[] = Array.from({ length: 10 }, (_, i) => [
      pair(`a${i}`, `pl${i}`, "added", null, 1, 1),
      pair(`d${i}`, `pl${i}`, "dismissed", null, 2, 2),
    ]).flat();
    const m = computeVariantMetrics(pairs, "A");
    expect(m.pValue).toBeCloseTo(2 / 1024, 10);
  });

  it("exact two-sided p-value 5 wins / 5 losses = 1.0", () => {
    // PMF(5,10) is the maximum; all k values satisfy PMF(k) ≤ PMF(5) → sum = 1.0
    const pairs: DecidedPairRanks[] = [];
    for (let i = 0; i < 5; i++) {
      pairs.push(pair(`aw${i}`, `plw${i}`, "added", null, 1, 1));
      pairs.push(pair(`dw${i}`, `plw${i}`, "dismissed", null, 2, 2));
    }
    for (let i = 0; i < 5; i++) {
      pairs.push(pair(`al${i}`, `pll${i}`, "added", null, 3, 3));
      pairs.push(pair(`dl${i}`, `pll${i}`, "dismissed", null, 2, 2));
    }
    const m = computeVariantMetrics(pairs, "A");
    expect(m.pValue).toBe(1);
  });

  it("exact two-sided p-value 8 wins / 2 losses = 112/1024 = 0.109375", () => {
    // k ∈ {0,1,2,8,9,10} have PMF ≤ PMF(8): (1+10+45+45+10+1)/1024 = 112/1024
    const pairs: DecidedPairRanks[] = [];
    for (let i = 0; i < 8; i++) {
      pairs.push(pair(`aw${i}`, `plw${i}`, "added", null, 1, 1));
      pairs.push(pair(`dw${i}`, `plw${i}`, "dismissed", null, 5, 5));
    }
    for (let i = 0; i < 2; i++) {
      pairs.push(pair(`al${i}`, `pll${i}`, "added", null, 5, 5));
      pairs.push(pair(`dl${i}`, `pll${i}`, "dismissed", null, 1, 1));
    }
    const m = computeVariantMetrics(pairs, "A");
    expect(m.pValue).toBeCloseTo(112 / 1024, 10);
  });
});

// ---------------------------------------------------------------------------
// computeVariantMetrics — rank stats
// ---------------------------------------------------------------------------

describe("computeVariantMetrics — mean and median rank of added/dismissed", () => {
  it("computes mean and median rank for added items (null excluded)", () => {
    const pairs = [
      pair("a1", "pl1", "added", null, 2, 2),
      pair("a2", "pl1", "added", null, 4, 4),
      pair("a3", "pl2", "added", null, null, null), // excluded from stats
      pair("d1", "pl1", "dismissed", null, 6, 6),
      pair("d2", "pl2", "dismissed", null, 8, 8),
    ];
    const m = computeVariantMetrics(pairs, "A");
    // added ranks with values: [2, 4] → mean=3, median=3
    expect(m.meanRankAdded).toBe(3);
    expect(m.medianRankAdded).toBe(3);
    // dismissed ranks: [6, 8] → mean=7
    expect(m.meanRankDismissed).toBe(7);
  });

  it("returns null for mean/median when all added ranks are null", () => {
    const pairs = [
      pair("a1", "pl1", "added", null, null, null),
      pair("d1", "pl1", "dismissed", null, 3, 3),
    ];
    const m = computeVariantMetrics(pairs, "A");
    expect(m.meanRankAdded).toBeNull();
    expect(m.medianRankAdded).toBeNull();
  });

  it("computes even-length median as average of two middle values", () => {
    // ranks: [1, 3, 5, 7] → median = (3+5)/2 = 4
    const pairs = [
      pair("a1", "pl1", "added", null, 1, 1),
      pair("a2", "pl1", "added", null, 3, 3),
      pair("a3", "pl2", "added", null, 5, 5),
      pair("a4", "pl2", "added", null, 7, 7),
    ];
    const m = computeVariantMetrics(pairs, "A");
    expect(m.medianRankAdded).toBe(4);
  });

  it("uses variant B rank column for rank stats when which='B'", () => {
    const pairs = [
      pair("a1", "pl1", "added", null, 10, 2),
      pair("d1", "pl1", "dismissed", null, 1, 5),
    ];
    const mA = computeVariantMetrics(pairs, "A");
    const mB = computeVariantMetrics(pairs, "B");
    expect(mA.meanRankAdded).toBe(10);
    expect(mB.meanRankAdded).toBe(2);
    expect(mA.meanRankDismissed).toBe(1);
    expect(mB.meanRankDismissed).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// computeVariantMetrics — MRR
// ---------------------------------------------------------------------------

describe("computeVariantMetrics — MRR", () => {
  it("computes MRR correctly for multiple added items", () => {
    // added at ranks 1, 2, 4 → reciprocals: 1 + 0.5 + 0.25 = 1.75 / 3 ≈ 0.5833
    const pairs = [
      pair("a1", "pl1", "added", null, 1, 1),
      pair("a2", "pl2", "added", null, 2, 2),
      pair("a3", "pl3", "added", null, 4, 4),
    ];
    const m = computeVariantMetrics(pairs, "A");
    expect(m.mrr).toBeCloseTo(1.75 / 3, 5);
  });

  it("null rank contributes 0 to MRR", () => {
    const pairs = [
      pair("a1", "pl1", "added", null, 1, 1),
      pair("a2", "pl2", "added", null, null, null), // 0 contribution
    ];
    const m = computeVariantMetrics(pairs, "A");
    // (1/1 + 0) / 2 = 0.5
    expect(m.mrr).toBe(0.5);
  });

  it("MRR is 0 when all added items have null rank", () => {
    const pairs = [pair("a1", "pl1", "added", null, null, null)];
    const m = computeVariantMetrics(pairs, "A");
    expect(m.mrr).toBe(0);
  });

  it("MRR is 0 when there are no added items", () => {
    const pairs = [pair("d1", "pl1", "dismissed", null, 1, 1)];
    const m = computeVariantMetrics(pairs, "A");
    expect(m.mrr).toBe(0);
  });

  it("MRR = 1 when single added item at rank 1", () => {
    const pairs = [pair("a1", "pl1", "added", null, 1, 1)];
    const m = computeVariantMetrics(pairs, "A");
    expect(m.mrr).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeVariantMetrics — nDCG@10
// ---------------------------------------------------------------------------

describe("computeVariantMetrics — nDCG@10", () => {
  it("nDCG@10 = 1.0 when all added items are at their ideal rank positions", () => {
    // Single playlist, added at rank 1, dismissed at rank 2
    // Ideal DCG = 1/log2(2) = 1. Actual DCG = 1/log2(2) = 1 → nDCG=1
    const pairs = [
      pair("a1", "pl1", "added", null, 1, 1),
      pair("d1", "pl1", "dismissed", null, 2, 2),
    ];
    const m = computeVariantMetrics(pairs, "A");
    expect(m.ndcg10).toBe(1);
  });

  it("items with rank > 10 contribute 0 gain to nDCG@10", () => {
    // added at rank 11 → gain 0
    // ideal DCG based on best possible = rank 11 still > 10 → ideal DCG = 0
    // playlist skipped when idealDCG = 0
    const pairs = [
      pair("a1", "pl1", "added", null, 11, 11),
      pair("d1", "pl1", "dismissed", null, 5, 5),
    ];
    const m = computeVariantMetrics(pairs, "A");
    // Ideal DCG = 0 (no added item in top-10), so nDCG = 0
    expect(m.ndcg10).toBe(0);
  });

  it("null rank contributes 0 gain to nDCG@10", () => {
    const pairs = [
      pair("a1", "pl1", "added", null, null, null),
      pair("d1", "pl1", "dismissed", null, 3, 3),
    ];
    const m = computeVariantMetrics(pairs, "A");
    expect(m.ndcg10).toBe(0);
  });

  it("computes nDCG correctly for known values", () => {
    // added at rank 3, dismissed at rank 1
    // actual DCG  = 1/log2(4) = 0.5
    // ideal DCG   = 1/log2(2) = 1.0  (one added item placed at ideal position 1)
    // nDCG = 0.5 / 1.0 = 0.5
    const pairs = [
      pair("a1", "pl1", "added", null, 3, 3),
      pair("d1", "pl1", "dismissed", null, 1, 1),
    ];
    const m = computeVariantMetrics(pairs, "A");
    expect(m.ndcg10).toBeCloseTo(0.5, 5);
  });

  it("averages nDCG across playlists", () => {
    // pl1: added at rank 1 → nDCG=1
    // pl2: added at rank 11 → nDCG=0
    const pairs = [
      pair("a1", "pl1", "added", null, 1, 1),
      pair("d1", "pl1", "dismissed", null, 2, 2),
      pair("a2", "pl2", "added", null, 11, 11),
      pair("d2", "pl2", "dismissed", null, 5, 5),
    ];
    const m = computeVariantMetrics(pairs, "A");
    // (1 + 0) / 2 = 0.5
    expect(m.ndcg10).toBe(0.5);
  });

  it("skips playlists with no added items", () => {
    // Only dismissed items — no playlist should contribute to nDCG
    const pairs = [
      pair("d1", "pl1", "dismissed", null, 1, 1),
      pair("d2", "pl2", "dismissed", null, 2, 2),
    ];
    const m = computeVariantMetrics(pairs, "A");
    // no playlists have added items → nDCG = 0
    expect(m.ndcg10).toBe(0);
  });

  it("nDCG handles multiple added items within one playlist", () => {
    // pl1: added at rank 1 and rank 2
    // ideal DCG = 1/log2(2) + 1/log2(3) ≈ 1 + 0.6309 = 1.6309
    // actual DCG same (both are ranked optimally) → nDCG = 1
    const pairs = [
      pair("a1", "pl1", "added", null, 1, 1),
      pair("a2", "pl1", "added", null, 2, 2),
      pair("d1", "pl1", "dismissed", null, 5, 5),
    ];
    const m = computeVariantMetrics(pairs, "A");
    expect(m.ndcg10).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeVariantMetrics — addedFellOutPct
// ---------------------------------------------------------------------------

describe("computeVariantMetrics — addedFellOutPct", () => {
  it("is 0% when no added items fell out", () => {
    const pairs = [
      pair("a1", "pl1", "added", null, 2, 2),
      pair("a2", "pl2", "added", null, 5, 5),
    ];
    const m = computeVariantMetrics(pairs, "A");
    expect(m.addedFellOutPct).toBe(0);
  });

  it("is 100% when all added items have null rank", () => {
    const pairs = [
      pair("a1", "pl1", "added", null, null, null),
      pair("a2", "pl2", "added", null, null, null),
    ];
    const m = computeVariantMetrics(pairs, "A");
    expect(m.addedFellOutPct).toBe(100);
  });

  it("computes correct percentage for a partial fell-out", () => {
    // 1 of 4 added items fell out → 25%
    const pairs = [
      pair("a1", "pl1", "added", null, 1, 1),
      pair("a2", "pl1", "added", null, 2, 2),
      pair("a3", "pl2", "added", null, 3, 3),
      pair("a4", "pl2", "added", null, null, null), // fell out
    ];
    const m = computeVariantMetrics(pairs, "A");
    expect(m.addedFellOutPct).toBe(25);
  });

  it("uses the correct variant column for fell-out check", () => {
    // rankA=null (fell out in A), rankB=5 (still in top-K in B)
    const pairs = [pair("a1", "pl1", "added", null, null, 5)];
    const mA = computeVariantMetrics(pairs, "A");
    const mB = computeVariantMetrics(pairs, "B");
    expect(mA.addedFellOutPct).toBe(100);
    expect(mB.addedFellOutPct).toBe(0);
  });

  it("is 0 when there are no added items (not NaN)", () => {
    const pairs = [pair("d1", "pl1", "dismissed", null, 3, 3)];
    const m = computeVariantMetrics(pairs, "A");
    expect(m.addedFellOutPct).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeDiff — delta computation
// ---------------------------------------------------------------------------

describe("computeDiff — delta computation and sorting", () => {
  it("computes delta as rankB − rankA", () => {
    const pairs = [
      pair("s1", "pl1", "added", 1, 3, 1), // delta = 1-3 = -2 (moved up in B)
      pair("s2", "pl1", "dismissed", 2, 1, 5), // delta = 5-1 = +4 (moved down in B)
    ];
    const diff = computeDiff(pairs, "A", "B");
    const s2 = diff.pairDeltas.find((p) => p.songId === "s2")!;
    const s1 = diff.pairDeltas.find((p) => p.songId === "s1")!;
    expect(s1.delta).toBe(-2);
    expect(s2.delta).toBe(4);
  });

  it("delta is null when either rank is null", () => {
    const pairs = [
      pair("s1", "pl1", "added", null, null, 3), // rankA null
      pair("s2", "pl1", "dismissed", null, 2, null), // rankB null
      pair("s3", "pl2", "added", null, null, null), // both null
    ];
    const diff = computeDiff(pairs, "A", "B");
    for (const pd of diff.pairDeltas) {
      expect(pd.delta).toBeNull();
    }
  });

  it("sorts biggest movers first by |delta| descending", () => {
    const pairs = [
      pair("s1", "pl1", "added", null, 1, 4), // delta=+3
      pair("s2", "pl2", "added", null, 5, 1), // delta=-4
      pair("s3", "pl3", "added", null, 2, 3), // delta=+1
    ];
    const diff = computeDiff(pairs, "A", "B");
    const deltas = diff.pairDeltas.map((p) => p.delta);
    // sorted by |delta| desc: 4, 3, 1
    expect(Math.abs(deltas[0]!)).toBe(4);
    expect(Math.abs(deltas[1]!)).toBe(3);
    expect(Math.abs(deltas[2]!)).toBe(1);
  });

  it("null-delta pairs come after non-null deltas", () => {
    const pairs = [
      pair("s1", "pl1", "added", null, 1, 4), // delta=+3
      pair("s2", "pl2", "added", null, null, 2), // null delta
    ];
    const diff = computeDiff(pairs, "A", "B");
    expect(diff.pairDeltas[0]!.delta).not.toBeNull();
    expect(diff.pairDeltas[1]!.delta).toBeNull();
  });

  it("null-delta pairs stable-sorted by playlistId then songId", () => {
    const pairs = [
      pair("s2", "plB", "added", null, null, 2),
      pair("s1", "plA", "added", null, 2, null),
      pair("s3", "plA", "added", null, null, null),
    ];
    const diff = computeDiff(pairs, "A", "B");
    const nullDeltaPairs = diff.pairDeltas.filter((p) => p.delta === null);
    // should be sorted: plA/s1, plA/s3, plB/s2
    expect(nullDeltaPairs[0]!.playlistId).toBe("plA");
    expect(nullDeltaPairs[0]!.songId).toBe("s1");
    expect(nullDeltaPairs[1]!.songId).toBe("s3");
    expect(nullDeltaPairs[2]!.playlistId).toBe("plB");
  });

  it("includes all fields in pairDelta rows", () => {
    const pairs = [pair("song1", "pl1", "added", 5, 2, 3)];
    const diff = computeDiff(pairs, "varA", "varB");
    const pd = diff.pairDeltas[0]!;
    expect(pd.songId).toBe("song1");
    expect(pd.playlistId).toBe("pl1");
    expect(pd.decision).toBe("added");
    expect(pd.servedRank).toBe(5);
    expect(pd.rankA).toBe(2);
    expect(pd.rankB).toBe(3);
    expect(pd.delta).toBe(1);
  });

  it("labelA and labelB are passed through to DiffResult", () => {
    const diff = computeDiff([], "myA", "myB");
    expect(diff.labelA).toBe("myA");
    expect(diff.labelB).toBe("myB");
  });

  it("metricsA and metricsB reflect the correct variant columns", () => {
    const pairs = [
      pair("a1", "pl1", "added", null, 1, 10),
      pair("d1", "pl1", "dismissed", null, 10, 1),
    ];
    const diff = computeDiff(pairs, "A", "B");
    // A: added=1, dismissed=10 → win
    expect(diff.metricsA.wins).toBe(1);
    // B: added=10, dismissed=1 → loss
    expect(diff.metricsB.losses).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// formatDiffTable
// ---------------------------------------------------------------------------

describe("formatDiffTable", () => {
  it("returns a non-empty string", () => {
    const pairs = [
      pair("song1", "playlist1", "added", 2, 1, 3),
      pair("song2", "playlist1", "dismissed", 3, 4, 2),
    ];
    const diff = computeDiff(pairs, "varA", "varB");
    const table = formatDiffTable(diff);
    expect(typeof table).toBe("string");
    expect(table.length).toBeGreaterThan(0);
  });

  it("includes labelA and labelB in the output", () => {
    const diff = computeDiff([], "config-prod", "config-test");
    const table = formatDiffTable(diff);
    expect(table).toContain("config-prod");
    expect(table).toContain("config-test");
  });

  it("includes metric names in the output", () => {
    const diff = computeDiff([], "A", "B");
    const table = formatDiffTable(diff);
    expect(table).toContain("Pairwise win rate");
    expect(table).toContain("MRR");
    expect(table).toContain("nDCG@10");
    expect(table).toContain("Added fell-out");
  });

  it("includes songId and playlistId in delta rows", () => {
    const pairs = [pair("mysong", "myplaylist", "added", null, 1, 5)];
    const diff = computeDiff(pairs, "A", "B");
    const table = formatDiffTable(diff);
    expect(table).toContain("mysong");
    expect(table).toContain("myplaylist");
  });

  it("shows — for null ranks", () => {
    const pairs = [pair("s1", "pl1", "added", null, null, 3)];
    const diff = computeDiff(pairs, "A", "B");
    const table = formatDiffTable(diff);
    expect(table).toContain("—");
  });

  it("handles empty pairs list without throwing", () => {
    const diff = computeDiff([], "A", "B");
    expect(() => formatDiffTable(diff)).not.toThrow();
  });

  it("prints the directional small-n warning below 200 trials", () => {
    const pairs = [
      pair("a1", "pl1", "added", null, 1, 2),
      pair("d1", "pl1", "dismissed", null, 3, 4),
    ];
    const diff = computeDiff(pairs, "A", "B");
    const table = formatDiffTable(diff);
    expect(table).toContain("DIRECTIONAL ONLY");
    expect(table).toContain("position bias");
  });
});

// ---------------------------------------------------------------------------
// buildResultJson
// ---------------------------------------------------------------------------

describe("buildResultJson", () => {
  it("includes required top-level fields", () => {
    const diff = computeDiff([], "prodA", "prodB");
    const result = buildResultJson(diff, { runId: "run-001", timestamp: "2026-06-10T00:00:00Z" }) as Record<string, unknown>;
    expect(result).toHaveProperty("labelA", "prodA");
    expect(result).toHaveProperty("labelB", "prodB");
    expect(result).toHaveProperty("caveats");
    expect(result).toHaveProperty("pairCounts");
    expect(result).toHaveProperty("metricsA");
    expect(result).toHaveProperty("metricsB");
    expect(result).toHaveProperty("pairDeltas");
    expect(result).toHaveProperty("runId", "run-001");
    expect(result).toHaveProperty("timestamp", "2026-06-10T00:00:00Z");
  });

  it("caveats field is an array with position-bias warning", () => {
    const diff = computeDiff([], "A", "B");
    const result = buildResultJson(diff) as Record<string, unknown>;
    const caveats = result["caveats"] as string[];
    expect(Array.isArray(caveats)).toBe(true);
    expect(caveats.some((c) => /position bias/i.test(c) || /served ranking/i.test(c))).toBe(true);
  });

  it("pairCounts includes total, added, and dismissed counts", () => {
    const pairs = [
      pair("a1", "pl1", "added", null, 1, 2),
      pair("d1", "pl1", "dismissed", null, 3, 4),
      pair("a2", "pl2", "added", null, 1, 1),
    ];
    const diff = computeDiff(pairs, "A", "B");
    const result = buildResultJson(diff) as Record<string, unknown>;
    const counts = result["pairCounts"] as Record<string, number>;
    expect(counts["total"]).toBe(3);
    expect(counts["addedA"]).toBe(2);
    expect(counts["dismissedA"]).toBe(1);
  });

  it("is JSON-serializable (no functions, no undefined)", () => {
    const pairs = [
      pair("s1", "pl1", "added", 2, 1, null),
      pair("d1", "pl1", "dismissed", 1, null, 3),
    ];
    const diff = computeDiff(pairs, "A", "B");
    const result = buildResultJson(diff, { notes: "test run" });
    expect(() => JSON.stringify(result)).not.toThrow();
    const roundTripped = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    expect(roundTripped).toHaveProperty("labelA");
  });

  it("uses default timestamp when not provided", () => {
    const diff = computeDiff([], "A", "B");
    const result = buildResultJson(diff) as Record<string, unknown>;
    expect(typeof result["timestamp"]).toBe("string");
    expect(result["timestamp"]).toBeTruthy();
  });

  it("sets runId and notes to null when not provided", () => {
    const diff = computeDiff([], "A", "B");
    const result = buildResultJson(diff) as Record<string, unknown>;
    expect(result["runId"]).toBeNull();
    expect(result["notes"]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration: full end-to-end with hand-computed fixture
// ---------------------------------------------------------------------------

describe("end-to-end: hand-computed fixture", () => {
  // Two playlists, 3 added + 3 dismissed with known ranks
  //
  // pl1:
  //   added:     s1@rank1, s2@rank3
  //   dismissed: d1@rank2, d2@rank5
  //   Pairs (A metric):
  //     s1(1) vs d1(2) → win
  //     s1(1) vs d2(5) → win
  //     s2(3) vs d1(2) → loss
  //     s2(3) vs d2(5) → win
  //   wins=3, losses=1
  //
  // pl2:
  //   added:     s3@null (fell out)
  //   dismissed: d3@rank4
  //   Pairs: s3(Inf) vs d3(4) → loss
  //   wins=0, losses=1
  //
  // Total: wins=3, losses=2, ties=0
  // pairwiseWinRate = 3/5 = 0.6
  // addedFellOutPct = 1/3 * 100 ≈ 33.33%
  // MRR = (1/1 + 1/3 + 0) / 3 = (1 + 0.333 + 0) / 3 ≈ 0.444
  // nDCG@10:
  //   pl1: ideal for 2 added items at rank 1,3 → 1/log2(2) + 1/log2(4) = 1 + 0.5 = 1.5
  //        actual: same = 1.5 → nDCG=1
  //   pl2: ideal = 0 (added fell out, rank > 10) → nDCG=0, playlist counted
  //   avg nDCG = (1 + 0) / 2 = 0.5

  const pairs: DecidedPairRanks[] = [
    pair("s1", "pl1", "added", 1, 1, 5),
    pair("s2", "pl1", "added", 3, 3, 2),
    pair("s3", "pl2", "added", null, null, 1),
    pair("d1", "pl1", "dismissed", 2, 2, 8),
    pair("d2", "pl1", "dismissed", 5, 5, 7),
    pair("d3", "pl2", "dismissed", 4, 4, 3),
  ];

  it("pairwise win rate A = 3/5 = 0.6", () => {
    const m = computeVariantMetrics(pairs, "A");
    expect(m.wins).toBe(3);
    expect(m.losses).toBe(2);
    expect(m.ties).toBe(0);
    expect(m.pairwiseWinRate).toBeCloseTo(0.6, 5);
  });

  it("addedFellOutPct A = 33.33%", () => {
    const m = computeVariantMetrics(pairs, "A");
    expect(m.addedFellOutPct).toBeCloseTo(33.333, 2);
  });

  it("MRR A ≈ 0.444", () => {
    const m = computeVariantMetrics(pairs, "A");
    const expected = (1 / 1 + 1 / 3 + 0) / 3;
    expect(m.mrr).toBeCloseTo(expected, 5);
  });

  it("nDCG@10 A ≈ 0.4599 (macro-avg of pl1≈0.9197 and pl2=0)", () => {
    // pl1: added at ranks 1, 3
    //   actual DCG  = 1/log2(2) + 1/log2(4) = 1.0 + 0.5 = 1.5
    //   ideal DCG   = 1/log2(2) + 1/log2(3) ≈ 1.6309  (2 items at ideal positions 1, 2)
    //   nDCG pl1    = 1.5 / 1.6309 ≈ 0.9197
    // pl2: added@null → idealDCG=0 → nDCG=0, playlist still counted
    //   avg nDCG = (0.9197 + 0) / 2 ≈ 0.4599
    const m = computeVariantMetrics(pairs, "A");
    expect(m.ndcg10).toBeCloseTo((1.5 / (1 / Math.log2(2) + 1 / Math.log2(3))) / 2, 5);
  });

  it("diff delta table contains all 6 pairs", () => {
    const diff = computeDiff(pairs, "A", "B");
    expect(diff.pairDeltas).toHaveLength(6);
  });

  it("s1 delta = rankB - rankA = 5 - 1 = 4", () => {
    const diff = computeDiff(pairs, "A", "B");
    const s1 = diff.pairDeltas.find((p) => p.songId === "s1")!;
    expect(s1.delta).toBe(4);
  });

  it("s3 delta is null (rankA is null)", () => {
    const diff = computeDiff(pairs, "A", "B");
    const s3 = diff.pairDeltas.find((p) => p.songId === "s3")!;
    expect(s3.delta).toBeNull();
  });
});
