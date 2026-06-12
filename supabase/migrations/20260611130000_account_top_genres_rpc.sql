-- Quick-picks source for the genre-pills picker (Phase 2 §2.1).
--
-- Aggregates the genre tags across an account's still-liked songs so the picker
-- can suggest genres the user actually owns — every suggestion is guaranteed
-- actionable. unnest expands each song's genres array; the GROUP BY counts how
-- often each tag appears across the library. Returns raw (non-canonicalized)
-- tags; the caller canonicalizes + dedupes client-side, mirroring how the
-- whitelist ships both canonical and variant spellings.
--
-- Backend-private: callable only through the service-role client (same posture
-- as the other public-schema RPCs hardened in 20260519110000).

CREATE OR REPLACE FUNCTION get_account_top_genres(
  p_account_id UUID,
  p_limit      INTEGER DEFAULT 12
)
RETURNS TABLE (genre TEXT, occurrences BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT g AS genre, COUNT(*)::BIGINT AS occurrences
  FROM liked_song ls
  JOIN song s ON s.id = ls.song_id
  CROSS JOIN LATERAL unnest(s.genres) AS g
  WHERE ls.account_id = p_account_id
    AND ls.unliked_at IS NULL
  GROUP BY g
  ORDER BY occurrences DESC, g ASC
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.get_account_top_genres(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_account_top_genres(UUID, INTEGER)
  TO service_role;
