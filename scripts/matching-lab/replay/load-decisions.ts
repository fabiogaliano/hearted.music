/**
 * load-decisions.ts — Decision dataset loader for the offline replay runner.
 *
 * Loads match_decision rows joined to match_snapshot (for provenance) and
 * groups them by account_id.  The snapshot join is a LEFT JOIN so decisions
 * without a linked snapshot still appear unless --require-snapshot is set.
 *
 * match_snapshot provenance columns used: config_hash, algorithm_version.
 * (Other columns — embedding_model, weights, etc. — are available but the
 * runner only needs the config identifier and version for logging.)
 */

import { createLocalLabClient } from "../shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DecisionRow {
  songId: string;
  playlistId: string;
  decision: "added" | "dismissed";
  servedRank: number | null;
  snapshotId: string | null;
  /** config_hash from the linked match_snapshot row, if present */
  configHash: string | null;
  /** algorithm_version from the linked match_snapshot row, if present */
  algorithmVersion: string | null;
}

export interface DecisionFilters {
  /** Only load decisions for this account */
  accountId?: string;
  /** Only load decisions decided at or after this ISO timestamp */
  since?: string;
  /** Drop rows with null snapshot_id (decisions made outside a tracked snapshot) */
  requireSnapshot?: boolean;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load match_decision rows joined to match_snapshot for provenance.
 *
 * Returns rows grouped by account_id.  The inner join to match_snapshot is
 * performed client-side after a LEFT JOIN fetch so we can selectively drop
 * snapshot-less rows without a DB-level JOIN that complicates PostgREST queries.
 */
export async function loadDecisions(
  filters: DecisionFilters = {},
): Promise<Map<string, DecisionRow[]>> {
  const supabase = createLocalLabClient();

  // Build base query — Supabase REST can embed the snapshot relation via
  // foreign key hint.  We use a simple select + manual join client-side to
  // keep the query readable and avoid PostgREST FK embedding edge cases.
  let query = supabase
    .from("match_decision")
    .select(
      "account_id, song_id, playlist_id, decision, served_rank, snapshot_id, decided_at",
    )
    .order("decided_at", { ascending: false });

  if (filters.accountId) {
    query = query.eq("account_id", filters.accountId);
  }

  if (filters.since) {
    query = query.gte("decided_at", filters.since);
  }

  const { data: decisions, error: dErr } = await query;
  if (dErr) throw new Error(`Failed to load match_decision: ${dErr.message}`);

  const rows = (decisions ?? []) as {
    account_id: string;
    song_id: string;
    playlist_id: string;
    decision: string;
    served_rank: number | null;
    snapshot_id: string | null;
    decided_at: string;
  }[];

  // Optionally drop rows without a snapshot_id
  const filtered = filters.requireSnapshot
    ? rows.filter((r) => r.snapshot_id !== null)
    : rows;

  if (filtered.length === 0) {
    return new Map();
  }

  // Batch-fetch referenced snapshots to add provenance columns
  const snapshotIds = [
    ...new Set(filtered.map((r) => r.snapshot_id).filter((id): id is string => id !== null)),
  ];

  const snapshotProvenance = new Map<
    string,
    { configHash: string; algorithmVersion: string }
  >();

  if (snapshotIds.length > 0) {
    const { data: snapshots, error: sErr } = await supabase
      .from("match_snapshot")
      .select("id, config_hash, algorithm_version")
      .in("id", snapshotIds);

    if (sErr) throw new Error(`Failed to load match_snapshot: ${sErr.message}`);

    for (const snap of snapshots ?? []) {
      snapshotProvenance.set(snap.id, {
        configHash: snap.config_hash,
        algorithmVersion: snap.algorithm_version,
      });
    }
  }

  // Group by account_id
  const byAccount = new Map<string, DecisionRow[]>();

  for (const r of filtered) {
    const prov = r.snapshot_id ? snapshotProvenance.get(r.snapshot_id) : undefined;

    const row: DecisionRow = {
      songId: r.song_id,
      playlistId: r.playlist_id,
      decision: r.decision as "added" | "dismissed",
      servedRank: r.served_rank,
      snapshotId: r.snapshot_id,
      configHash: prov?.configHash ?? null,
      algorithmVersion: prov?.algorithmVersion ?? null,
    };

    const bucket = byAccount.get(r.account_id) ?? [];
    bucket.push(row);
    byAccount.set(r.account_id, bucket);
  }

  return byAccount;
}
