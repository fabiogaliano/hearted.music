-- Decision-log enrichment (matching roadmap #6): tie each add/dismiss to the
-- exact ranking the user saw, so offline replay can reconstruct what was shown
-- and what was chosen vs. rejected.
--
--   snapshot_id — FK to the immutable match_snapshot that produced the ranking.
--     This is the load-bearing field. recall@k / MRR need the FULL served list
--     (including the items NOT chosen), which lives in match_result keyed by this
--     snapshot_id — so we reference the source of truth rather than copying
--     scores onto the decision. Resolve per-decision factor features via the
--     match_result join on (snapshot_id, song_id, playlist_id).
--
--   served_rank — the position this (song, playlist) held in that snapshot,
--     denormalized from match_result.rank. NULL is MEANINGFUL, not missing data:
--     a dismissal that resolves to a match_result is a SURFACED negative (the
--     user rejected a real suggestion at served_rank R — the hard negative
--     learned-weights work wants); a dismissal with NULL served_rank is an
--     IMPLICIT negative (the song was never top-K for that playlist, weak signal).
--     The replay runner can query the two apart on (snapshot_id IS NOT NULL,
--     served_rank IS NULL/NOT NULL).
--
-- Both are nullable: the write path degrades to NULL when the served snapshot
-- can't be resolved (no snapshot, stale/forged id, lookup failure), so logging
-- the ranking context never blocks the user's add/dismiss. Existing throwaway
-- decisions get NULL on both columns.

ALTER TABLE match_decision
  ADD COLUMN snapshot_id UUID REFERENCES match_snapshot(id),
  ADD COLUMN served_rank INTEGER;

-- ON DELETE is intentionally NO ACTION (not cascade / not set-null): a snapshot
-- referenced by a decision is what the user actually saw and MUST stay immutable.
-- If a snapshot retention/GC policy is ever introduced, it MUST exclude snapshots
-- referenced by match_decision — delete the referencing decisions first (this is
-- already the order scripts/reset-onboarding.ts follows).

CREATE INDEX idx_match_decision_snapshot ON match_decision(snapshot_id);

-- Future debiasing lever (deferred — produces ZERO signal without real traffic,
-- so it would be dead code now): ~5% rank jitter behind a flag at serve time
-- would let propensity estimation correct for position bias. served_rank above is
-- the free, future-enabling half (propensity estimation needs the logged
-- position); the jitter waits for real users.
