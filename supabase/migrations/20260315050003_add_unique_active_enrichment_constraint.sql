-- Prevent duplicate active enrichment chains per account.
-- The read-then-insert pattern in getOrCreateEnrichmentJob() is racy under
-- concurrent sync/onboarding triggers.  This partial unique index makes the
-- database the single source of truth for "one active chain at a time."

CREATE UNIQUE INDEX idx_unique_active_enrichment_per_account
  ON job (account_id)
  WHERE type = 'enrichment' AND status IN ('pending', 'running');
