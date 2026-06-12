-- Extend song_lyrics for three-state fetch outcomes (Decision 5, option A).
--
-- Why: the previous schema conflated "no row" (never tried) with "tried and
-- got nothing" — a song that is genuinely instrumental or simply not in any
-- provider's catalog had no representable state. Two new columns make all
-- three fetch outcomes first-class:
--
--   fetch_status  lyrics | instrumental | not_found
--   fetch_source  lrclib | genius | genius_page   (nullable for legacy rows)
--
-- Existing rows have lyrics fetched from Genius, so they backfill to
-- fetch_status='lyrics', fetch_source='genius'.
--
-- The document column's NOT NULL constraint is relaxed to allow NULL for
-- instrumental/not_found rows — they have no lyric text to store. The
-- existing rows all have non-null documents, so this is purely additive.
-- has_annotations stays NOT NULL DEFAULT false (always false for non-lyrics
-- rows). content_hash and schema_version keep their NOT NULL constraints;
-- non-lyrics rows must still supply values to prevent schema drift.
--
-- RLS policy is unchanged (deny-all; service_role bypasses it).

-- 1. Add fetch_status (backfill before adding NOT NULL).
--    All existing rows have lyrics fetched from Genius.
ALTER TABLE song_lyrics
  ADD COLUMN fetch_status TEXT;

UPDATE song_lyrics
  SET fetch_status = 'lyrics'
  WHERE fetch_status IS NULL;

ALTER TABLE song_lyrics
  ALTER COLUMN fetch_status SET NOT NULL,
  ADD CONSTRAINT song_lyrics_fetch_status_check
    CHECK (fetch_status IN ('lyrics', 'instrumental', 'not_found'));

-- 2. Add fetch_source with a permissive check (nullable: the existing `source`
--    column already records 'genius' for legacy rows; fetch_source is backfilled
--    from that context rather than derived from source to keep the columns
--    independent going forward).
ALTER TABLE song_lyrics
  ADD COLUMN fetch_source TEXT;

UPDATE song_lyrics
  SET fetch_source = 'genius'
  WHERE fetch_source IS NULL;

ALTER TABLE song_lyrics
  ADD CONSTRAINT song_lyrics_fetch_source_check
    CHECK (fetch_source IS NULL OR fetch_source IN ('lrclib', 'genius', 'genius_page'));

-- 3. Allow NULL document so instrumental/not_found rows can be inserted
--    without lyric content. Existing rows are unaffected (all have documents).
ALTER TABLE song_lyrics
  ALTER COLUMN document DROP NOT NULL;
