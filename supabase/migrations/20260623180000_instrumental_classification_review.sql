-- Instrumental-classification review + settle.
--
-- Step 2 (content analysis) concludes "instrumental" for a lyric-less song using
-- signals step 1 (the LRCLIB lyrics lookup) never sees: the song's genre tags and
-- Spotify's instrumentalness score. That verdict was written to song_analysis but
-- never propagated to the lyrics state, so song_lyrics stayed 'not_found' and the
-- enrichment selector kept re-opening the song every ~24-30d to re-probe for
-- lyrics it will never have.
--
-- Fix (two halves):
--   1. SETTLE: write a song_lyrics row (source='analysis', fetch_status='instrumental')
--      so the selector's existing close-condition keeps the song shut. No selector
--      change is needed — once the latest fetch is 'instrumental' the re-open clause
--      (fetch_status IS NULL OR 'not_found') is false.
--   2. REVIEW: the genre/instrumentalness verdict is a heuristic that occasionally
--      mislabels a vocal track, so each auto-determination is logged here as
--      'pending' for an operator to approve (confirm) or reject (it has vocals) —
--      mirroring how auto-backfilled audio features go live then get reviewed.
--
-- This migration creates the review table and backfills both halves for the
-- existing population: songs whose latest analysis is instrumental (prompt_version
-- '3', the active instrumental prompt) and whose latest lyrics fetch is null or
-- not_found. A rejected review is the operator's standing veto; the analyzer reads
-- it before ever auto-classifying that song instrumental again.

CREATE TABLE song_instrumental_review (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'rejected')
  ),

  -- Which heuristic fired (classifier precedence: genre before instrumentalness).
  signal TEXT NOT NULL CHECK (signal IN ('instrumentalness', 'genre')),
  -- The Spotify instrumentalness value at determination time (informational).
  instrumentalness NUMERIC,
  -- The genre(s) that triggered a 'genre' determination (informational).
  matched_genre TEXT,

  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  rejection_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One standing review per song: the analyzer upserts pending on first
  -- determination and never clobbers an operator's approved/rejected verdict.
  UNIQUE (song_id)
);

CREATE INDEX song_instrumental_review_status_idx
  ON song_instrumental_review (status, created_at DESC);

ALTER TABLE song_instrumental_review ENABLE ROW LEVEL SECURITY;
CREATE POLICY "song_instrumental_review_deny_all"
  ON song_instrumental_review FOR ALL USING (false);

CREATE TRIGGER song_instrumental_review_updated_at
  BEFORE UPDATE ON song_instrumental_review
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Target: songs the classifier already decided are instrumental (latest analysis
-- prompt_version '3') but whose lyrics state never caught up (latest fetch null or
-- not_found). These are exactly the songs stuck in the wasteful re-probe loop.

WITH latest_analysis AS (
  SELECT DISTINCT ON (sa.song_id)
    sa.song_id, sa.prompt_version
  FROM song_analysis sa
  ORDER BY sa.song_id, sa.created_at DESC
),
latest_fetch AS (
  SELECT DISTINCT ON (sl.song_id)
    sl.song_id, sl.fetch_status
  FROM song_lyrics sl
  ORDER BY sl.song_id, sl.updated_at DESC
),
targets AS (
  SELECT la.song_id
  FROM latest_analysis la
  LEFT JOIN latest_fetch lf ON lf.song_id = la.song_id
  WHERE la.prompt_version = '3'
    AND (lf.fetch_status IS NULL OR lf.fetch_status = 'not_found')
),
-- Curated instrumental-genre keywords, mirroring instrumental-genres.ts
-- (RAW_INSTRUMENTAL_GENRES), already lower-cased + single-spaced like the runtime
-- set. Inlined because a migration can't import the TS module. Drift between this
-- list and the module only ever changes a backfilled row's *displayed reason*, not
-- the verdict (the song is settled instrumental either way).
instrumental_genre(g) AS (
  VALUES
    ('instrumental'), ('instrumental hip-hop'), ('instrumental hip hop'),
    ('neoclassical'), ('neoclassical darkwave'), ('contemporary classical'),
    ('classical'), ('chamber music'), ('orchestral'), ('film score'),
    ('soundtrack'), ('ambient'), ('drone'), ('post-rock'), ('post rock'),
    ('math rock'), ('trap instrumental'), ('lo-fi instrumental'),
    ('lo fi instrumental'), ('beats'), ('chillhop')
),
settle AS (
  INSERT INTO song_lyrics (
    song_id, source, document, content_hash, has_annotations,
    schema_version, fetch_status, fetch_source
  )
  SELECT t.song_id, 'analysis', NULL, 'no-content', false, 0, 'instrumental', NULL
  FROM targets t
  ON CONFLICT (song_id, source) DO NOTHING
)
INSERT INTO song_instrumental_review (
  song_id, status, signal, instrumentalness, matched_genre
)
SELECT
  t.song_id,
  'pending',
  -- Match the runtime classifier's precedence: a curated genre keyword (step 3)
  -- decides it over the instrumentalness tiebreak (step 4). So whenever a genre
  -- matches we record 'genre' regardless of the score — only a no-genre target
  -- (which therefore settled on instrumentalness >= 0.9) records 'instrumentalness'.
  CASE WHEN gm.matched_genre IS NOT NULL THEN 'genre' ELSE 'instrumentalness' END,
  saf.instrumentalness,
  -- The matched genre's original text (matchedInstrumentalGenre returns the first
  -- array match), or NULL when the instrumentalness tiebreak is what fired.
  gm.matched_genre
FROM targets t
JOIN song s ON s.id = t.song_id
LEFT JOIN song_audio_feature saf ON saf.song_id = t.song_id
LEFT JOIN LATERAL (
  -- Normalise each genre like normaliseGenre (lower-case, collapse whitespace,
  -- trim) to match the curated set; keep the first match in array order.
  SELECT gg.name AS matched_genre
  FROM unnest(s.genres) WITH ORDINALITY AS gg(name, ord)
  JOIN instrumental_genre ig
    ON lower(trim(regexp_replace(gg.name, '\s+', ' ', 'g'))) = ig.g
  ORDER BY gg.ord
  LIMIT 1
) gm ON true
ON CONFLICT (song_id) DO NOTHING;
