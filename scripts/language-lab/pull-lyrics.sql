-- Flattens every stored lyrics document to plain text in-database so we ship
-- text, not megabytes of JSONB. One row per song: the latest lyric-bearing row
-- when multiple provider/source rows coexist.
WITH lyric_candidates AS (
	SELECT
		sl.song_id,
		s.name AS title,
		s.artists[1] AS artist,
		sl.updated_at,
		sl.created_at,
		sl.id,
		(
			SELECT string_agg(line ->> 'text', E'\n')
			FROM jsonb_array_elements(coalesce(sl.document -> 'sections', '[]'::jsonb)) AS sec
			CROSS JOIN jsonb_array_elements(coalesce(sec -> 'lines', '[]'::jsonb)) AS line
			WHERE line ->> 'text' IS NOT NULL
		) AS lyrics_text
	FROM song_lyrics sl
	JOIN song s ON s.id = sl.song_id
	WHERE sl.fetch_status = 'lyrics'
	  AND sl.document IS NOT NULL
)
SELECT DISTINCT ON (song_id)
	song_id,
	title,
	artist,
	lyrics_text
FROM lyric_candidates
WHERE lyrics_text IS NOT NULL
ORDER BY song_id, updated_at DESC, created_at DESC, id DESC;
