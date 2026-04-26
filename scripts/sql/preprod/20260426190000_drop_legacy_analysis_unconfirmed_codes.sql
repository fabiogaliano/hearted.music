-- !!! MANUAL PREPROD-ONLY OPERATION — NEVER RUN IN PRODUCTION !!!
--
-- This script is intentionally NOT part of supabase/migrations so it cannot
-- be picked up by `supabase migration up` or any shared CI/CD migrate chain.
-- Run it by hand against a preprod database only — see the runbook in
-- claudedocs/runbook-drop-legacy-analysis-codes.md.
--
-- Hard-deletes obsolete `analysis_inputs_unconfirmed_*` rows from job_failure.
-- Safe in preprod because:
--   * The selector uses lifecycle semantics (suppress_until / resolved_at)
--     and is failure_code-agnostic — historical codes do not affect it.
--   * Stage handlers no longer write these codes; they were renamed to
--     `analysis_blocked_*_unavailable`.
--   * Preprod databases can be reseeded; production cannot.
--
-- Scope is narrow: only the three obsolete codes; nothing else is touched.

DELETE FROM job_failure
WHERE failure_code IN (
  'analysis_inputs_unconfirmed_lyrics',
  'analysis_inputs_unconfirmed_audio',
  'analysis_inputs_unconfirmed_both'
);
