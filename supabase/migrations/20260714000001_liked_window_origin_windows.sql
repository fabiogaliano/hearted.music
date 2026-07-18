-- Make the playlist-creation liked-window anchor a symmetric two-sided toggle:
-- "Your [first|last] likes, all [N] of them" offers the SAME length set on both
-- sides (3 / 6 / 12 / 24 / 18 months), so the recent end and the origin end read
-- as parallel choices rather than two unrelated scales.
--
-- The original RPC (20260712000001) was lopsided: three rolling recent windows
-- (30d / 3m / 6m) but a single origin window (first-3m). Early likes are sparse,
-- so the lone origin window routinely fell under the caller's floor and the whole
-- "first" anchor disappeared; and the recent side had no long windows to match the
-- origin's reach. This emits last-Nm and first-Nm for the same N, and drops the
-- 30-day window (not a "month", and its origin twin would always be near-empty).
--
-- Every window is GATED on first_liked_at + N <= now(): a window wider than the
-- account's own history would just re-capture the entire library — meaningless as
-- either a "recent N" or a "first N" — so it's withheld until the history spans it.
-- Bounds are the same expressions that define membership, so per-window counts and
-- the committed `likedAt` filter always agree.

CREATE OR REPLACE FUNCTION get_account_liked_window_counts(
  p_account_id UUID
)
RETURNS TABLE (
  window_id   TEXT,
  occurrences BIGINT,
  start_at    TIMESTAMPTZ,
  end_at      TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH active AS (
    SELECT liked_at
    FROM liked_song
    WHERE account_id = p_account_id
      AND unliked_at IS NULL
  ),
  origin AS (
    SELECT MIN(liked_at) AS first_liked_at FROM active
  ),
  -- The length set, shared by both anchors. `span_ok` withholds a window until the
  -- account's history is at least that wide (see header).
  lengths AS (
    SELECT *
    FROM (VALUES
      ('3m',  INTERVAL '3 months'),
      ('6m',  INTERVAL '6 months'),
      ('12m', INTERVAL '12 months'),
      ('18m', INTERVAL '18 months'),
      ('24m', INTERVAL '24 months')
    ) AS l(length, span)
  )
  SELECT w.window_id, COUNT(*)::BIGINT AS occurrences, w.start_at, w.end_at
  FROM active a
  CROSS JOIN origin o
  CROSS JOIN lengths l
  CROSS JOIN LATERAL (
    SELECT
      o.first_liked_at IS NOT NULL AND o.first_liked_at + l.span <= now() AS span_ok
  ) g
  -- Floor every bound to UTC-DATE granularity, because the committed match-filter
  -- is day-granular: windowToLikedAt truncates these bounds to YYYY-MM-DD and the
  -- predicate compares against UTC midnight. Counting at timestamp granularity here
  -- would drift from the filter by up to a boundary day. `last_lo` = UTC midnight of
  -- the rolling start; `first_lo`/`first_hi` = UTC midnights of the origin range's
  -- start/end dates. The origin range is inclusive THROUGH its end date (the filter
  -- is half-open at the following midnight), so membership uses `< first_hi + 1 day`.
  CROSS JOIN LATERAL (
    SELECT
      date_trunc('day', (now() - l.span) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        AS last_lo,
      date_trunc('day', o.first_liked_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        AS first_lo,
      date_trunc('day', (o.first_liked_at + l.span) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        AS first_hi
  ) b
  CROSS JOIN LATERAL (
    VALUES
      -- Rolling recency cut (open-ended: end_at NULL → an `after` filter).
      ('last-' || l.length, g.span_ok AND a.liked_at >= b.last_lo,
        b.last_lo, NULL::timestamptz),
      -- Origin cut anchored to the first like (closed range → a bounded filter),
      -- inclusive through first_hi's date to mirror the filter's half-open end.
      ('first-' || l.length,
        g.span_ok AND a.liked_at >= b.first_lo
                  AND a.liked_at < b.first_hi + INTERVAL '1 day',
        b.first_lo, b.first_hi)
  ) AS w(window_id, in_window, start_at, end_at)
  WHERE w.in_window
  GROUP BY w.window_id, w.start_at, w.end_at;
$$;

REVOKE EXECUTE ON FUNCTION public.get_account_liked_window_counts(UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_account_liked_window_counts(UUID)
  TO service_role;
