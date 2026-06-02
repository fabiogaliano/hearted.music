-- Benefit-scoped account grant record for the liked-song access benefit.
--
-- This is a state record, not a ledger: at most one row per account. Row
-- existence means the account has already been considered for the benefit;
-- applied_at distinguishes pending (NULL) from applied (NOT NULL). The first
-- writer owns origin/requested_by/note/created_at — reruns preserve them.
CREATE TABLE account_liked_song_access_grant (
  account_id   UUID PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
  origin       TEXT NOT NULL
                 CHECK (origin IN ('waitlist_auto', 'operator_manual')),
  requested_by TEXT,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at   TIMESTAMPTZ
);

-- Service-role-only access, consistent with the other private billing tables
-- and required by src/lib/data/__tests__/security-invariants.integration.test.
ALTER TABLE account_liked_song_access_grant ENABLE ROW LEVEL SECURITY;

CREATE POLICY "account_liked_song_access_grant_deny_all"
  ON account_liked_song_access_grant FOR ALL USING (false);
