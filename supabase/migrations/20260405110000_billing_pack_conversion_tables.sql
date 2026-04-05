-- S1-02: Pack & Conversion Tables Migration
-- Create tables that track purchased pack value and upgrade-conversion lifecycle

-- 1. pack_credit_lot table
CREATE TABLE pack_credit_lot (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  stripe_event_id   TEXT NOT NULL UNIQUE,
  offer_id          TEXT NOT NULL,
  original_credits  INTEGER NOT NULL CHECK (original_credits > 0),
  remaining_credits INTEGER NOT NULL
                    CHECK (remaining_credits >= 0 AND remaining_credits <= original_credits),
  price_cents       INTEGER NOT NULL CHECK (price_cents > 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pack_credit_lot_account_open
  ON pack_credit_lot(account_id, created_at)
  WHERE remaining_credits > 0;

-- 2. subscription_credit_conversion table
CREATE TABLE subscription_credit_conversion (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  checkout_session_id   TEXT,
  target_plan           TEXT NOT NULL
                        CHECK (target_plan IN ('quarterly', 'yearly')),
  status                TEXT NOT NULL
                        CHECK (status IN ('pending', 'applied', 'released', 'reversed')),
  converted_credits     INTEGER NOT NULL CHECK (converted_credits >= 0),
  discount_cents        INTEGER NOT NULL CHECK (discount_cents >= 0),
  stripe_subscription_id TEXT,
  stripe_invoice_id     TEXT,
  applied_stripe_event_id TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscription_credit_conversion_account
  ON subscription_credit_conversion(account_id, created_at DESC);

CREATE UNIQUE INDEX idx_subscription_credit_conversion_checkout_session
  ON subscription_credit_conversion(checkout_session_id)
  WHERE checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX idx_subscription_credit_conversion_pending_per_account
  ON subscription_credit_conversion(account_id)
  WHERE status = 'pending';

-- 3. subscription_credit_conversion_allocation table
CREATE TABLE subscription_credit_conversion_allocation (
  conversion_id           UUID NOT NULL REFERENCES subscription_credit_conversion(id) ON DELETE CASCADE,
  pack_credit_lot_id      UUID NOT NULL REFERENCES pack_credit_lot(id) ON DELETE CASCADE,
  reserved_credits        INTEGER NOT NULL CHECK (reserved_credits > 0),
  reserved_discount_cents INTEGER NOT NULL CHECK (reserved_discount_cents >= 0),
  PRIMARY KEY (conversion_id, pack_credit_lot_id)
);

CREATE INDEX idx_subscription_credit_conversion_allocation_lot
  ON subscription_credit_conversion_allocation(pack_credit_lot_id);

-- 4. RLS policies
-- Enable RLS (service_role bypasses)
ALTER TABLE pack_credit_lot ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_credit_conversion ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_credit_conversion_allocation ENABLE ROW LEVEL SECURITY;

-- RLS policies (deny direct anon/authenticated access, managed via service_role)
CREATE POLICY "pack_credit_lot_deny_all" ON pack_credit_lot FOR ALL USING (false);
CREATE POLICY "subscription_credit_conversion_deny_all" ON subscription_credit_conversion FOR ALL USING (false);
CREATE POLICY "subscription_credit_conversion_allocation_deny_all" ON subscription_credit_conversion_allocation FOR ALL USING (false);

-- 5. Updated timestamp trigger
-- Auto-update updated_at timestamp for subscription_credit_conversion (has updated_at column)
CREATE TRIGGER subscription_credit_conversion_updated_at
  BEFORE UPDATE ON subscription_credit_conversion
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();