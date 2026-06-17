-- Tracks "last active" per account, isolated from the account table on purpose.
--
-- Writing last_seen_at as a column on account would fire account's
-- BEFORE UPDATE trigger (update_updated_at_column) on every heartbeat,
-- silently dragging account.updated_at forward and conflating "profile
-- changed" with "user was online". A dedicated table keeps updated_at
-- meaningful and confines this high-frequency write to a single tiny row.

CREATE TABLE account_activity (
  account_id UUID PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No index on last_seen_at: it's write-hot and we never filter by it here.
-- An index would only add write amplification to the heartbeat path. Add one
-- later if/when an analytics query actually needs "active since X".

ALTER TABLE account_activity ENABLE ROW LEVEL SECURITY;

-- Throttled heartbeat. The staleness check lives in SQL so the throttle is
-- enforced on DB time (not the Worker's clock) and is atomic under concurrent
-- requests: only the first request past the window writes; the rest match the
-- ON CONFLICT WHERE as a no-op, producing no dead tuple. The app also gates
-- this call in-process to avoid the round-trip on the common fresh path; the
-- WHERE here is the authoritative guard that makes races correct regardless.
CREATE OR REPLACE FUNCTION touch_account_last_seen(p_account_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO account_activity (account_id, last_seen_at)
  VALUES (p_account_id, now())
  ON CONFLICT (account_id) DO UPDATE
    SET last_seen_at = now()
    WHERE account_activity.last_seen_at < now() - interval '10 minutes';
$$;

REVOKE EXECUTE ON FUNCTION public.touch_account_last_seen(UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.touch_account_last_seen(UUID)
  TO service_role;
