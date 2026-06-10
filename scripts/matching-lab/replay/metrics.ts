/**
 * metrics.ts — Pure metric and diff functions for the offline replay runner.
 *
 * ## Exported API
 *
 * Types:
 *   Decision = "added" | "dismissed"
 *   DecidedPairRanks { songId, playlistId, decision, servedRank, rankA, rankB }
 *   VariantMetrics   { pairwiseWinRate, wins, losses, ties, comparablePairs,
 *                      pValue, meanRankAdded, medianRankAdded, meanRankDismissed,
 *                      mrr, ndcg10, addedFellOutPct, addedCount, dismissedCount }
 *   PairDelta        { songId, playlistId, decision, servedRank, rankA, rankB, delta }
 *   DiffResult       { labelA, labelB, metricsA, metricsB, pairDeltas }
 *   BuildResultJsonMeta { runId?, timestamp?, notes? }
 *
 * Functions:
 *   computeVariantMetrics(pairs: DecidedPairRanks[], which: "A" | "B"): VariantMetrics
 *   computeDiff(pairs: DecidedPairRanks[], labelA: string, labelB: string): DiffResult
 *   formatDiffTable(diff: DiffResult): string
 *   buildResultJson(diff: DiffResult, meta: BuildResultJsonMeta): object
 *
 * ## Null-rank rules
 *
 *   A null rank means the item fell below threshold / out of the top-K cutoff for that
 *   variant. This is a real signal (the config couldn't surface that item at all).
 *
 *   Pairwise comparison:
 *     • added.rank ?? +∞  vs  dismissed.rank ?? +∞
 *     • lower number wins (rank 1 = best)
 *     • if both are null (both +∞) → tie → excluded from trial count
 *
 *   Rank stats (mean, median):
 *     • computed only over non-null ranks
 *     • addedFellOutPct = (added pairs with null rank) / (total added pairs) * 100
 *
 *   MRR:
 *     • null rank → reciprocal rank = 0 (contributes nothing to the average)
 *
 *   nDCG@10:
 *     • items with null rank or rank > 10 contribute 0 gain
 *     • per-playlist: ideal DCG uses only added items up to rank 10
 *     • if no added items exist for a playlist, that playlist is skipped
 *
 *   Delta (PairDelta):
 *     • delta = rankB − rankA (negative = moved up in B, positive = moved down in B)
 *     • null − number = null; number − null = null; null − null = null
 *     • "biggest mover" sort: pairs with non-null delta sorted by |delta| descending;
 *       pairs with null delta appended last (tied, sorted by songId+playlistId for stability)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Decision = "added" | "dismissed";

export interface DecidedPairRanks {
  songId: string;
  playlistId: string;
  decision: Decision;
  /** Rank under the originally served snapshot (reference; may be null if not recorded) */
  servedRank: number | null;
  /** Rank under variant A config (null = fell out of threshold/top-K) */
  rankA: number | null;
  /** Rank under variant B config (null = fell out of threshold/top-K) */
  rankB: number | null;
}

export interface VariantMetrics {
  /** Fraction of comparable (added, dismissed) pairs where added ranks above dismissed */
  pairwiseWinRate: number;
  /** Raw counts for pairwise comparison */
  wins: number;
  losses: number;
  ties: number;
  /** Total (added, dismissed) pairs within the same playlist considered */
  comparablePairs: number;
  /**
   * Two-sided binomial p-value (H0: p = 0.5) over win/loss trials (ties excluded).
   * NaN when there are 0 win+loss trials.
   */
  pValue: number;
  /** Mean rank of added items (null ranks excluded); null if no non-null ranks */
  meanRankAdded: number | null;
  /** Median rank of added items (null ranks excluded); null if no non-null ranks */
  medianRankAdded: number | null;
  /** Mean rank of dismissed items (null ranks excluded); null if no non-null ranks */
  meanRankDismissed: number | null;
  /** Mean Reciprocal Rank over added items (null rank → reciprocal = 0) */
  mrr: number;
  /** nDCG@10 averaged over playlists (added=1, dismissed=0; null or >10 rank → 0 gain) */
  ndcg10: number;
  /** Percentage of added pairs whose rank is null (fell below threshold) */
  addedFellOutPct: number;
  addedCount: number;
  dismissedCount: number;
}

