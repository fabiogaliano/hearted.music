-- Match deck read-model follow-up N4: restore index support for the
-- claim_pending_match_review_deck_job priority ORDER BY added in
-- 20260706000011_deck_job_mark_dead_lease_and_claim_priority.sql.
--
-- The original pending poll index only covered (available_at, created_at)
-- WHERE status = 'pending'. Once claim ordering started leading with the
-- CASE kind-priority expression, Postgres had to materialize + sort pending
-- rows instead of walking an already-ordered index. This expression index
-- matches the claim function's ORDER BY exactly so live capture_ahead jobs keep
-- their priority without paying a queue-depth sort penalty.

CREATE INDEX idx_match_review_deck_job_pending_claim_priority
  ON public.match_review_deck_job (
    (
      CASE kind
        WHEN 'capture_ahead' THEN 0
        WHEN 'append_sessions' THEN 1
        WHEN 'build_proposals' THEN 2
        WHEN 'repair' THEN 2
        ELSE 3
      END
    ),
    available_at ASC,
    created_at ASC
  )
  WHERE status = 'pending';
