-- Create core billing tables for S1-01

-- Account billing state (one row per account in every deployment)
CREATE TABLE account_billing (
  account_id    UUID PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
  plan          TEXT NOT NULL DEFAULT 'free'
                  CHECK (plan IN ('free', 'quarterly', 'yearly')),
  credit_balance INTEGER NOT NULL DEFAULT 0
                  CHECK (credit_balance >= 0),
  unlimited_access_source TEXT
                  CHECK (unlimited_access_source IN ('subscription', 'self_hosted')),

  -- Stripe refs (null until first interaction)
  stripe_customer_id       TEXT UNIQUE,
  stripe_subscription_id   TEXT UNIQUE,
  subscription_status      TEXT NOT NULL DEFAULT 'none'
                  CHECK (subscription_status IN (
                    'none', 'active', 'past_due',
                    'canceled', 'unpaid', 'incomplete', 'incomplete_expired'
                  )),
  subscription_period_end  TIMESTAMPTZ,
  cancel_at_period_end     BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-account song unlock tracking with explicit revocation support
CREATE TABLE account_song_unlock (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  song_id     UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  source      TEXT NOT NULL
                CHECK (source IN (
                  'free_auto', 'pack', 'unlimited', 'self_hosted', 'admin'
                )),
  granted_stripe_event_id TEXT,
  granted_stripe_subscription_id TEXT,
  granted_subscription_period_end TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  revoked_reason TEXT
                CHECK (revoked_reason IN (
                  'refund', 'chargeback', 'admin'
                )),
  revoked_stripe_event_id TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(account_id, song_id)
);

-- Immutable balance ledger
CREATE TABLE credit_transaction (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  amount          INTEGER NOT NULL,
  balance_after   INTEGER NOT NULL,
  reason          TEXT NOT NULL
                    CHECK (reason IN (
                      'song_unlock',
                      'pack_purchase',
                      'credit_conversion',
                      'credit_conversion_reversal',
                      'replacement_grant',
                      'refund',
                      'chargeback_reversal',
                      'admin_adjustment'
                    )),
  stripe_event_id TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_account_song_unlock_account
  ON account_song_unlock(account_id);

CREATE INDEX idx_credit_txn_account
  ON credit_transaction(account_id, created_at DESC);

-- Enable RLS (service_role bypasses)
ALTER TABLE account_billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_song_unlock ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transaction ENABLE ROW LEVEL SECURITY;

-- RLS policies (deny direct anon/authenticated access, managed via service_role)
CREATE POLICY "account_billing_deny_all" ON account_billing FOR ALL USING (false);
CREATE POLICY "account_song_unlock_deny_all" ON account_song_unlock FOR ALL USING (false);
CREATE POLICY "credit_transaction_deny_all" ON credit_transaction FOR ALL USING (false);

-- Auto-update updated_at timestamp for account_billing (has updated_at column)
CREATE TRIGGER account_billing_updated_at
  BEFORE UPDATE ON account_billing
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();