-- Allow 'netease' as a song_lyrics.fetch_source.
--
-- Why: NetEase Cloud Music is now a last-resort lyric provider, consulted only
-- when LRCLIB fails transiently (see lyrics/providers/netease.ts). A NetEase
-- lyrics/instrumental outcome writes fetch_source='netease', which the existing
-- CHECK (added in 20260612072021) would reject. This widens the allowed set;
-- it is purely additive — no existing rows carry the new value, and NULL plus
-- the prior three values stay valid.

ALTER TABLE song_lyrics
  DROP CONSTRAINT song_lyrics_fetch_source_check;

ALTER TABLE song_lyrics
  ADD CONSTRAINT song_lyrics_fetch_source_check
    CHECK (
      fetch_source IS NULL
      OR fetch_source IN ('lrclib', 'genius', 'genius_page', 'netease')
    );
