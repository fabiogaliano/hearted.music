-- Rank the playlist studio preview inside Postgres.
--
-- The preview used to page up to 10,000 liked songs out through PostgREST,
-- read a 512-float vector per candidate when an intent was set, and score
-- everything in the app (reliability plan 4.4: ~10 page reads dominated wall
-- time). This function does the same work next to the data and returns only
-- what composePlaylistPreview reads: the pinned rows plus the top
-- p_ranked_limit of the ranked pool.
--
-- It reproduces the TypeScript reference exactly; keep them in step:
--   candidates   loadPhase1Candidates (src/lib/domains/playlists/candidate-loader.ts)
--   filters      passesAllMatchFilters (src/lib/domains/taste/match-filters/predicates.ts)
--   profile      buildDraftProfile / blendGenreDistribution
--   scoring      createMatchingService(...).matchBatch as configured by
--                rankCandidates (src/lib/domains/playlists/draft-engine.ts)
-- src/lib/domains/playlists/__tests__/preview-rank.integration.test.ts pins
-- the parity. Constants below (weights, banding, normalisation) mirror
-- song-matching/config.ts.
--
-- Semantics that are easy to get wrong:
-- * The 10,000-row cap applies to active likes BEFORE the Phase-1 check
--   (non-empty genres or an audio-feature row), like the paged loader.
-- * Missing metadata fails an active filter.
-- * The profile (genre mass, audio centroid) and total_eligible come from
--   filter-eligible candidates only. Pinned candidates that fail the filters
--   are still scored and count in the per-signal z-score statistics.
-- * Audio features are real; they go through text so each value is the
--   shortest decimal PostgREST would have sent, which is what TypeScript
--   scored (a plain ::float8 differs in the 8th digit). extra_float_digits is
--   pinned so that text form is the shortest round-trip one.
-- * pgvector's <=> is NaN for a zero vector where the TypeScript cosine is
--   0, and errors on a dimension mismatch where TypeScript returns 0.
-- * pgvector accumulates the cosine in float32, so with real vectors intent
--   scores differ from the double-precision TypeScript cosine by ~1e-7; only
--   songs that close together can order differently.
--
-- p_intent_embedding is NULL when no intent applies (no prompt, ineligible
-- account, failed embedding); the caller decides eligibility. Stored vectors
-- never leave the database.
--
-- Additive only. Backend-private: service-role only.

