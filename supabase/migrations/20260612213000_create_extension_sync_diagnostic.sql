-- Privacy-light ledger of extension sync attempts so operators can analyze
-- real-world duration, rate limiting, and failure modes remotely.
--
-- One row per sync attempt (client-generated UUID for idempotent retries). No
-- song, playlist, artist, or token contents are stored here — only counts,
-- request-shape summaries, and the final outcome/error metadata.
--
-- Written via the service-role extension route; deny-all RLS keeps it internal.

CREATE TABLE extension_sync_diagnostic (
  id                                 UUID PRIMARY KEY,
  account_id                         UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  created_at                         TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_created_at                  TIMESTAMPTZ NOT NULL,
  extension_version                  TEXT NOT NULL,
  outcome                            TEXT NOT NULL CHECK (outcome IN ('success', 'backend_failure', 'extension_failure')),
  phase                              TEXT NOT NULL CHECK (phase IN ('idle', 'likedSongs', 'playlists', 'playlistTracks', 'artistImages', 'uploading')),
  backend_status                     INTEGER CHECK (backend_status IS NULL OR backend_status BETWEEN 100 AND 599),
  backend_failure_code               TEXT,
  retry_after_seconds                INTEGER CHECK (retry_after_seconds IS NULL OR retry_after_seconds > 0),
  error_message                      TEXT,
  duration_ms                        INTEGER NOT NULL CHECK (duration_ms >= 0),
  liked_songs_count                  INTEGER NOT NULL DEFAULT 0 CHECK (liked_songs_count >= 0),
  playlist_count                     INTEGER NOT NULL DEFAULT 0 CHECK (playlist_count >= 0),
  playlists_with_tracks_count        INTEGER NOT NULL DEFAULT 0 CHECK (playlists_with_tracks_count >= 0),
  playlist_tracks_count              INTEGER NOT NULL DEFAULT 0 CHECK (playlist_tracks_count >= 0),
  failed_playlist_track_fetch_count  INTEGER NOT NULL DEFAULT 0 CHECK (failed_playlist_track_fetch_count >= 0),
  skipped_empty_playlists_count      INTEGER NOT NULL DEFAULT 0 CHECK (skipped_empty_playlists_count >= 0),
  request_stats                      JSONB NOT NULL,
  request_policy                     JSONB NOT NULL
);

CREATE INDEX extension_sync_diagnostic_account_created_idx
  ON extension_sync_diagnostic (account_id, created_at DESC);

CREATE INDEX extension_sync_diagnostic_outcome_created_idx
  ON extension_sync_diagnostic (outcome, created_at DESC);

ALTER TABLE extension_sync_diagnostic ENABLE ROW LEVEL SECURITY;

CREATE POLICY "extension_sync_diagnostic_deny_all"
  ON extension_sync_diagnostic
  FOR ALL
  USING (false);

COMMENT ON TABLE extension_sync_diagnostic IS
  'Privacy-light ledger of extension sync attempts for operator diagnostics';
COMMENT ON COLUMN extension_sync_diagnostic.request_stats IS
  'Summary counts for Spotify requests (started/succeeded/failed/429/retries/wall time)';
COMMENT ON COLUMN extension_sync_diagnostic.request_policy IS
  'Conservative limiter configuration active for the sync attempt';
