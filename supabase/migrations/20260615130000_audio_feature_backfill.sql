-- yt-dlp audio-feature backfill: queue, review/provenance, shared availability
-- state, claim/settlement RPCs, stale-lease sweep, and a global ReccoBeats
-- provider lease.
--
-- song_audio_feature is a per-song singleton (UNIQUE(song_id)). Backfill is the
-- async process that may create it after the catalog lookup misses. The pipeline
-- treats "does the song have audio features, and is backfill in flight?" as
-- first-class state via audio_feature_state(); the selector, audio stage,
-- analysis gate, worker, and control panel all read that one definition.

-- ===========================================================================
-- 1. Fallback queue table
-- ===========================================================================
-- A dedicated table, not an overload of the job enum: this is song-level work
-- with no account lifecycle. At most one active job per song (the partial unique
-- index below) because every source type writes the same singleton feature row.

CREATE TABLE audio_feature_backfill_job (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  requested_by_account_id UUID REFERENCES account(id) ON DELETE SET NULL,

  source_type TEXT NOT NULL CHECK (
    source_type IN ('youtube_search', 'youtube_url')
  ),
  source_url TEXT,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN (
      'pending',
      'running',
      'completed',
      'manual_needed',
      'failed',
      'cancelled',
      'obsolete'
    )
  ),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  not_before TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  lease_expires_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  superseded_by_job_id UUID REFERENCES audio_feature_backfill_job(id),
  error_code TEXT,
  error_message TEXT,
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audio_feature_backfill_job_pending_idx
  ON audio_feature_backfill_job (not_before, created_at)
  WHERE status = 'pending';

CREATE INDEX audio_feature_backfill_job_song_idx
  ON audio_feature_backfill_job (song_id, created_at DESC);

-- The race guard: only one pending/running job per song, regardless of source
-- type. Stops an auto-search and a manual URL job from both writing the row.
CREATE UNIQUE INDEX audio_feature_backfill_job_one_active_per_song
  ON audio_feature_backfill_job (song_id)
  WHERE status IN ('pending', 'running');

ALTER TABLE audio_feature_backfill_job ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER audio_feature_backfill_job_updated_at
  BEFORE UPDATE ON audio_feature_backfill_job
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ===========================================================================
-- 2. Review / provenance table
-- ===========================================================================
-- Provenance for auto-inserted or operator-provided features. Named generically
-- because it covers youtube_search and youtube_url alike; the UI label is
-- "Audio review".

CREATE TABLE audio_feature_source_review (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: the review is provenance/audit and must survive the
  -- deletion of the feature it describes. Operator reject deletes the
  -- song_audio_feature row and then marks this review 'rejected'; a CASCADE here
  -- would delete the review mid-reject and lose the audit trail. Nullable so the
  -- column can be cleared when the feature is removed.
  audio_feature_id UUID REFERENCES song_audio_feature(id) ON DELETE SET NULL,
  backfill_job_id UUID REFERENCES audio_feature_backfill_job(id) ON DELETE SET NULL,

  source_type TEXT NOT NULL CHECK (
    source_type IN ('youtube_search', 'youtube_url')
  ),

  youtube_video_id TEXT,
  youtube_url TEXT NOT NULL,
  youtube_title TEXT,
  youtube_channel TEXT,
  youtube_duration_seconds INTEGER,
  youtube_thumbnail_url TEXT,

  search_query TEXT,
  candidate_rank INTEGER,
  match_score REAL,
  match_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  rejected_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,

  clip_starts_seconds REAL[] NOT NULL,
  clip_features JSONB NOT NULL,
  averaged_features JSONB NOT NULL,
  aggregation_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'rejected')
  ),
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  rejection_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audio_feature_source_review_status_idx
  ON audio_feature_source_review (status, created_at DESC);

CREATE INDEX audio_feature_source_review_song_idx
  ON audio_feature_source_review (song_id, created_at DESC);