CREATE OR REPLACE FUNCTION public.rank_playlist_draft_preview(
  p_account_id        UUID,
  p_match_filters     JSONB,
  p_genre_pills       TEXT[],
  p_pinned_song_ids   UUID[],
  p_excluded_song_ids UUID[],
  p_ranked_limit      INTEGER,
  p_now               TIMESTAMPTZ,
  p_intent_embedding  extensions.vector DEFAULT NULL,
  p_embedding_model   TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
SET extra_float_digits = 1
-- Genre scoring hashes ~40 (genre array, profile genre) pairs per song: ~37 MB
-- at 10,000 songs. 24 MB gives hash nodes 48 MB (hash_mem_multiplier 2), so
-- it stays in memory (the 4 MB default spills it: ~315 ms instead of ~245 ms
-- for a 10,000-song library).
SET work_mem = '24MB'
AS $$
  WITH
  k AS (
    SELECT
      has_pills,
      p_intent_embedding IS NOT NULL AS has_intent,
      CASE WHEN has_pills THEN 0.35 ELSE 0.5 END::float8 AS base_embedding,
      CASE WHEN has_pills THEN 0.25 ELSE 0.3 END::float8 AS base_audio,
      CASE WHEN has_pills THEN 0.4 ELSE 0.2 END::float8 AS base_genre
    FROM (SELECT COALESCE(cardinality(p_genre_pills), 0) > 0 AS has_pills) pills_declared
  ),

  f AS (
    SELECT
      p_match_filters ? 'languages' AS has_languages,
      ARRAY(SELECT jsonb_array_elements_text(p_match_filters -> 'languages' -> 'codes')) AS language_codes,
      p_match_filters -> 'releaseYear' ->> 'kind' AS year_kind,
      (p_match_filters -> 'releaseYear' ->> 'year')::int AS year_exact,
      (p_match_filters -> 'releaseYear' ->> 'start')::int AS year_start,
      (p_match_filters -> 'releaseYear' ->> 'end')::int AS year_end,
      p_match_filters -> 'likedAt' ->> 'kind' AS liked_kind,
      ((p_match_filters -> 'likedAt' ->> 'startDate')::date)::timestamp AT TIME ZONE 'UTC' AS liked_start,
      ((p_match_filters -> 'likedAt' ->> 'endDate')::date + 1)::timestamp AT TIME ZONE 'UTC' AS liked_before_end_date,
      (CASE p_match_filters -> 'likedAt' -> 'end' ->> 'kind'
         WHEN 'today' THEN (p_now AT TIME ZONE 'UTC')::date + 1
         WHEN 'date' THEN (p_match_filters -> 'likedAt' -> 'end' ->> 'date')::date + 1
       END)::timestamp AT TIME ZONE 'UTC' AS liked_range_end,
      p_match_filters ->> 'vocalGender' AS vocal_gender
  ),

  recent_likes AS (
    SELECT ls.song_id, ls.liked_at
    FROM liked_song ls
    WHERE ls.account_id = p_account_id
      AND ls.unliked_at IS NULL
    ORDER BY ls.liked_at DESC, ls.song_id ASC
    LIMIT 10000
  ),

  candidates AS (
    SELECT
      rl.song_id,
      rl.liked_at,
      s.genres,
      COALESCE(rl.song_id = ANY(p_pinned_song_ids), false) AS pinned,
      COALESCE(rl.song_id = ANY(p_excluded_song_ids), false) AS excluded,
      (
        (NOT f.has_languages
          OR cardinality(f.language_codes) = 0
          OR COALESCE(s.language = ANY(f.language_codes), false)
          OR COALESCE(s.language_secondary = ANY(f.language_codes), false))
        AND (f.year_kind IS NULL OR COALESCE(CASE f.year_kind
          WHEN 'exact' THEN s.release_year = f.year_exact
          WHEN 'before' THEN s.release_year <= f.year_end
          WHEN 'after' THEN s.release_year >= f.year_start
          WHEN 'range' THEN s.release_year >= f.year_start AND s.release_year <= f.year_end
        END, false))
        AND (f.liked_kind IS NULL OR COALESCE(CASE f.liked_kind
          WHEN 'before' THEN rl.liked_at < f.liked_before_end_date
          WHEN 'after' THEN rl.liked_at >= f.liked_start
          WHEN 'range' THEN rl.liked_at >= f.liked_start AND rl.liked_at < f.liked_range_end
        END, false))
        AND (f.vocal_gender IS NULL OR COALESCE(s.vocal_gender = f.vocal_gender, false))
      ) AS eligible,
      af.energy::text::float8 AS energy,
      af.valence::text::float8 AS valence,
      af.danceability::text::float8 AS danceability,
      af.acousticness::text::float8 AS acousticness,
      af.instrumentalness::text::float8 AS instrumentalness,
      af.speechiness::text::float8 AS speechiness,
      af.liveness::text::float8 AS liveness,
      af.tempo::text::float8 AS tempo,
      af.loudness::text::float8 AS loudness
    FROM recent_likes rl
    JOIN (SELECT id AS song_id, genres, language, language_secondary, release_year, vocal_gender FROM song) s
      ON s.song_id = rl.song_id
    LEFT JOIN song_audio_feature af ON af.song_id = rl.song_id
    CROSS JOIN f
    WHERE cardinality(s.genres) > 0 OR af.song_id IS NOT NULL
  ),

  rankable AS (
    SELECT
      c.*,
      COALESCE(c.energy, c.valence, c.danceability, c.acousticness, c.instrumentalness,
               c.speechiness, c.liveness, c.tempo, c.loudness) IS NOT NULL AS has_audio_values,
      cardinality(c.genres) > 0 AS has_genres
    FROM candidates c
    WHERE c.eligible OR c.pinned
  ),

  centroid AS (
    SELECT
      c.*,
      COALESCE(c.energy, c.valence, c.danceability, c.acousticness, c.instrumentalness,
               c.speechiness, c.liveness, c.tempo, c.loudness) IS NOT NULL AS has_any
    FROM (
      SELECT
        avg(energy) FILTER (WHERE eligible) AS energy,
        avg(valence) FILTER (WHERE eligible) AS valence,
        avg(danceability) FILTER (WHERE eligible) AS danceability,
        avg(acousticness) FILTER (WHERE eligible) AS acousticness,
        avg(instrumentalness) FILTER (WHERE eligible) AS instrumentalness,
        avg(speechiness) FILTER (WHERE eligible) AS speechiness,
        avg(liveness) FILTER (WHERE eligible) AS liveness,
        avg(tempo) FILTER (WHERE eligible) AS tempo,
        avg(loudness) FILTER (WHERE eligible) AS loudness
      FROM rankable
    ) c
  ),

  -- Genre mass: observed counts over eligible songs blended 50/50 with the
  -- declared pills (blendGenreDistribution). Keys stay raw strings, as in the
  -- TypeScript distribution; canonicalisation happens at comparison time.
  observed AS (
    SELECT g AS genre, count(*)::float8 AS n
    FROM rankable r CROSS JOIN LATERAL unnest(r.genres) AS g
    WHERE r.eligible
    GROUP BY g
  ),
  pills AS (
    SELECT p AS genre, count(*)::float8 AS n
    FROM unnest(p_genre_pills) AS p
    WHERE p <> ''
    GROUP BY p
  ),
  profile_genre AS (
    SELECT
      (row_number() OVER ())::int AS pid,
      genre,
      COALESCE(ga.canonical, lower(genre)) AS canon,
      weight
    FROM (
      SELECT
        COALESCE(p.genre, o.genre) AS genre,
        CASE
          WHEN pt.k = 0 THEN o.n / ot.total
          WHEN ot.total IS NULL THEN p.n * (1::float8 / pt.k)
          ELSE COALESCE(p.n * (0.5::float8 / pt.k), 0) + COALESCE((o.n / ot.total) * 0.5::float8, 0)
        END AS weight
      FROM pills p
      FULL JOIN observed o ON o.genre = p.genre
      CROSS JOIN (SELECT COALESCE(sum(n), 0) AS k FROM pills) pt
      CROSS JOIN (SELECT sum(n) AS total FROM observed) ot
    ) blended
    LEFT JOIN genre_alias ga ON ga.alias = lower(blended.genre)
  ),
  profile_totals AS (
    SELECT count(*) > 0 AS has_genres, sum(weight) AS total_weight FROM profile_genre
  ),

  song_genre AS (
    SELECT (row_number() OVER ())::int AS sid, g AS genre, COALESCE(ga.canonical, lower(g)) AS canon
    FROM (SELECT DISTINCT unnest(genres) AS g FROM rankable) d
    LEFT JOIN genre_alias ga ON ga.alias = lower(d.g)
  ),
  -- Banded credit (bandedCredit) for every song-genre x profile-genre pair
  -- that earns any, already weighted by the profile genre: 1 for the same
  -- canonical genre, otherwise the directed profile->song similarity with the
  -- reverse edge as fallback, capped at 0.6 and zeroed below 0.3. Pairs
  -- without an edge earn 0 and are omitted. The weight rides along rather than
  -- being joined back on pid: the planner estimates profile_genre at one row,
  -- and that join became a nested loop re-running this whole CTE per profile
  -- genre (~2 s on a 10k library).
  edge_pair AS (
    SELECT sg.sid, sg.canon AS song_canon, pg.pid, pg.canon AS profile_canon, pg.weight
    FROM song_genre sg
    JOIN genre_similarity e ON e.to_genre = sg.canon
    JOIN profile_genre pg ON pg.canon = e.from_genre
    UNION
    SELECT sg.sid, sg.canon, pg.pid, pg.canon, pg.weight
    FROM song_genre sg
    JOIN genre_similarity e ON e.from_genre = sg.canon
    JOIN profile_genre pg ON pg.canon = e.to_genre
  ),
  weighted_credit AS (
    SELECT sg.sid, pg.pid, pg.weight AS weighted
    FROM song_genre sg
    JOIN profile_genre pg ON pg.canon = sg.canon
    UNION ALL
    SELECT sid, pid, weight * credit
    FROM (
      SELECT
        ep.sid,
        ep.pid,
        ep.weight,
        CASE
          WHEN r >= 1 THEN 1::float8
          WHEN r < 0.3::float8 THEN 0::float8
          ELSE least(r, 0.6::float8)
        END AS credit
      FROM edge_pair ep
      LEFT JOIN genre_similarity fwd ON fwd.from_genre = ep.profile_canon AND fwd.to_genre = ep.song_canon
      LEFT JOIN genre_similarity rev ON rev.from_genre = ep.song_canon AND rev.to_genre = ep.profile_canon
      CROSS JOIN LATERAL (SELECT COALESCE(fwd.similarity, rev.similarity, 0) AS r) sim
      WHERE ep.profile_canon <> ep.song_canon
    ) banded
    WHERE credit > 0
  ),
  -- Scored once per distinct genre array (libraries repeat arrays across many
  -- songs), on integer keys. Weighting each credit by its profile genre
  -- before taking the max is exact (w >= 0). The sum is accumulated in fixed
  -- point (2^-52 steps; profile weights sum to 1, so it cannot overflow) to be
  -- independent of row order: arrays that earn the same credits (e.g. [rock]
  -- and [rock, an unrelated genre]) must tie exactly, as in TypeScript, so
  -- liked_at breaks the tie. A float sum would differ in the last bit.
  genre_set AS (
    SELECT (row_number() OVER ())::int AS set_id, genres
    FROM (SELECT DISTINCT genres FROM rankable WHERE has_genres) d
  ),
  genre_set_score AS (
    SELECT best.set_id, (sum((best.weighted * 4503599627370496)::int8) / 4503599627370496)::float8 / pt.total_weight AS score
    FROM (
      SELECT gs.set_id, wc.pid, max(wc.weighted) AS weighted
      FROM genre_set gs
      CROSS JOIN LATERAL unnest(gs.genres) AS g(genre)
      JOIN song_genre sg ON sg.genre = g.genre
      JOIN weighted_credit wc ON wc.sid = sg.sid
      GROUP BY gs.set_id, wc.pid
    ) best
    CROSS JOIN profile_totals pt
    GROUP BY best.set_id, pt.total_weight
  ),

  song_vector AS (
    SELECT DISTINCT ON (e.song_id) e.song_id, e.embedding
    FROM song_embedding e
    JOIN rankable r ON r.song_id = e.song_id
    WHERE p_intent_embedding IS NOT NULL
      AND e.kind = 'full'
      AND e.model = p_embedding_model
    ORDER BY e.song_id, e.created_at DESC
  ),

  raw AS (
    SELECT
      r.song_id,
      r.liked_at,
      r.eligible,
      r.pinned,
      r.excluded,
      sv.song_id IS NOT NULL AS has_embedding,
      r.has_audio_values AND cn.has_any AS has_audio,
      r.has_genres,
      CASE
        WHEN sv.song_id IS NULL THEN 0::float8
        WHEN vector_dims(sv.embedding) <> vector_dims(p_intent_embedding) THEN 0::float8
        ELSE (
          SELECT CASE WHEN d = 'NaN'::float8 THEN 0::float8 ELSE greatest(0::float8, least(1::float8, 1 - d)) END
          FROM (SELECT sv.embedding <=> p_intent_embedding AS d) dist
        )
      END AS embedding_raw,
      CASE WHEN NOT (r.has_audio_values AND cn.has_any) THEN 0::float8 ELSE (
        SELECT CASE WHEN aw.weight = 0 THEN 0::float8 ELSE aw.score / aw.weight END
        FROM (
          SELECT
            0::float8
              + COALESCE(1.0::float8 * greatest(0::float8, 1 - abs(r.energy - cn.energy)), 0)
              + COALESCE(1.0::float8 * greatest(0::float8, 1 - abs(r.valence - cn.valence)), 0)
              + COALESCE(0.8::float8 * greatest(0::float8, 1 - abs(r.danceability - cn.danceability)), 0)
              + COALESCE(0.6::float8 * greatest(0::float8, 1 - abs(r.acousticness - cn.acousticness)), 0)
              + COALESCE(0.5::float8 * greatest(0::float8, 1 - abs(r.instrumentalness - cn.instrumentalness)), 0)
              + COALESCE(0.4::float8 * greatest(0::float8, 1 - abs(r.speechiness - cn.speechiness)), 0)
              + COALESCE(0.3::float8 * greatest(0::float8, 1 - abs(r.liveness - cn.liveness)), 0)
              + COALESCE(0.7::float8 * greatest(0::float8, 1 - abs(r.tempo - cn.tempo) / 100), 0)
              + COALESCE(0.3::float8 * greatest(0::float8, 1 - abs(r.loudness - cn.loudness) / 60), 0)
              AS score,
            0::float8
              + CASE WHEN r.energy IS NOT NULL AND cn.energy IS NOT NULL THEN 1.0::float8 ELSE 0 END
              + CASE WHEN r.valence IS NOT NULL AND cn.valence IS NOT NULL THEN 1.0::float8 ELSE 0 END
              + CASE WHEN r.danceability IS NOT NULL AND cn.danceability IS NOT NULL THEN 0.8::float8 ELSE 0 END
              + CASE WHEN r.acousticness IS NOT NULL AND cn.acousticness IS NOT NULL THEN 0.6::float8 ELSE 0 END
              + CASE WHEN r.instrumentalness IS NOT NULL AND cn.instrumentalness IS NOT NULL THEN 0.5::float8 ELSE 0 END
              + CASE WHEN r.speechiness IS NOT NULL AND cn.speechiness IS NOT NULL THEN 0.4::float8 ELSE 0 END
              + CASE WHEN r.liveness IS NOT NULL AND cn.liveness IS NOT NULL THEN 0.3::float8 ELSE 0 END
              + CASE WHEN r.tempo IS NOT NULL AND cn.tempo IS NOT NULL THEN 0.7::float8 ELSE 0 END
              + CASE WHEN r.loudness IS NOT NULL AND cn.loudness IS NOT NULL THEN 0.3::float8 ELSE 0 END
              AS weight
        ) aw
      ) END AS audio_raw,
      CASE WHEN r.has_genres THEN COALESCE(gss.score, 0::float8) ELSE 0::float8 END AS genre_raw
    FROM rankable r
    CROSS JOIN centroid cn
    LEFT JOIN song_vector sv ON sv.song_id = r.song_id
    LEFT JOIN genre_set gs ON gs.genres = r.genres
    LEFT JOIN genre_set_score gss ON gss.set_id = gs.set_id
  ),

  -- Per-signal distribution over the rows that have the signal, population
  -- standard deviation in two passes like computeSignalStats.
  signal_mean AS (
    SELECT
      count(*) FILTER (WHERE has_embedding) AS e_n, avg(embedding_raw) FILTER (WHERE has_embedding) AS e_mean,
      count(*) FILTER (WHERE has_audio) AS a_n, avg(audio_raw) FILTER (WHERE has_audio) AS a_mean,
      count(*) FILTER (WHERE has_genres) AS g_n, avg(genre_raw) FILTER (WHERE has_genres) AS g_mean
    FROM raw
  ),
  signal_stats AS (
    SELECT
      m.*,
      sqrt(avg((r.embedding_raw - m.e_mean) ^ 2) FILTER (WHERE r.has_embedding)) AS e_std,
      sqrt(avg((r.audio_raw - m.a_mean) ^ 2) FILTER (WHERE r.has_audio)) AS a_std,
      sqrt(avg((r.genre_raw - m.g_mean) ^ 2) FILTER (WHERE r.has_genres)) AS g_std
    FROM raw r CROSS JOIN signal_mean m
    GROUP BY m.e_n, m.e_mean, m.a_n, m.a_mean, m.g_n, m.g_mean
  ),

  normalized AS (
    SELECT
      r.*,
      -- Under 8 samples z-scores are noise: embeddings take the legacy
      -- baseline stretch, audio and genre pass through clamped.
      CASE
        WHEN NOT r.has_embedding THEN 0::float8
        WHEN st.e_n < 8 THEN greatest(0::float8, least(1::float8, (r.embedding_raw - 0.5::float8) / 0.5::float8))
        WHEN st.e_std < 1e-9::float8 THEN 0.5::float8
        ELSE (greatest(-3::float8, least(3::float8, (r.embedding_raw - st.e_mean) / st.e_std)) + 3) / 6
      END AS embedding_norm,
      CASE
        WHEN NOT r.has_audio THEN 0::float8
        WHEN st.a_n < 8 THEN greatest(0::float8, least(1::float8, r.audio_raw))
        WHEN st.a_std < 1e-9::float8 THEN 0.5::float8
        ELSE (greatest(-3::float8, least(3::float8, (r.audio_raw - st.a_mean) / st.a_std)) + 3) / 6
      END AS audio_norm,
      CASE
        WHEN NOT r.has_genres THEN 0::float8
        WHEN st.g_n < 8 THEN greatest(0::float8, least(1::float8, r.genre_raw))
        WHEN st.g_std < 1e-9::float8 THEN 0.5::float8
        ELSE (greatest(-3::float8, least(3::float8, (r.genre_raw - st.g_mean) / st.g_std)) + 3) / 6
      END AS genre_norm,
      -- Missing-signal policy: with pills or an intent a song's missing
      -- signal keeps its weight ("neutral", judged on the profile); otherwise
      -- the weight moves to the signals the song has ("redistribute").
      CASE WHEN k.has_pills OR k.has_intent THEN k.has_intent ELSE r.has_embedding END AS w_embedding_on,
      CASE WHEN k.has_pills OR k.has_intent THEN cn.has_any ELSE r.has_audio END AS w_audio_on,
      CASE WHEN k.has_pills OR k.has_intent THEN pt.has_genres ELSE r.has_genres END AS w_genre_on
    FROM raw r
    CROSS JOIN signal_stats st
    CROSS JOIN k
    CROSS JOIN centroid cn
    CROSS JOIN profile_totals pt
  ),

  -- computeAdaptiveWeights: the weight of unavailable signals moves onto the
  -- available ones in proportion to their base weights.
  weighted AS (
    SELECT
      n.*,
      0::float8
        + CASE WHEN n.w_embedding_on THEN 0 ELSE k.base_embedding END
        + CASE WHEN n.w_audio_on THEN 0 ELSE k.base_audio END
        + CASE WHEN n.w_genre_on THEN 0 ELSE k.base_genre END AS unavailable,
      0::float8
        + CASE WHEN n.w_embedding_on THEN k.base_embedding ELSE 0 END
        + CASE WHEN n.w_audio_on THEN k.base_audio ELSE 0 END
        + CASE WHEN n.w_genre_on THEN k.base_genre ELSE 0 END AS available,
      k.base_embedding, k.base_audio, k.base_genre
    FROM normalized n CROSS JOIN k
  ),
  scored AS (
    SELECT
      w.song_id,
      w.liked_at,
      w.eligible,
      w.pinned,
      w.excluded,
      greatest(0::float8, least(1::float8,
        w.embedding_norm * CASE WHEN NOT w.w_embedding_on THEN 0::float8
          WHEN w.unavailable > 0 AND w.available > 0 THEN w.base_embedding + w.unavailable * (w.base_embedding / w.available)
          ELSE w.base_embedding END
        + w.audio_norm * CASE WHEN NOT w.w_audio_on THEN 0::float8
          WHEN w.unavailable > 0 AND w.available > 0 THEN w.base_audio + w.unavailable * (w.base_audio / w.available)
          ELSE w.base_audio END
        + w.genre_norm * CASE WHEN NOT w.w_genre_on THEN 0::float8
          WHEN w.unavailable > 0 AND w.available > 0 THEN w.base_genre + w.unavailable * (w.base_genre / w.available)
          ELSE w.base_genre END
      )) AS score
    FROM weighted w
  ),

  ranked AS (
    SELECT sc.song_id, sc.score, sc.liked_at
    FROM scored sc
    WHERE NOT sc.pinned AND NOT sc.excluded
    ORDER BY sc.score DESC, sc.liked_at DESC, sc.song_id ASC
    LIMIT GREATEST(p_ranked_limit, 0)
  ),
  pinned AS (
    SELECT sc.song_id, sc.score FROM scored sc WHERE sc.pinned
  )

  SELECT jsonb_build_object(
    'total_eligible', (SELECT count(*) FROM candidates WHERE eligible),
    'ranked_pool_count', (SELECT count(*) FROM scored WHERE NOT pinned AND NOT excluded),
    'ranked', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'song_id', s.id, 'score', r.score, 'spotify_id', s.spotify_id, 'name', s.name,
          'artists', s.artists, 'genres', s.genres, 'image_url', s.image_url,
          'album_name', s.album_name, 'duration_ms', s.duration_ms
        )
        ORDER BY r.score DESC, r.liked_at DESC, r.song_id ASC
      )
      FROM ranked r JOIN song s ON s.id = r.song_id
    ), '[]'::jsonb),
    'pinned', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'song_id', s.id, 'score', p.score, 'spotify_id', s.spotify_id, 'name', s.name,
          'artists', s.artists, 'genres', s.genres, 'image_url', s.image_url,
          'album_name', s.album_name, 'duration_ms', s.duration_ms
        )
      )
      FROM pinned p JOIN song s ON s.id = p.song_id
    ), '[]'::jsonb)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.rank_playlist_draft_preview(UUID, JSONB, TEXT[], UUID[], UUID[], INTEGER, TIMESTAMPTZ, extensions.vector, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rank_playlist_draft_preview(UUID, JSONB, TEXT[], UUID[], UUID[], INTEGER, TIMESTAMPTZ, extensions.vector, TEXT)
  TO service_role;

NOTIFY pgrst, 'reload schema';
