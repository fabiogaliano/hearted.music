-- Freeze which playlist_profile each playlist was matched with at snapshot time.
--
-- match_result preserves the per-factor scores that explained a match, but the
-- factors are only interpretable against the playlist's intent (embedding,
-- audio centroid, genre distribution) at that moment — and that intent drifts
-- as the user edits the playlist. match_snapshot.playlist_set_hash proves the
-- intent changed but doesn't store what it was, and there was no reference from
-- a snapshot to the playlist_profile row it used.
--
-- This join table is that missing reference. playlist_profile rows are immutable
-- by id (their content_hash covers every input, so an on-conflict upsert is a
-- value no-op) and are never GC'd, so a captured profile_id stays a valid pointer
-- to the exact embedding/centroid/genre intent behind every match_decision and
-- match_event that references the snapshot. Together with match_result's factors,
-- that's the full point-in-time feature vector a learning-to-rank model needs.

CREATE TABLE public.match_snapshot_playlist_profile (
  snapshot_id UUID NOT NULL REFERENCES match_snapshot(id) ON DELETE CASCADE,
  playlist_id UUID NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
  -- No ON DELETE: a profile referenced by a published snapshot is what produced
  -- the served results and MUST stay. Deleting the PLAYLIST still works — the
  -- mapping row is cascade-removed via playlist_id, and NO ACTION is checked at
  -- end-of-statement (after that cascade), so the profile delete that the
  -- playlist cascade triggers finds no surviving reference. If profile GC is ever
  -- added, it MUST exclude profiles referenced here (mirrors match_decision's
  -- snapshot guard).
  profile_id UUID NOT NULL REFERENCES playlist_profile(id),
  PRIMARY KEY (snapshot_id, playlist_id)
);

-- profile_id is NO ACTION, so deletes scan here for references; training also
-- queries "which snapshots used profile X".
CREATE INDEX idx_match_snapshot_playlist_profile_profile
  ON public.match_snapshot_playlist_profile(profile_id);
-- playlist_id is the trailing PK column, so a playlist delete can't use the PK
-- index to find its rows to cascade — index it explicitly.
CREATE INDEX idx_match_snapshot_playlist_profile_playlist
  ON public.match_snapshot_playlist_profile(playlist_id);

ALTER TABLE public.match_snapshot_playlist_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "match_snapshot_playlist_profile_deny_all"
  ON public.match_snapshot_playlist_profile FOR ALL USING (false);

-- ============================================================================
-- Capture the mapping inside publish_match_snapshot — the only path allowed to
-- write a snapshot. Same signature as 20260610120000, so the TS caller and its
-- tests are untouched; only the body gains the mapping INSERT.
--
-- SET search_path stays pinned INLINE: CREATE OR REPLACE discards config
-- settings attached by ALTER FUNCTION, so omitting it would silently undo the
-- SECURITY DEFINER hardening.
-- ============================================================================

CREATE OR REPLACE FUNCTION publish_match_snapshot(
  p_account_id UUID,
  p_algorithm_version TEXT,
  p_config_hash TEXT,
  p_playlist_set_hash TEXT,
  p_candidate_set_hash TEXT,
  p_snapshot_hash TEXT,
  p_playlist_count INTEGER,
  p_song_count INTEGER,
  p_results JSONB DEFAULT '[]'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot_id UUID;
  v_latest_hash TEXT;
BEGIN
  -- No-op only if the LATEST published snapshot already has this hash.
  SELECT snapshot_hash INTO v_latest_hash
  FROM match_snapshot
  WHERE account_id = p_account_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_latest_hash = p_snapshot_hash THEN
    RETURN NULL;
  END IF;

  -- Insert new snapshot
  INSERT INTO match_snapshot (
    account_id, algorithm_version, config_hash,
    playlist_set_hash, candidate_set_hash, snapshot_hash,
    playlist_count, song_count
  ) VALUES (
    p_account_id, p_algorithm_version, p_config_hash,
    p_playlist_set_hash, p_candidate_set_hash, p_snapshot_hash,
    p_playlist_count, p_song_count
  ) RETURNING id INTO v_snapshot_id;

  -- Insert results if any
  IF jsonb_array_length(p_results) > 0 THEN
    INSERT INTO match_result (
      snapshot_id, song_id, playlist_id,
      score, fused_score, rank, factors, normalized_factors
    )
    SELECT
      v_snapshot_id,
      (r->>'song_id')::UUID,
      (r->>'playlist_id')::UUID,
      (r->>'score')::DOUBLE PRECISION,
      (r->>'fused_score')::DOUBLE PRECISION,
      (r->>'rank')::INTEGER,
      COALESCE(r->'factors', '{}'::JSONB),
      COALESCE(r->'normalized_factors', '{}'::JSONB)
    FROM jsonb_array_elements(p_results) AS r;
  END IF;

  -- Record the profile each result playlist was matched with. Resolved via the
  -- SAME "newest profile per playlist" rule the matcher uses (getPlaylistProfile
  -- orders by updated_at DESC), so this pins the exact profile row that produced
  -- these results. Only playlists that actually have results are captured; the
  -- LATERAL join silently drops any playlist with no profile row.
  --
  -- SINGLE-FLIGHT INVARIANT (why re-resolving here is safe rather than threading
  -- the exact profile_id from the matcher): the only path that writes profiles
  -- for matching is the match_snapshot_refresh workflow, and a unique partial
  -- index on job (type='match_snapshot_refresh', status IN pending/running) makes
  -- it single-flight per account. So between the matcher computing a profile and
  -- this publish, no concurrent refresh can upsert a newer playlist_profile row,
  -- and the newest row IS the one matching used. The only way this captures the
  -- wrong profile is if ANOTHER profile-writing path (a second workflow, a manual
  -- backfill, a future re-profiler) runs concurrently for the same account. If
  -- such a path is ever added, thread the exact profile_id used by matching
  -- through publish_match_snapshot instead of re-resolving by updated_at.
  INSERT INTO match_snapshot_playlist_profile (snapshot_id, playlist_id, profile_id)
  SELECT v_snapshot_id, pl.playlist_id, prof.id
  FROM (
    SELECT DISTINCT playlist_id
    FROM match_result
    WHERE snapshot_id = v_snapshot_id
  ) pl
  JOIN LATERAL (
    SELECT id
    FROM playlist_profile pp
    WHERE pp.playlist_id = pl.playlist_id
    ORDER BY pp.updated_at DESC
    LIMIT 1
  ) prof ON TRUE;

  RETURN v_snapshot_id;
END;
$$;