export interface PairDelta {
  songId: string;
  playlistId: string;
  decision: Decision;
  servedRank: number | null;
  rankA: number | null;
  rankB: number | null;
  /** rankB − rankA; null when either rank is null */
  delta: number | null;
}

export interface DiffResult {
  labelA: string;
  labelB: string;
  metricsA: VariantMetrics;
  metricsB: VariantMetrics;
  /** Per-pair delta table, sorted biggest-mover first */
  pairDeltas: PairDelta[];
}

export interface BuildResultJsonMeta {
  runId?: string;
  timestamp?: string;
  notes?: string;
  /** Provider that served reranking (e.g. "deepinfra", "local", "huggingface") */
  rerankerProvider?: string;
  /** Model used for reranking (null when reranking was unavailable) */
  rerankerModel?: string | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function pickRank(pair: DecidedPairRanks, which: "A" | "B"): number | null {
  return which === "A" ? pair.rankA : pair.rankB;
}

/** log2(1 + n), pre-computed discount denominator for nDCG */
function discountDenom(rank: number): number {
  return Math.log2(1 + rank);
}

/**
 * Two-sided exact binomial p-value (H0: p = 0.5).
 * Uses the normal approximation with continuity correction when n > 30,
 * exact summation otherwise.
 *
 * Ties are excluded from n before calling this — n = wins + losses only.
 */
function binomialPValue(wins: number, n: number): number {
  if (n === 0) return NaN;
  // Exact two-sided p-value: sum P(X = k) for all k where P(X=k) ≤ P(X=wins)
  // P(X=k) = C(n,k) * 0.5^n
  const target = binomialPmf(wins, n);
  let p = 0;
  for (let k = 0; k <= n; k++) {
    const pmf = binomialPmf(k, n);
    if (pmf <= target + 1e-10) {
      p += pmf;
    }
  }
  // cap floating-point drift
  return Math.min(1, p);
}

/**
 * Exact binomial PMF: C(n,k) * 0.5^n computed in log-space to avoid overflow.
 */
function binomialPmf(k: number, n: number): number {
  // log C(n,k) + n * log(0.5)
  return Math.exp(logBinom(n, k) - n * Math.LN2);
}

/** log C(n,k) via log-gamma (Stirling-stable for large n) */
function logBinom(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  if (k === 0 || k === n) return 0;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

/**
 * Natural log of Gamma(n) for positive integers via log-factorial (exact).
 * For n > 1000 falls back to Stirling for safety, though that range won't appear here.
 */
function logGamma(n: number): number {
  // Γ(n) = (n-1)! for positive integers; use log-factorial table
  let sum = 0;
  for (let i = 2; i < n; i++) sum += Math.log(i);
  return sum;
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : ((sorted[mid - 1]! + sorted[mid]!) / 2);
}

// ---------------------------------------------------------------------------
// computeVariantMetrics
// ---------------------------------------------------------------------------

/**
 * Compute all variant-level metrics for the given rank column (A or B).
 *
 * @param pairs  All decided pairs with rankA/rankB filled by the runner.
 * @param which  Which rank column to evaluate ("A" or "B").
 */
export function computeVariantMetrics(
  pairs: DecidedPairRanks[],
  which: "A" | "B",
): VariantMetrics {
  // Group by playlist for pairwise comparisons and nDCG
  const byPlaylist = new Map<string, DecidedPairRanks[]>();
  for (const p of pairs) {
    const bucket = byPlaylist.get(p.playlistId) ?? [];
    bucket.push(p);
    byPlaylist.set(p.playlistId, bucket);
  }

  // --- Pairwise win rate ---
  let wins = 0;
  let losses = 0;
  let ties = 0;

  for (const bucket of byPlaylist.values()) {
    const added = bucket.filter((p) => p.decision === "added");
    const dismissed = bucket.filter((p) => p.decision === "dismissed");
    for (const a of added) {
      for (const d of dismissed) {
        const ra = pickRank(a, which) ?? Infinity;
        const rd = pickRank(d, which) ?? Infinity;
        if (ra === Infinity && rd === Infinity) {
          // both null → tie excluded from trial count (not counted as tie here)
          // We still track it separately to report comparablePairs correctly
          ties++;
        } else if (ra < rd) {
          wins++;
        } else if (ra > rd) {
          losses++;
        } else {
          ties++;
        }
      }
    }
  }

  const comparablePairs = wins + losses + ties;
  const trials = wins + losses; // ties excluded from binomial
  const pairwiseWinRate = trials > 0 ? wins / trials : 0;
  const pValue = binomialPValue(wins, trials);

  // --- Rank stats for added ---
  const addedPairs = pairs.filter((p) => p.decision === "added");
  const dismissedPairs = pairs.filter((p) => p.decision === "dismissed");

  const addedRanks = addedPairs
    .map((p) => pickRank(p, which))
    .filter((r): r is number => r !== null)
    .sort((a, b) => a - b);

  const dismissedRanks = dismissedPairs
    .map((p) => pickRank(p, which))
    .filter((r): r is number => r !== null);

  const meanRankAdded =
    addedRanks.length > 0
      ? addedRanks.reduce((s, r) => s + r, 0) / addedRanks.length
      : null;

  const medianRankAdded = median(addedRanks);

  const meanRankDismissed =
    dismissedRanks.length > 0
      ? dismissedRanks.reduce((s, r) => s + r, 0) / dismissedRanks.length
      : null;

  // --- MRR (added items only; null rank → 0) ---
  const mrr =
    addedPairs.length > 0
      ? addedPairs.reduce((sum, p) => {
          const r = pickRank(p, which);
          return sum + (r !== null ? 1 / r : 0);
        }, 0) / addedPairs.length
      : 0;

  // --- nDCG@10 per playlist, then averaged ---
  let ndcg10Sum = 0;
  let ndcg10PlaylistCount = 0;

  for (const bucket of byPlaylist.values()) {
    const bucketAdded = bucket.filter((p) => p.decision === "added");
    if (bucketAdded.length === 0) continue; // no added items → skip playlist

    // Build ideal: the best achievable DCG for this playlist is placing all
    // added items (that appeared in top-10) at consecutive positions starting
    // at rank 1.  We sort them by actual rank to identify which ones qualify,
    // then discount at ideal positions 1, 2, 3… (standard TREC nDCG).
    const addedWithRank = bucketAdded
      .map((p) => ({ rank: pickRank(p, which) }))
      .filter((x): x is { rank: number } => x.rank !== null && x.rank <= 10)
      .sort((a, b) => a.rank - b.rank);

    // Ideal: each qualifying item placed at its ordinal position (1-indexed)
    const idealDCG = addedWithRank
      .slice(0, 10)
      .reduce((s, _item, idx) => s + 1 / discountDenom(idx + 1), 0);

    if (idealDCG === 0) {
      // All added items fell out of top-10 for this playlist → nDCG = 0
      ndcg10Sum += 0;
      ndcg10PlaylistCount++;
      continue;
    }

    // Actual DCG: score every item in the bucket at its rank
    // added = gain 1, dismissed = gain 0 (so only added items contribute)
    const actualDCG = bucket.reduce((s, p) => {
      if (p.decision !== "added") return s;
      const r = pickRank(p, which);
      if (r === null || r > 10) return s;
      return s + 1 / discountDenom(r);
    }, 0);

    ndcg10Sum += actualDCG / idealDCG;
    ndcg10PlaylistCount++;
  }

  const ndcg10 = ndcg10PlaylistCount > 0 ? ndcg10Sum / ndcg10PlaylistCount : 0;

  // --- addedFellOutPct ---
  const addedFellOutCount = addedPairs.filter(
    (p) => pickRank(p, which) === null,
  ).length;
  const addedFellOutPct =
    addedPairs.length > 0 ? (addedFellOutCount / addedPairs.length) * 100 : 0;

  return {
    pairwiseWinRate,
    wins,
    losses,
    ties,
    comparablePairs,
    pValue,
    meanRankAdded,
    medianRankAdded,
    meanRankDismissed,
    mrr,
    ndcg10,
    addedFellOutPct,
    addedCount: addedPairs.length,
    dismissedCount: dismissedPairs.length,
  };
}

// ---------------------------------------------------------------------------
// computeDiff
// ---------------------------------------------------------------------------

/**
 * Compute per-variant metrics and a per-pair delta table.
 *
 * Delta sign convention: delta = rankB − rankA.
 *   Negative delta → item moved up (lower rank number) in B → B is better for that item.
 *   Positive delta → item moved down in B.
 *
 * Null delta: either rank is null.
 *
 * Sort order: non-null deltas by |delta| descending (biggest movers first),
 *   then null-delta pairs appended, sorted by playlistId + songId for stability.
 */
export function computeDiff(
  pairs: DecidedPairRanks[],
  labelA: string,
  labelB: string,
): DiffResult {
  const metricsA = computeVariantMetrics(pairs, "A");
  const metricsB = computeVariantMetrics(pairs, "B");

  const pairDeltas: PairDelta[] = pairs.map((p) => ({
    songId: p.songId,
    playlistId: p.playlistId,
    decision: p.decision,
    servedRank: p.servedRank,
    rankA: p.rankA,
    rankB: p.rankB,
    delta:
      p.rankA !== null && p.rankB !== null ? p.rankB - p.rankA : null,
  }));

  pairDeltas.sort((a, b) => {
    if (a.delta !== null && b.delta !== null) {
      return Math.abs(b.delta) - Math.abs(a.delta);
    }
    if (a.delta !== null) return -1;
    if (b.delta !== null) return 1;
    // both null: stable sort by playlist then song
    const pl = a.playlistId.localeCompare(b.playlistId);
    return pl !== 0 ? pl : a.songId.localeCompare(b.songId);
  });

  return { labelA, labelB, metricsA, metricsB, pairDeltas };
}

// ---------------------------------------------------------------------------
// formatDiffTable
// ---------------------------------------------------------------------------

function fmt(n: number | null, decimals = 3): string {
  if (n === null) return "—";
  return n.toFixed(decimals);
}

function fmtPct(n: number): string {
  return n.toFixed(1) + "%";
}

function fmtRank(n: number | null): string {
  return n === null ? "—" : String(n);
}

function col(s: string, width: number): string {
  return s.slice(0, width).padEnd(width);
}

/**
 * Render a console-friendly ASCII diff table.
 *
 * Layout:
 *   1. Variant summary (metric rows, A vs B columns)
 *   2. Top-20 biggest movers (delta table)
 */
export function formatDiffTable(diff: DiffResult): string {
  const { labelA, labelB, metricsA, metricsB, pairDeltas } = diff;

  const lines: string[] = [];

  // --- Header ---
  lines.push("");
  lines.push("=".repeat(72));
  lines.push(
    `  Replay diff: ${labelA}  vs  ${labelB}`,
  );
  lines.push("=".repeat(72));

  // --- Metric summary ---
  const labelACol = col(labelA, 16);
  const labelBCol = col(labelB, 16);
  const metricHeader = `  ${"Metric".padEnd(28)}  ${labelACol}  ${labelBCol}`;
  lines.push("");
  lines.push(metricHeader);
  lines.push("  " + "-".repeat(68));

  function metricRow(label: string, a: string, b: string): string {
    return `  ${label.padEnd(28)}  ${col(a, 16)}  ${col(b, 16)}`;
  }

  const trials_a = metricsA.wins + metricsA.losses;
  const trials_b = metricsB.wins + metricsB.losses;

  lines.push(
    metricRow(
      "Pairwise win rate",
      fmtPct(metricsA.pairwiseWinRate * 100),
      fmtPct(metricsB.pairwiseWinRate * 100),
    ),
  );
  lines.push(
    metricRow(
      "  wins / losses / ties",
      `${metricsA.wins}/${metricsA.losses}/${metricsA.ties}`,
      `${metricsB.wins}/${metricsB.losses}/${metricsB.ties}`,
    ),
  );
  lines.push(
    metricRow(
      "  comparable pairs",
      String(metricsA.comparablePairs),
      String(metricsB.comparablePairs),
    ),
  );
  lines.push(
    metricRow(
      "  binomial p-value",
      isNaN(metricsA.pValue) ? "NaN" : fmt(metricsA.pValue, 4),
      isNaN(metricsB.pValue) ? "NaN" : fmt(metricsB.pValue, 4),
    ),
  );
  lines.push(
    metricRow(
      "  trials (w+l)",
      String(trials_a),
      String(trials_b),
    ),
  );
  lines.push(metricRow("MRR (added)", fmt(metricsA.mrr), fmt(metricsB.mrr)));
  lines.push(
    metricRow("nDCG@10", fmt(metricsA.ndcg10), fmt(metricsB.ndcg10)),
  );
  lines.push(
    metricRow(
      "Mean rank (added)",
      fmt(metricsA.meanRankAdded),
      fmt(metricsB.meanRankAdded),
    ),
  );
  lines.push(
    metricRow(
      "Median rank (added)",
      fmtRank(metricsA.medianRankAdded),
      fmtRank(metricsB.medianRankAdded),
    ),
  );
  lines.push(
    metricRow(
      "Mean rank (dismissed)",
      fmt(metricsA.meanRankDismissed),
      fmt(metricsB.meanRankDismissed),
    ),
  );
  lines.push(
    metricRow(
      "Added fell-out %",
      fmtPct(metricsA.addedFellOutPct),
      fmtPct(metricsB.addedFellOutPct),
    ),
  );
  lines.push(
    metricRow(
      "Added / dismissed count",
      `${metricsA.addedCount}/${metricsA.dismissedCount}`,
      `${metricsB.addedCount}/${metricsB.dismissedCount}`,
    ),
  );

  // --- Per-pair delta table (top 20) ---
  const TOP_N = 20;
  const shown = pairDeltas.slice(0, TOP_N);

  lines.push("");
  lines.push(
    `  Biggest movers (top ${TOP_N} of ${pairDeltas.length} pairs):`,
  );
  lines.push("  " + "-".repeat(68));

  const dHdr =
    `  ${"songId".padEnd(22)}  ${"playlistId".padEnd(18)}  ${"dec".padEnd(9)}  ` +
    `${"srvd".padEnd(4)}  ${"rA".padEnd(4)}  ${"rB".padEnd(4)}  ${"Δ".padEnd(6)}`;
  lines.push(dHdr);
  lines.push("  " + "-".repeat(68));

  for (const p of shown) {
    const deltaStr = p.delta === null ? "—" : (p.delta > 0 ? "+" : "") + String(p.delta);
    lines.push(
      `  ${col(p.songId, 22)}  ${col(p.playlistId, 18)}  ${col(p.decision, 9)}  ` +
        `${fmtRank(p.servedRank).padEnd(4)}  ${fmtRank(p.rankA).padEnd(4)}  ` +
        `${fmtRank(p.rankB).padEnd(4)}  ${deltaStr.padEnd(6)}`,
    );
  }

  if (pairDeltas.length > TOP_N) {
    lines.push(`  ... and ${pairDeltas.length - TOP_N} more pairs`);
  }

  // Mirror the caveats baked into the result JSON so console-only readers see
  // them too — directional results have been over-read before.
  lines.push("");
  const maxTrials = Math.max(trials_a, trials_b);
  if (maxTrials < 200) {
    lines.push(
      `  ⚠ DIRECTIONAL ONLY: ${maxTrials} win/loss trials (< 200 judged pairs).`,
    );
    lines.push(
      `    Treat as signal, not ground truth — do not promote a config from this run.`,
    );
  }
  lines.push(
    `  ⚠ Labels were collected under the served ranking (position bias favors served-like configs).`,
  );

  lines.push("=".repeat(72));
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// buildResultJson
// ---------------------------------------------------------------------------

/**
 * Build a JSON-serializable result object for archiving to
 * `claudedocs/replay-results/<timestamp>-<labelA>-vs-<labelB>.json`.
 *
 * The `caveats` field is hard-coded position-bias documentation so every
 * saved result self-documents its directionality limitations.
 */
export function buildResultJson(
  diff: DiffResult,
  meta: BuildResultJsonMeta = {},
): object {
  return {
    runId: meta.runId ?? null,
    timestamp: meta.timestamp ?? new Date().toISOString(),
    notes: meta.notes ?? null,
    meta: {
      rerankerProvider: meta.rerankerProvider ?? null,
      rerankerModel: meta.rerankerModel ?? null,
    },
    labelA: diff.labelA,
    labelB: diff.labelB,
    caveats: [
      "Labels were collected under the served ranking; results favor served-like configs (position bias).",
      "Both variants replay over current song/profile data, not the original snapshot inputs — absolute metrics are indicative only; A-vs-B comparisons are fair.",
      "Results are directional only below ~200 judged pairs. Treat as signal, not ground truth.",
    ],
    pairCounts: {
      total: diff.pairDeltas.length,
      addedA: diff.metricsA.addedCount,
      dismissedA: diff.metricsA.dismissedCount,
      addedB: diff.metricsB.addedCount,
      dismissedB: diff.metricsB.dismissedCount,
    },
    metricsA: diff.metricsA,
    metricsB: diff.metricsB,
    pairDeltas: diff.pairDeltas,
  };
}
