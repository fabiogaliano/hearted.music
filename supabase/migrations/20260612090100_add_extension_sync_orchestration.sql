-- Asynchronous extension-sync orchestration: Storage staging bucket, the
-- single atomic ingress RPC, the worker claim RPC, and a one-call token
-- validator. Runs after the 'extension_sync' enum value is committed.

-- ---------------------------------------------------------------------------
-- Storage bucket for the staged 20 MB sync payloads.
--
-- Private (public=false) and intentionally policy-less: the only accessor is
-- the service-role admin client (Worker ingress writes, Bun worker reads +
-- deletes), which bypasses Storage RLS. Keeping the payload here — not in a
-- PostgREST insert/RPC — sidesteps the unverified PostgREST body-size limit and
-- keeps a 20 MB blob out of the 500 MB Free-plan database.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('sync-payloads', 'sync-payloads', false)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- begin_extension_sync — the atomic gate.
--
-- Replaces the route's racy getActiveSync()→createJob() sequence with one
-- transaction: advisory-lock the account, self-heal stale rows, enforce the
-- active-sync gate and the post-completion cooldown, create the parent +
-- three phase jobs, point user_preferences at the phase ids, and wake the
-- worker. The advisory lock closes the real race (two concurrent syncs both
-- passing the old SELECT gate); the partial unique index on sync_liked_songs
-- stays as a backstop.
--
-- Returns one of:
--   { "active": true, "jobId": <uuid> }                  -- a sync is in flight
--   { "cooldown": true, "retryAfterSeconds": <int> }     -- ran too recently
--   { "jobId": <uuid>, "phaseJobIds": { ... } }          -- enqueued
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION begin_extension_sync(
  p_account_id uuid,
  p_payload_path text,
  p_payload_bytes bigint
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Mirror the route's MAX cooldown / stale constants so the gate semantics
  -- are unchanged by the move into SQL.
  v_cooldown_ms     CONSTANT bigint   := 60000;
  v_stale_threshold CONSTANT interval := interval '10 minutes';
  v_active_id          uuid;
  v_last_completed_at  timestamptz;
  v_elapsed_ms         bigint;
  v_songs_id           uuid;
  v_playlists_id       uuid;
  v_tracks_id          uuid;
  v_parent_id          uuid;
  v_phase_job_ids      jsonb;
BEGIN
  -- Serialize concurrent syncs for this account; the lock releases at txn end.
  PERFORM pg_advisory_xact_lock(hashtext('extension_sync:' || p_account_id::text));

  -- Self-heal: a request (old inline path) or worker that died mid-flight can
  -- strand parent/phase rows in pending/running and lock the account out.
  --
  -- Parent staleness is checked against the heartbeat so a legitimately running
  -- worker (heartbeating every 30 s) is never killed by a concurrent re-trigger,
  -- even when wall-clock time exceeds 10 minutes. A pending parent with no
  -- heartbeat is stale by created_at (worker never picked it up — worker-down
  -- case that the self-heal exists for).
  --
  -- Phase rows are only failed if they do NOT belong to a still-active parent
  -- (one that survived the parent heal above). Legacy phase rows from the old
  -- inline path (no parent referencing them) are caught by the fallback timestamp
  -- rule so they cannot lock the gate via sync-phase-jobs queries.
  UPDATE job
  SET status = 'failed',
      completed_at = now(),
      error = 'stale sync job cleaned up before new sync attempt',
      updated_at = now()
  WHERE account_id = p_account_id
    AND type = 'extension_sync'
    AND status IN ('pending', 'running')
    AND CASE
          -- Running parent: stale only when the heartbeat is old.
          WHEN status = 'running'
            THEN coalesce(heartbeat_at, started_at, created_at) < now() - v_stale_threshold
          -- Pending parent: no heartbeat yet, stale by created_at.
          ELSE created_at < now() - v_stale_threshold
        END;

  -- Now fail phase rows that are pending/running but do NOT belong to any
  -- still-active parent for this account. Active parents are those that survived
  -- the parent-heal step above (status still pending/running).
  UPDATE job
  SET status = 'failed',
      completed_at = now(),
      error = 'stale sync job cleaned up before new sync attempt',
      updated_at = now()
  WHERE account_id = p_account_id
    AND type IN ('sync_liked_songs', 'sync_playlists', 'sync_playlist_tracks')
    AND status IN ('pending', 'running')
    -- Only fail if the phase row is older than the threshold (guards legacy rows)
    -- AND it is not referenced by any remaining active parent's phase_job_ids.
    AND coalesce(started_at, created_at) < now() - v_stale_threshold
    AND NOT EXISTS (
      SELECT 1
      FROM job parent
      WHERE parent.account_id = p_account_id
        AND parent.type = 'extension_sync'
        AND parent.status IN ('pending', 'running')
        AND (
          parent.progress->'phase_job_ids'->>'liked_songs'    = job.id::text OR
          parent.progress->'phase_job_ids'->>'playlists'      = job.id::text OR
          parent.progress->'phase_job_ids'->>'playlist_tracks' = job.id::text
        )
    );

  -- Gate: at most one active extension sync per account.
  SELECT id INTO v_active_id
  FROM job
  WHERE account_id = p_account_id
    AND type = 'extension_sync'
    AND status IN ('pending', 'running')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_active_id IS NOT NULL THEN
    RETURN jsonb_build_object('active', true, 'jobId', v_active_id);
  END IF;

  -- Cooldown: refuse if the most recent completed sync is too recent.
  SELECT completed_at INTO v_last_completed_at
  FROM job
  WHERE account_id = p_account_id
    AND type = 'extension_sync'
    AND status = 'completed'
  ORDER BY completed_at DESC
  LIMIT 1;

  IF v_last_completed_at IS NOT NULL THEN
    v_elapsed_ms := floor(extract(epoch FROM (now() - v_last_completed_at)) * 1000);
    IF v_elapsed_ms < v_cooldown_ms THEN
      RETURN jsonb_build_object(
        'cooldown', true,
        'retryAfterSeconds', greatest(1, ceil((v_cooldown_ms - v_elapsed_ms) / 1000.0))::int
      );
    END IF;
  END IF;

  -- Phase jobs first (sync_liked_songs is the unique-index sentinel), then the
  -- parent carrying the payload pointer + phase ids in its progress jsonb.
  INSERT INTO job (account_id, type, status)
  VALUES (p_account_id, 'sync_liked_songs', 'pending')
  RETURNING id INTO v_songs_id;

  INSERT INTO job (account_id, type, status)
  VALUES (p_account_id, 'sync_playlists', 'pending')
  RETURNING id INTO v_playlists_id;

  INSERT INTO job (account_id, type, status)
  VALUES (p_account_id, 'sync_playlist_tracks', 'pending')
  RETURNING id INTO v_tracks_id;

  v_phase_job_ids := jsonb_build_object(
    'liked_songs', v_songs_id,
    'playlists', v_playlists_id,
    'playlist_tracks', v_tracks_id
  );

  INSERT INTO job (account_id, type, status, progress)
  VALUES (
    p_account_id,
    'extension_sync',
    'pending',
    jsonb_build_object(
      'payload_path', p_payload_path,
      'payload_bytes', p_payload_bytes,
      'phase_job_ids', v_phase_job_ids
    )
  )
  RETURNING id INTO v_parent_id;

  -- Persist the phase ids so the web app can rediscover progress across reloads
  -- (existing user_preferences.phase_job_ids contract). No-op if the prefs row
  -- does not exist yet; getOrCreatePreferences guarantees it on session load.
  UPDATE user_preferences
  SET phase_job_ids = v_phase_job_ids
  WHERE account_id = p_account_id;

  -- Wake the worker immediately (LISTEN/NOTIFY). At-most-once delivery; the
  -- poll loop is the safety net. Payload stays out of the 8000-byte limit.
  PERFORM pg_notify(
    'job_created',
    json_build_object('id', v_parent_id, 'type', 'extension_sync')::text
  );

  RETURN jsonb_build_object('jobId', v_parent_id, 'phaseJobIds', v_phase_job_ids);
END;
$$;

-- ---------------------------------------------------------------------------
-- claim_pending_extension_sync_job — SKIP LOCKED claim for the Bun worker.
-- Clone of claim_pending_library_processing_job targeting the parent type.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_pending_extension_sync_job()
RETURNS SETOF job
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE job
  SET
    status = 'running',
    attempts = attempts + 1,
    started_at = now(),
    heartbeat_at = now(),
    updated_at = now()
  WHERE id = (
    SELECT id FROM job
    WHERE type = 'extension_sync'
      AND status = 'pending'
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

-- ---------------------------------------------------------------------------
-- validate_extension_token — fold the lookup + last_used_at stamp into one
-- round-trip (replaces the SELECT + fire-and-forget UPDATE in
-- extension-api-tokens.ts, saving a Worker subrequest). Returns the owning
-- account, or NULL when the token is unknown or revoked.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_extension_token(p_token_hash text)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE extension_api_token
  SET last_used_at = now()
  WHERE token_hash = p_token_hash
    AND revoked_at IS NULL
  RETURNING account_id;
$$;

-- Poll index for the worker claim path (LISTEN/NOTIFY is primary, poll is the
-- fallback; this keeps the fallback scan cheap).
CREATE INDEX IF NOT EXISTS idx_job_extension_sync_poll
  ON job (created_at)
  WHERE type = 'extension_sync' AND status = 'pending';

-- ---------------------------------------------------------------------------
-- Lock down the new RPCs to the service-role client, matching the posture of
-- every other internal RPC (see 20260519110000_harden_internal_rpcs.sql).
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION
  public.begin_extension_sync(uuid, text, bigint),
  public.claim_pending_extension_sync_job(),
  public.validate_extension_token(text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.begin_extension_sync(uuid, text, bigint),
  public.claim_pending_extension_sync_job(),
  public.validate_extension_token(text)
TO service_role;