CREATE UNIQUE INDEX audio_feature_source_review_one_pending_per_song
  ON audio_feature_source_review (song_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX audio_feature_source_review_song_video_once
  ON audio_feature_source_review (song_id, youtube_video_id)
  WHERE youtube_video_id IS NOT NULL;

ALTER TABLE audio_feature_source_review ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER audio_feature_source_review_updated_at
  BEFORE UPDATE ON audio_feature_source_review
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ===========================================================================
-- 3. Global provider concurrency lease
-- ===========================================================================
-- audioFeatureBackfillConfig.concurrency is per worker process; this table
-- enforces the provider-level cap across replicas. Modeled as a single lock row
-- (concurrency 1). A lease expiry means a crashed holder can't wedge the lock.

CREATE TABLE provider_concurrency_lease (
  provider TEXT PRIMARY KEY,
  max_concurrency INTEGER NOT NULL DEFAULT 1,
  holder TEXT,
  acquired_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE provider_concurrency_lease ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER provider_concurrency_lease_updated_at
  BEFORE UPDATE ON provider_concurrency_lease
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

INSERT INTO provider_concurrency_lease (provider, max_concurrency)
VALUES ('reccobeats_file_analysis', 1);

-- Acquire succeeds when the lock is free, its lease has expired, or this holder
-- already owns it (re-entrant). The UPDATE's WHERE serializes acquirers on the
-- row, so the row_count tells us whether we won.
CREATE OR REPLACE FUNCTION acquire_provider_lease(
  p_provider TEXT,
  p_holder TEXT,
  p_lease_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE provider_concurrency_lease
  SET holder = p_holder,
      acquired_at = now(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  WHERE provider = p_provider
    AND (
      holder IS NULL
      OR lease_expires_at < now()
      OR holder = p_holder
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION release_provider_lease(
  p_provider TEXT,
  p_holder TEXT
)
RETURNS VOID
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE provider_concurrency_lease
  SET holder = NULL,
      acquired_at = NULL,
      lease_expires_at = NULL,
      updated_at = now()
  WHERE provider = p_provider
    AND holder = p_holder;
$$;

-- ===========================================================================
-- 4. Shared audio availability state
-- ===========================================================================
-- The one definition of "what's the audio-feature situation for this song".
-- Priority: ready > backfill_active > (latest of manual_needed/failed) > absent.
-- completed/cancelled/obsolete jobs are not blocking on their own — if their
-- feature row still exists the song is `ready`; if it was deleted the song falls
-- back to `absent`.
CREATE OR REPLACE FUNCTION audio_feature_state(p_song_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM song_audio_feature saf WHERE saf.song_id = p_song_id
    ) THEN 'ready'
    WHEN EXISTS (
      SELECT 1 FROM audio_feature_backfill_job j
      WHERE j.song_id = p_song_id AND j.status IN ('pending', 'running')
    ) THEN 'backfill_active'
    ELSE COALESCE(
      (
        SELECT CASE j.status
          WHEN 'manual_needed' THEN 'manual_needed'
          WHEN 'failed' THEN 'unavailable_terminal'
        END
        FROM audio_feature_backfill_job j
        WHERE j.song_id = p_song_id
          AND j.status IN ('manual_needed', 'failed')
        ORDER BY j.created_at DESC
        LIMIT 1
      ),
      'absent'
    )
  END;
$$;

-- Batch availability for TS callers (audio stage, analysis gate, worker
-- settlement, control panel). Returns the relevant feature/job ids so callers
-- don't re-query.
CREATE OR REPLACE FUNCTION get_audio_feature_availability(p_song_ids UUID[])
RETURNS TABLE(
  song_id UUID,
  state TEXT,
  audio_feature_id UUID,
  job_id UUID,
  error_code TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s AS song_id,
    audio_feature_state(s) AS state,
    (SELECT saf.id FROM song_audio_feature saf WHERE saf.song_id = s) AS audio_feature_id,
    (
      SELECT j.id FROM audio_feature_backfill_job j
      WHERE j.song_id = s
        AND j.status IN ('pending', 'running', 'manual_needed', 'failed')
      ORDER BY (j.status IN ('pending', 'running')) DESC, j.created_at DESC
      LIMIT 1
    ) AS job_id,
    (
      SELECT j.error_code FROM audio_feature_backfill_job j
      WHERE j.song_id = s AND j.status IN ('manual_needed', 'failed')
      ORDER BY j.created_at DESC
      LIMIT 1
    ) AS error_code
  FROM unnest(p_song_ids) AS s;
$$;

-- ===========================================================================
-- 5. Claim, enqueue, and fenced settlement RPCs
-- ===========================================================================

-- Lease the next due pending jobs and fence them to this worker.
CREATE OR REPLACE FUNCTION claim_pending_audio_feature_backfill_job(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 1,
  p_lease_seconds INTEGER DEFAULT 900
)
RETURNS SETOF audio_feature_backfill_job
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT id
    FROM audio_feature_backfill_job
    WHERE status = 'pending'
      AND not_before <= now()
      AND attempts < max_attempts
    ORDER BY not_before ASC, created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE audio_feature_backfill_job j
  SET status = 'running',
      attempts = attempts + 1,
      locked_at = now(),
      locked_by = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      started_at = COALESCE(started_at, now()),
      updated_at = now()
  FROM claimed
  WHERE j.id = claimed.id
  RETURNING j.*;
END;
$$;

-- Idempotent auto-search enqueue. If an active job already exists (another
-- worker won the race or a prior pass enqueued it), return that job instead of
-- erroring, so the caller can defer on it.
CREATE OR REPLACE FUNCTION enqueue_audio_feature_backfill_search(
  p_song_id UUID,
  p_requested_by_account_id UUID DEFAULT NULL
)
RETURNS audio_feature_backfill_job
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job audio_feature_backfill_job;
BEGIN
  SELECT * INTO v_job
  FROM audio_feature_backfill_job
  WHERE song_id = p_song_id AND status IN ('pending', 'running')
  ORDER BY created_at DESC
  LIMIT 1;
  IF FOUND THEN
    RETURN v_job;
  END IF;

  BEGIN
    INSERT INTO audio_feature_backfill_job (song_id, requested_by_account_id, source_type)
    VALUES (p_song_id, p_requested_by_account_id, 'youtube_search')
    RETURNING * INTO v_job;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_job
    FROM audio_feature_backfill_job
    WHERE song_id = p_song_id AND status IN ('pending', 'running')
    ORDER BY created_at DESC
    LIMIT 1;
  END;

  RETURN v_job;
END;
$$;

-- Manual URL replacement. Cancels any active job for the song first (so a late
-- automatic worker can't overwrite the operator's pick), then inserts the manual
-- job — atomically, since the whole function is one transaction.
CREATE OR REPLACE FUNCTION enqueue_audio_feature_backfill_manual(
  p_song_id UUID,
  p_source_url TEXT,
  p_requested_by_account_id UUID DEFAULT NULL
)
RETURNS audio_feature_backfill_job
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job audio_feature_backfill_job;
BEGIN
  UPDATE audio_feature_backfill_job
  SET status = 'obsolete',
      completed_at = now(),
      updated_at = now()
  WHERE song_id = p_song_id AND status IN ('pending', 'running');

  INSERT INTO audio_feature_backfill_job (song_id, requested_by_account_id, source_type, source_url)
  VALUES (p_song_id, p_requested_by_account_id, 'youtube_url', p_source_url)
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

-- Settlement RPCs are compare-and-set on (id, status='running', locked_by): a
-- cancelled or superseded worker that comes back late matches nothing and writes
-- nothing. SETOF (not a bare composite) so a rejected fence returns an empty set
-- the caller can detect, instead of a single all-NULL row.

CREATE OR REPLACE FUNCTION complete_audio_feature_backfill_job(
  p_job_id UUID,
  p_worker_id TEXT
)
RETURNS SETOF audio_feature_backfill_job
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE audio_feature_backfill_job
  SET status = 'completed',
      completed_at = now(),
      lease_expires_at = NULL,
      updated_at = now()
  WHERE id = p_job_id AND status = 'running' AND locked_by = p_worker_id
  RETURNING *;
$$;

-- Transient failure: back to pending with backoff, unless attempts are spent in
-- which case it becomes terminal failed.
CREATE OR REPLACE FUNCTION defer_audio_feature_backfill_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_retry_seconds INTEGER,
  p_error_code TEXT,
  p_error_message TEXT
)
RETURNS SETOF audio_feature_backfill_job
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE audio_feature_backfill_job
  SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
      not_before = CASE
        WHEN attempts >= max_attempts THEN not_before
        ELSE now() + make_interval(secs => p_retry_seconds)
      END,
      completed_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
      locked_at = NULL,
      locked_by = NULL,
      lease_expires_at = NULL,
      error_code = p_error_code,
      error_message = p_error_message,
      updated_at = now()
  WHERE id = p_job_id AND status = 'running' AND locked_by = p_worker_id
  RETURNING *;
$$;

-- Low-confidence search: operator-actionable terminal state. No auto-retry.
CREATE OR REPLACE FUNCTION mark_audio_feature_backfill_manual_needed(
  p_job_id UUID,
  p_worker_id TEXT,
  p_error_code TEXT,
  p_error_message TEXT
)
RETURNS SETOF audio_feature_backfill_job
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE audio_feature_backfill_job
  SET status = 'manual_needed',
      completed_at = now(),
      lease_expires_at = NULL,
      error_code = p_error_code,
      error_message = p_error_message,
      updated_at = now()
  WHERE id = p_job_id AND status = 'running' AND locked_by = p_worker_id
  RETURNING *;
$$;

-- Exhausted / non-recoverable: terminal failed.
CREATE OR REPLACE FUNCTION fail_audio_feature_backfill_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_error_code TEXT,
  p_error_message TEXT
)
RETURNS SETOF audio_feature_backfill_job
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE audio_feature_backfill_job
  SET status = 'failed',
      completed_at = now(),
      lease_expires_at = NULL,
      error_code = p_error_code,
      error_message = p_error_message,
      updated_at = now()
  WHERE id = p_job_id AND status = 'running' AND locked_by = p_worker_id
  RETURNING *;
$$;

-- Atomic fenced settlement of a successful run. In ONE transaction: re-check the
-- fence (id, status='running', locked_by), skip-and-complete a youtube_search job
-- if a feature appeared meanwhile, upsert the singleton feature row, insert the
-- provenance review, and mark the job completed. SETOF so a rejected fence
-- returns zero rows the caller can detect. Because it is one transaction, a
-- failure in the review insert (or any step) rolls back the feature upsert AND
-- the completion — we never strand a live auto-derived feature with no review.
-- youtube_url jobs may overwrite an existing feature (explicit operator
-- replacement); youtube_search jobs must not clobber a feature that landed while
-- they ran.
CREATE OR REPLACE FUNCTION settle_audio_feature_backfill_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_song_id UUID,
  p_source_type TEXT,
  p_features JSONB,
  p_review_status TEXT,
  p_reviewed_by TEXT,
  p_youtube_video_id TEXT,
  p_youtube_url TEXT,
  p_youtube_title TEXT,
  p_youtube_channel TEXT,
  p_youtube_duration_seconds INTEGER,
  p_youtube_thumbnail_url TEXT,
  p_search_query TEXT,
  p_candidate_rank INTEGER,
  p_match_score REAL,
  p_match_reasons JSONB,
  p_rejected_candidates JSONB,
  p_clip_starts_seconds REAL[],
  p_clip_features JSONB,
  p_aggregation_metadata JSONB
)
RETURNS TABLE(
  job_id UUID,
  audio_feature_id UUID,
  review_id UUID,
  did_skip BOOLEAN
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_song_id UUID;
  v_source_type TEXT;
  v_existing UUID;
  v_feature_id UUID;
  v_review_id UUID;
BEGIN
  -- Fence + row lock: a concurrent cancel/obsolete/sweep can't slip in between the
  -- check and the writes. A non-matching row (cancelled, superseded, wrong worker)
  -- yields zero rows. We read song_id/source_type straight off the locked row and
  -- treat those as authoritative below, so the RPC never writes based on a
  -- caller-provided copy of them.
  SELECT j.song_id, j.source_type INTO v_song_id, v_source_type
  FROM audio_feature_backfill_job j
  WHERE j.id = p_job_id AND j.status = 'running' AND j.locked_by = p_worker_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- The caller passes the claimed job's own song/source, so a mismatch is an
  -- inconsistent call. Refuse to write (like a rejected fence) rather than risk
  -- persisting features against the wrong song.
  IF p_song_id IS DISTINCT FROM v_song_id
     OR p_source_type IS DISTINCT FROM v_source_type THEN
    RETURN;
  END IF;

  -- youtube_url is an explicit operator replacement and may overwrite, so it
  -- upserts (DO UPDATE) and always gets a row back. youtube_search must NEVER
  -- clobber a feature that exists OR lands concurrently (catalog, or a manual
  -- replacement) between any check and this write, so it inserts DO NOTHING — the
  -- only race-free guard. No row back means a feature already won the slot, so we
  -- complete as a skip without writing a feature or a review.
  IF v_source_type = 'youtube_url' THEN
    INSERT INTO song_audio_feature (
      song_id, acousticness, danceability, energy, instrumentalness, liveness,
      loudness, speechiness, tempo, valence, key, mode, time_signature
    )
    VALUES (
      v_song_id,
      (p_features->>'acousticness')::REAL,
      (p_features->>'danceability')::REAL,
      (p_features->>'energy')::REAL,
      (p_features->>'instrumentalness')::REAL,
      (p_features->>'liveness')::REAL,
      (p_features->>'loudness')::REAL,
      (p_features->>'speechiness')::REAL,
      (p_features->>'tempo')::REAL,
      (p_features->>'valence')::REAL,
      NULL, NULL, NULL
    )
    ON CONFLICT (song_id) DO UPDATE SET
      acousticness = EXCLUDED.acousticness,
      danceability = EXCLUDED.danceability,
      energy = EXCLUDED.energy,
      instrumentalness = EXCLUDED.instrumentalness,
      liveness = EXCLUDED.liveness,
      loudness = EXCLUDED.loudness,
      speechiness = EXCLUDED.speechiness,
      tempo = EXCLUDED.tempo,
      valence = EXCLUDED.valence,
      key = EXCLUDED.key,
      mode = EXCLUDED.mode,
      time_signature = EXCLUDED.time_signature,
      updated_at = now()
    RETURNING id INTO v_feature_id;
  ELSE
    INSERT INTO song_audio_feature (
      song_id, acousticness, danceability, energy, instrumentalness, liveness,
      loudness, speechiness, tempo, valence, key, mode, time_signature
    )
    VALUES (
      v_song_id,
      (p_features->>'acousticness')::REAL,
      (p_features->>'danceability')::REAL,
      (p_features->>'energy')::REAL,
      (p_features->>'instrumentalness')::REAL,
      (p_features->>'liveness')::REAL,
      (p_features->>'loudness')::REAL,
      (p_features->>'speechiness')::REAL,
      (p_features->>'tempo')::REAL,
      (p_features->>'valence')::REAL,
      NULL, NULL, NULL
    )
    ON CONFLICT (song_id) DO NOTHING
    RETURNING id INTO v_feature_id;

    IF v_feature_id IS NULL THEN
      SELECT saf.id INTO v_existing
      FROM song_audio_feature saf
      WHERE saf.song_id = v_song_id;
      UPDATE audio_feature_backfill_job
      SET status = 'completed', completed_at = now(),
          lease_expires_at = NULL, updated_at = now()
      WHERE id = p_job_id;
      RETURN QUERY SELECT p_job_id, v_existing, NULL::UUID, TRUE;
      RETURN;
    END IF;
  END IF;

  INSERT INTO audio_feature_source_review (
    song_id, audio_feature_id, backfill_job_id, source_type,
    youtube_video_id, youtube_url, youtube_title, youtube_channel,
    youtube_duration_seconds, youtube_thumbnail_url,
    search_query, candidate_rank, match_score, match_reasons, rejected_candidates,
    clip_starts_seconds, clip_features, averaged_features, aggregation_metadata,
    status, reviewed_by, reviewed_at
  )
  VALUES (
    v_song_id, v_feature_id, p_job_id, v_source_type,
    p_youtube_video_id, p_youtube_url, p_youtube_title, p_youtube_channel,
    p_youtube_duration_seconds, p_youtube_thumbnail_url,
    p_search_query, p_candidate_rank, p_match_score,
    COALESCE(p_match_reasons, '[]'::jsonb), COALESCE(p_rejected_candidates, '[]'::jsonb),
    p_clip_starts_seconds, p_clip_features, p_features,
    COALESCE(p_aggregation_metadata, '{}'::jsonb),
    p_review_status, p_reviewed_by,
    CASE WHEN p_review_status = 'approved' THEN now() ELSE NULL END
  )
  RETURNING id INTO v_review_id;

  UPDATE audio_feature_backfill_job
  SET status = 'completed', completed_at = now(),
      lease_expires_at = NULL, updated_at = now()
  WHERE id = p_job_id;

  RETURN QUERY SELECT p_job_id, v_feature_id, v_review_id, FALSE;
END;
$$;

-- Sweep running jobs whose lease expired (crashed/killed worker). Back to
-- pending while attempts remain, else terminal failed, so the selector is never
-- wedged in backfill_active forever.
CREATE OR REPLACE FUNCTION sweep_stale_audio_feature_backfill_jobs()
RETURNS SETOF audio_feature_backfill_job
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE audio_feature_backfill_job j
  SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
      not_before = CASE WHEN attempts >= max_attempts THEN not_before ELSE now() END,
      completed_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
      error_code = CASE WHEN attempts >= max_attempts THEN 'lease_expired' ELSE error_code END,
      error_message = CASE
        WHEN attempts >= max_attempts THEN 'worker lease expired after max attempts'
        ELSE error_message
      END,
      locked_at = NULL,
      locked_by = NULL,
      lease_expires_at = NULL,
      updated_at = now()
  WHERE j.id IN (
    SELECT id FROM audio_feature_backfill_job
    WHERE status = 'running'
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at < now()
    FOR UPDATE SKIP LOCKED
  )
  RETURNING j.*;
$$;

-- ===========================================================================
-- 6. Grants
-- ===========================================================================
-- Tables inherit service_role grants via ALTER DEFAULT PRIVILEGES (see
-- 20260613030000). Functions only get PUBLIC's default EXECUTE; grant the
-- PostgREST-facing role explicitly so worker/app RPC calls don't 42501.

GRANT EXECUTE ON FUNCTION acquire_provider_lease(TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION release_provider_lease(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION audio_feature_state(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION get_audio_feature_availability(UUID[]) TO service_role;
GRANT EXECUTE ON FUNCTION claim_pending_audio_feature_backfill_job(TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION enqueue_audio_feature_backfill_search(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION enqueue_audio_feature_backfill_manual(UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION complete_audio_feature_backfill_job(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION defer_audio_feature_backfill_job(UUID, TEXT, INTEGER, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION mark_audio_feature_backfill_manual_needed(UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION fail_audio_feature_backfill_job(UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION settle_audio_feature_backfill_job(UUID, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, INTEGER, REAL, JSONB, JSONB, REAL[], JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION sweep_stale_audio_feature_backfill_jobs() TO service_role;

-- ===========================================================================
-- 7. Row level security
-- ===========================================================================
-- These are worker-only tables: every read/write goes through the worker's
-- service_role client, which bypasses RLS. No anon/authenticated path exists,
-- so each gets RLS enabled plus a deny-all policy (the project-wide convention,
-- see 20260116160005_add_rls_policies) to satisfy the security invariant that
-- every public table has RLS on with at least one policy.

ALTER TABLE audio_feature_backfill_job ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audio_feature_backfill_job_deny_all"
  ON audio_feature_backfill_job FOR ALL USING (false);

ALTER TABLE audio_feature_source_review ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audio_feature_source_review_deny_all"
  ON audio_feature_source_review FOR ALL USING (false);

ALTER TABLE provider_concurrency_lease ENABLE ROW LEVEL SECURITY;
CREATE POLICY "provider_concurrency_lease_deny_all"
  ON provider_concurrency_lease FOR ALL USING (false);
