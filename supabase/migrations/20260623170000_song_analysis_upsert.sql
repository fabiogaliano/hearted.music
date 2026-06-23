-- Collapse song_analysis re-runs into an upsert instead of an append.
--
-- Why: every reanalysis (the lyrics-refresh / probe path re-opens analyzed songs)
-- INSERTed a fresh row, so song_analysis accumulated surplus rows per song with no
-- path ever removing them. The read path (queries.get) already dedupes by latest
-- created_at, so the older rows were pure dead weight.
--
-- Conflict grain is (song_id, model, prompt_version): a re-run with the same model
-- and prompt overwrites in place (kills the accumulation), while a model or prompt
-- upgrade still creates a new row — preserving the cross-version history the table
-- was designed for. prompt_version is nullable, so the unique index is
-- NULLS NOT DISTINCT (PG15+) to treat NULL prompts as a single slot rather than
-- infinitely many distinct ones.
--
-- created_at = now() on the UPDATE branch is load-bearing, NOT cosmetic: the
-- enrichment selector terminates two loops by comparing latest_analysis.created_at
-- against lyrics_updated_at (reanalyze when lyrics are newer) and against the
-- latest embedding's created_at (re-embed when analysis is newer). If an in-place
-- update left created_at frozen, late-arriving lyrics would stay newer than the
-- analysis forever and the song would reanalyze on every pass. Advancing created_at
-- with the server clock keeps the exact termination behavior the append path had.

-- ── 1. Dedupe existing surplus rows, keeping the most recent per conflict key ──
DELETE FROM song_analysis sa
USING (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY song_id, model, COALESCE(prompt_version, '')
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM song_analysis
) ranked
WHERE sa.id = ranked.id
  AND ranked.rn > 1;

-- ── 2. Enforce the conflict key so future re-runs upsert instead of accumulate ──
CREATE UNIQUE INDEX idx_song_analysis_song_model_prompt
  ON song_analysis (song_id, model, prompt_version) NULLS NOT DISTINCT;

-- ── 3. Upsert RPC ─────────────────────────────────────────────────────────────
-- Bumps created_at/updated_at to now() on conflict (see header). SETOF so PostgREST
-- exposes it as a row the client can .select().single().
CREATE OR REPLACE FUNCTION upsert_song_analysis(
  p_song_id              UUID,
  p_analysis             JSONB,
  p_model                TEXT,
  p_prompt_version       TEXT DEFAULT NULL,
  p_tokens_used          INTEGER DEFAULT NULL,
  p_cost_cents           INTEGER DEFAULT NULL,
  p_cleanup_passes       INTEGER DEFAULT NULL,
  p_cleanup_tells_before INTEGER DEFAULT NULL,
  p_cleanup_tells_after  INTEGER DEFAULT NULL,
  p_cleanup_error        TEXT DEFAULT NULL
)
RETURNS SETOF song_analysis
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO song_analysis (
    song_id, analysis, model, prompt_version, tokens_used, cost_cents,
    cleanup_passes, cleanup_tells_before, cleanup_tells_after, cleanup_error
  ) VALUES (
    p_song_id, p_analysis, p_model, p_prompt_version, p_tokens_used, p_cost_cents,
    p_cleanup_passes, p_cleanup_tells_before, p_cleanup_tells_after, p_cleanup_error
  )
  ON CONFLICT (song_id, model, prompt_version) DO UPDATE SET
    analysis             = EXCLUDED.analysis,
    tokens_used          = EXCLUDED.tokens_used,
    cost_cents           = EXCLUDED.cost_cents,
    cleanup_passes       = EXCLUDED.cleanup_passes,
    cleanup_tells_before = EXCLUDED.cleanup_tells_before,
    cleanup_tells_after  = EXCLUDED.cleanup_tells_after,
    cleanup_error        = EXCLUDED.cleanup_error,
    created_at           = now(),
    updated_at           = now()
  RETURNING *;
$$;
