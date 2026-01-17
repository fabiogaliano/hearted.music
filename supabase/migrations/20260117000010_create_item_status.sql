-- Create item_status table for tracking "new" status badges in UI

CREATE TABLE item_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  item_type item_type NOT NULL,  -- Uses item_type enum from job_failure migration
  item_id UUID NOT NULL,
  is_new BOOLEAN NOT NULL DEFAULT true,
  viewed_at TIMESTAMPTZ,
  actioned_at TIMESTAMPTZ,
  action_type TEXT,  -- 'added_to_playlist', 'skipped', 'dismissed'
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(account_id, item_type, item_id)
);

-- action_type values:
-- 'added_to_playlist' = item was added to a destination playlist
-- 'skipped' = user explicitly skipped this item
-- 'dismissed' = user dismissed the item from their queue

-- item_id references either song.id or playlist.id based on item_type
-- Note: We use UUID type and enforce referential integrity at app layer
-- rather than polymorphic FK to keep schema simple

-- Index for querying new items by account
CREATE INDEX idx_item_status_account_new ON item_status(account_id, is_new)
  WHERE is_new = true;

-- Index for querying by item
CREATE INDEX idx_item_status_item ON item_status(item_type, item_id);

-- Enable RLS (service_role bypasses)
ALTER TABLE item_status ENABLE ROW LEVEL SECURITY;

-- Auto-update updated_at timestamp
CREATE TRIGGER item_status_updated_at
  BEFORE UPDATE ON item_status
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
