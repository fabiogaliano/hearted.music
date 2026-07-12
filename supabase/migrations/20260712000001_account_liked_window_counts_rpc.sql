-- Recency-window counts for the seed-template "Liked in the [window]" blank
-- (playlist creation beat 1).
--
-- Buckets an account's active liked_song rows into named time windows entirely
-- in SQL and returns one row per non-empty window. The window predicate is
-- pushed down here rather than filtering a client-supplied id list — the caller
-- passes only the account id, so no DB-derived id set ever re-enters a query as
-- a URL .in() filter.
--
-- Windows are alternative lenses, not a partition, so they intentionally
-- overlap: last-30d ⊂ last-3m ⊂ last-6m are rolling recency cuts, while
-- first-3m is anchored to the account's OWN earliest like (its first three
-- months on hearted), computed from MIN(liked_at). An empty window produces no
-- row; the caller labels ids and drops thin windows.
--
-- Backend-private: callable only through the service-role client.

-- Each row also returns the window's absolute liked_at bounds so the caller can
-- commit the window as a concrete `likedAt` match-filter (a rolling "last N days"
-- becomes an `after` predicate — end_at NULL/open; the anchored "first 3 months"
-- becomes a closed range). Bounds are the same expressions that define the
-- membership predicate, so the count and the committed filter always agree.
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
  )
  SELECT w.window_id, COUNT(*)::BIGINT AS occurrences, w.start_at, w.end_at
  FROM active a
  CROSS JOIN origin o
  CROSS JOIN LATERAL (
    VALUES
      ('last-30d', a.liked_at >= now() - INTERVAL '30 days',
        now() - INTERVAL '30 days', NULL::timestamptz),
      ('last-3m',  a.liked_at >= now() - INTERVAL '3 months',
        now() - INTERVAL '3 months', NULL::timestamptz),
      ('last-6m',  a.liked_at >= now() - INTERVAL '6 months',
        now() - INTERVAL '6 months', NULL::timestamptz),
      ('first-3m', o.first_liked_at IS NOT NULL
                   AND a.liked_at < o.first_liked_at + INTERVAL '3 months',
        o.first_liked_at, o.first_liked_at + INTERVAL '3 months')
  ) AS w(window_id, in_window, start_at, end_at)
  WHERE w.in_window
  GROUP BY w.window_id, w.start_at, w.end_at;
$$;

REVOKE EXECUTE ON FUNCTION public.get_account_liked_window_counts(UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_account_liked_window_counts(UUID)
  TO service_role;
