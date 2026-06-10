-- Widen match_result.score / fused_score from REAL to DOUBLE PRECISION.
--
-- Both columns were REAL, but every publish_match_snapshot insert casts the JSON
-- value to DOUBLE PRECISION before storing — so Postgres narrowed it straight
-- back to single precision (~7 significant digits) on write, discarding the
-- precision the cast implied. Reads order by `score`
-- (taste/song-matching/queries.ts), and REAL collapses near-tied scores into
-- exact ties far more often than the doubles the matcher computed in JS,
-- producing unstable ordering between runs.
--
-- Widening makes the existing casts meaningful and preserves the precision the
-- ranking was computed at. Safe (widening) conversion; rebuilds the
-- (snapshot_id, score DESC) index. The table rewrite is acceptable — preprod
-- match_result rows are throwaway and re-populated by re-running matching.

ALTER TABLE match_result
  ALTER COLUMN score TYPE DOUBLE PRECISION,
  ALTER COLUMN fused_score TYPE DOUBLE PRECISION;
