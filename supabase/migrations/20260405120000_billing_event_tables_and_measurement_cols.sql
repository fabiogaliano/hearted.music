-- S1-03: Event/Idempotency Tables + Measurement Columns
-- Creates billing_webhook_event, billing_activation, billing_bridge_event tables
-- Adds measurement columns to song_analysis table

-- 1. billing_webhook_event table
CREATE TABLE billing_webhook_event (
  stripe_event_id TEXT PRIMARY KEY,
  status         TEXT NOT NULL 
                 CHECK (status IN ('processing', 'processed', 'failed')),
  processed_at   TIMESTAMPTZ,
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_billing_webhook_event_status_created 
  ON billing_webhook_event(status, created_at);

-- 2. billing_activation table
CREATE TABLE billing_activation (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                 UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  kind                       TEXT NOT NULL 
                             CHECK (kind IN ('unlimited_period_activated')),
  stripe_subscription_id     TEXT NOT NULL,
  subscription_period_end    TIMESTAMPTZ NOT NULL,
  stripe_event_id           TEXT NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(account_id, kind, stripe_subscription_id, subscription_period_end)
);

CREATE INDEX idx_billing_activation_account 
  ON billing_activation(account_id, created_at);

-- 3. billing_bridge_event table
CREATE TABLE billing_bridge_event (
  stripe_event_id TEXT PRIMARY KEY,
  event_kind      TEXT NOT NULL 
                  CHECK (event_kind IN (
                    'pack_fulfilled',
                    'unlimited_activated', 
                    'pack_reversed',
                    'unlimited_period_reversed',
                    'subscription_deactivated'
                  )),
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_billing_bridge_event_kind_processed 
  ON billing_bridge_event(event_kind, processed_at);

-- 4. Enable RLS on event tables (service_role bypasses)
ALTER TABLE billing_webhook_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_activation ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_bridge_event ENABLE ROW LEVEL SECURITY;

-- RLS policies (deny direct anon/authenticated access, managed via service_role)
CREATE POLICY "billing_webhook_event_deny_all" ON billing_webhook_event FOR ALL USING (false);
CREATE POLICY "billing_activation_deny_all" ON billing_activation FOR ALL USING (false);
CREATE POLICY "billing_bridge_event_deny_all" ON billing_bridge_event FOR ALL USING (false);

-- 5. Auto-update updated_at timestamp for billing_webhook_event
CREATE TRIGGER billing_webhook_event_updated_at
  BEFORE UPDATE ON billing_webhook_event
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 6. Add measurement columns to song_analysis
ALTER TABLE song_analysis 
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS input_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10, 8);