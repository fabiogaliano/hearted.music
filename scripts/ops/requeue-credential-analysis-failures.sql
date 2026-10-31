-- Re-open songs whose analysis was terminally failed by a rejected LLM
-- credential (Vertex service account deleted, Jul–Oct 2026: 2,379 songs across
-- 9 accounts). The enrichment selector skips any song with a terminal failure
-- row regardless of resolved_at, so clearing is_terminal is what re-opens it;
-- the worker's idle-enrichment sweep then schedules the analysis.
--
-- Run only AFTER the replacement credential is live in prod, or every song just
-- fails again (now non-terminally, but it burns a retry window).
--
--   bun run prod:sql -f scripts/ops/requeue-credential-analysis-failures.sql --write
--
-- Idempotent: a second run matches nothing.

UPDATE job_item_failure
SET is_terminal = FALSE,
    resolved_at = now()
WHERE is_terminal = TRUE
  AND item_type = 'song'
  AND stage = 'song_analysis'
  AND failure_code = 'permanent'
  AND (
    error_message ILIKE '%invalid_grant%'
    OR error_message ~ 'failed \((401|403)\)'
  )
RETURNING id;
