-- Library processing state: one row per account for durable workflow freshness.
-- Flattened typed columns for enrichment and matchSnapshotRefresh workflows.

CREATE TABLE library_processing_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,

  -- enrichment workflow freshness
  enrichment_requested_at TIMESTAMPTZ,
  enrichment_settled_at TIMESTAMPTZ,
  enrichment_active_job_id UUID REFERENCES job(id) ON DELETE SET NULL,

  -- match snapshot refresh workflow freshness
  match_snapshot_refresh_requested_at TIMESTAMPTZ,
  match_snapshot_refresh_settled_at TIMESTAMPTZ,
  match_snapshot_refresh_active_job_id UUID REFERENCES job(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,

  UNIQUE(account_id)
);

CREATE INDEX idx_library_processing_state_account
  ON library_processing_state(account_id);

ALTER TABLE library_processing_state ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER library_processing_state_updated_at
  BEFORE UPDATE ON library_processing_state
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
