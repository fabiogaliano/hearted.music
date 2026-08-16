-- Historical daily account activity table for canonical DAU, WAU, and retention tracking.
--
-- The existing account_activity table tracks only the latest timestamp per account.
-- account_activity_day records at most one row per account per UTC calendar day.
-- No request paths, IP addresses, user agents, or unnecessary personal data are stored.

CREATE TABLE account_activity_day (
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, activity_date)
);

CREATE INDEX idx_account_activity_day_date ON account_activity_day (activity_date);

ALTER TABLE account_activity_day ENABLE ROW LEVEL SECURITY;

CREATE POLICY "account_activity_day_deny_all" ON account_activity_day FOR ALL USING (false);

-- Backfill from existing account_activity: preserves the date represented by
-- each account's current last_seen_at without inventing unobserved historical activity.
INSERT INTO account_activity_day (account_id, activity_date, first_seen_at, last_seen_at)
SELECT
  account_id,
  (last_seen_at AT TIME ZONE 'UTC')::date AS activity_date,
  last_seen_at AS first_seen_at,
  last_seen_at AS last_seen_at
FROM account_activity
ON CONFLICT (account_id, activity_date) DO UPDATE
  SET
    first_seen_at = LEAST(account_activity_day.first_seen_at, EXCLUDED.first_seen_at),
    last_seen_at = GREATEST(account_activity_day.last_seen_at, EXCLUDED.last_seen_at);

-- Atomic heartbeat RPC: updates current account_activity and daily account_activity_day.
-- The 10-minute throttle remains on account_activity to limit write amplification,
-- while account_activity_day records daily presence and updates last_seen_at.
CREATE OR REPLACE FUNCTION touch_account_last_seen(p_account_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_today DATE := (v_now AT TIME ZONE 'UTC')::date;
BEGIN
  -- 1. Maintain latest timestamp in account_activity (throttled to 10m on update)
  INSERT INTO account_activity (account_id, last_seen_at)
  VALUES (p_account_id, v_now)
  ON CONFLICT (account_id) DO UPDATE
    SET last_seen_at = v_now
    WHERE account_activity.last_seen_at < v_now - interval '10 minutes';

  -- 2. Maintain daily bucket in account_activity_day
  INSERT INTO account_activity_day (account_id, activity_date, first_seen_at, last_seen_at)
  VALUES (p_account_id, v_today, v_now, v_now)
  ON CONFLICT (account_id, activity_date) DO UPDATE
    SET last_seen_at = v_now;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.touch_account_last_seen(UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.touch_account_last_seen(UUID)
  TO service_role;
