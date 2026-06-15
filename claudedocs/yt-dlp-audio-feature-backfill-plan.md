# yt-dlp Audio Feature Backfill + Control Panel Review Plan

Status: planning document — no implementation has been done in this file.

## Goal

Automatically fill missing `song_audio_feature` rows when ReccoBeats catalog lookup cannot find a track, using YouTube audio via `yt-dlp`, while giving operators a `control-panel/` review center to approve/dismiss or reject/delete/re-place bad automatic insertions.

## Decisions already made

- Use **yt-dlp only** for automatic external acquisition. Do not implement Soulseek/slskd in this pass.
- Auto-derived features are inserted into `song_audio_feature` **immediately** so they can affect matching/analysis right away.
- Review center is a safety net:
  - **Approve** means “looks correct; dismiss from pending review”.
  - **Reject** deletes the exact inserted `song_audio_feature` row and records rejection.
  - Reject flow should allow operator replacement by pasting a YouTube URL.
- Prefer existing project patterns:
  - Bun worker.
  - Result/error-as-values style where existing modules use it.
  - No barrel exports.
  - Control panel remains isolated from product `src/` imports, matching `control-panel/README.md`.

## Web research summary

Relevant findings:

- `yt-dlp` supports YouTube search through `ytsearchN:<query>`.
- `yt-dlp` supports structured metadata output with `--dump-json` / `--dump-single-json` and no-download simulation.
- `yt-dlp` supports audio-only downloads and post-processing, but this plan should avoid transcoding the entire song when only clips are needed.
- `yt-dlp` docs strongly recommend `ffmpeg` and `ffprobe` for post-processing and media inspection.
- Docker/Ubuntu best practice is to install `ffmpeg`, `ffprobe`, Python, and install `yt-dlp` in the image, not on the VPS host. This is relevant for Coolify: rebuilding the worker image should be enough.

Useful references:

- yt-dlp repo/docs: https://github.com/yt-dlp/yt-dlp
- yt-dlp post-processing/audio options in README: `-x`, `--audio-format`, `--embed-metadata`, `--dump-json`, `ytsearch`.
- ReccoBeats audio file analysis docs: `POST /v1/analysis/audio-features`, multipart `audioFile`, max 5MB, max 30s. Audio beyond 30s is truncated; the docs recommend splitting longer audio into multiple files and averaging extracted values.

## Current repo touchpoints

Existing code that should be reused or extended:

- `src/lib/workflows/enrichment-pipeline/stages/audio-features.ts`
  - Current enrichment stage.
  - Today: Spotify ID → ReccoBeats catalog lookup → `song_audio_feature` upsert.
  - Should enqueue fallback when catalog lookup reports not found.

- `src/lib/integrations/reccobeats/service.ts`
  - Current ReccoBeats catalog client.
  - Do not overload it with file-analysis concerns unless clearly separated.

- `src/lib/integrations/audio/service.ts`
  - Current orchestration/persistence for audio features.
  - Can be extended or given a sibling for file-derived features.

- `src/lib/domains/enrichment/audio-features/queries.ts`
  - Existing `song_audio_feature` upsert/get code.
  - Reuse or add explicit insert/upsert returning row `id`.

- `src/worker/index.ts`
  - Existing Bun worker loops.
  - Add a dedicated YouTube audio fallback poll loop, parallel to existing loops.

- `Dockerfile.worker`
  - Needs `yt-dlp`, Python, `ffmpeg`, `ffprobe`.

- `control-panel/`
  - Add a new “Audio review” section.
  - Server-side endpoints should use existing direct SQL/service-role pattern.
  - UI should reuse `Card`, `Table`, `Badge`, `Loading`, `ErrorState`, `useApi`, `postJson`.

## High-level architecture

### Audio availability state model

`song_audio_feature` is a materialized song-level artifact, and yt-dlp backfill
is the asynchronous process that may create it after the normal catalog lookup
misses. The pipeline models this as first-class audio availability state. Every
pipeline decision that depends on audio features reads that same state.

Canonical states for a song's audio features:

- `ready` — a `song_audio_feature` row exists.
- `backfill_active` — one `audio_feature_backfill_job` is `pending` or
  `running`; no catalog lookup or LLM analysis should be requested while this is
  true.
- `manual_needed` — automatic backfill reached a terminal, operator-actionable
  result such as low-confidence search. Do not auto-search again; surface the
  song in the control panel.
- `unavailable_terminal` — automatic/manual backfill exhausted retries or hit a
  non-recoverable processing error. Treat audio as confirmed unavailable for
  analysis gating.
- `absent` — no feature row and no active/terminal backfill state. This is the
  only state where the audio stage may call ReccoBeats catalog lookup.

Implement this as a small domain query/RPC (for example
`getAudioFeatureAvailability(songIds)` backed by SQL that checks
`song_audio_feature` and `audio_feature_backfill_job`). The selector RPC,
`getReadyForAudioFeatures`, the post-Phase-A analysis gate, and the backfill
worker settlement path should all use this same state model.

Deferred audio work is represented by the active backfill job, not by a
`job_item_failure` suppression row. Failure rows remain for real terminal stage
failures only.

### Automatic path

1. Normal enrichment resolves audio availability state.
2. If state is `ready`, audio features are satisfied.
3. If state is `backfill_active`, the audio stage returns a non-failure deferred
   outcome and does not call ReccoBeats catalog lookup.
4. If state is `manual_needed` or `unavailable_terminal`, the audio stage reports
   confirmed audio unavailability and does not auto-search again.
5. Only if state is `absent`, the audio stage tries ReccoBeats catalog lookup.
6. If catalog returns `not_found`, enqueue a YouTube audio feature fallback job
   and return a deferred outcome.
7. Worker claims fallback job.
8. Worker searches YouTube with `yt-dlp`.
9. Worker scores candidates.
10. If top candidate passes confidence threshold:
   - download best audio to temp directory,
   - validate with `ffprobe`,
   - extract 1–3 mp3 clips with `ffmpeg` depending on source duration,
   - upload each generated clip to ReccoBeats file-analysis endpoint,
   - merge returned features with the feature-aware aggregation algorithm,
   - upsert `song_audio_feature`,
   - create pending review row linked to the exact inserted/updated audio feature.
11. If confidence is too low:
   - do not insert,
   - mark fallback job `manual_needed`,
   - surface in control panel as needing manual source.

### Manual YouTube URL path

1. Operator provides a YouTube URL in control panel.
2. Control panel cancels/obsoletes any active backfill for the song, then
   enqueues a fallback job with `source_type = 'youtube_url'`.
3. Worker downloads exactly that URL.
4. Worker analyzes and upserts features.
5. Operator chose it, so the review row is created `approved` immediately with `reviewed_by = 'control-panel'`.

## Worker container requirements

Update `Dockerfile.worker` to include Python, yt-dlp, ffmpeg, and ffprobe inside the container.

Suggested change:

```dockerfile
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    postgresql-client-17 \
    ca-certificates \
    python3 \
    python3-venv \
    python3-pip \
    ffmpeg \
  && python3 -m venv /opt/yt-dlp \
  && /opt/yt-dlp/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/yt-dlp/bin/pip install --no-cache-dir "yt-dlp[default,curl-cffi]" \
  && ln -s /opt/yt-dlp/bin/yt-dlp /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*
```

Notes:

- Keep tools in the Docker image so Coolify/VPS host setup does not matter beyond running the container.
- Use `Bun.spawn` / `Bun.spawnSync` with argv arrays. Avoid shell interpolation.
- Add startup or health-adjacent checks for:
  - `yt-dlp --version`
  - `ffmpeg -version`
  - `ffprobe -version`
- Use `audioFeatureBackfillConfig.tmpDir` (`/tmp/hearted-audio-feature-backfill`).
- Always remove temp files in `finally` blocks.

Configuration:

These are tuning constants, not per-deployment secrets, so they live as a single
plain object in a `config.ts` module — matching the existing
`src/lib/domains/taste/song-matching/config.ts` convention. No env vars, no
feature flag: the backfill is always on.

```ts
// src/lib/integrations/youtube-audio/config.ts
export const audioFeatureBackfillConfig = {
  concurrency: 1,
  tmpDir: "/tmp/hearted-audio-feature-backfill",
  maxDownloadMb: 80,
  searchResults: 8,
  minScore: 0.82,
  minScoreGap: 0.08,
  requestTimeoutMs: 120_000,
  clipCount: 3,
  clipSeconds: 30,
  clipBitrateKbps: 128,
  tempoHalfDoubleTolerance: 0.08,
} as const;
```

`concurrency: 1` is deliberate — ReccoBeats file analysis is rate-limited, so the
poll loop processes one job at a time per worker process. Add a database-backed
global provider lease/advisory lock around ReccoBeats file-analysis work so
horizontal worker replicas still share a global concurrency cap. Bump it only
after observing headroom.

## Database design

### 1. Fallback queue table

Prefer a dedicated table instead of overloading the existing `job` enum. This is
song-level fallback work and does not need account-level lifecycle semantics.

The table is also the source of truth for deferred audio state. Because
`song_audio_feature` is one row per song, there must be at most one active
backfill job per song, regardless of source type. Manual replacement must cancel
or obsolete any active automatic job before enqueueing the replacement.

Sketch:

```sql
create table public.audio_feature_backfill_job (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.song(id) on delete cascade,
  requested_by_account_id uuid references public.account(id) on delete set null,

  source_type text not null check (
    source_type in ('youtube_search', 'youtube_url')
  ),
  source_url text,

  status text not null default 'pending' check (
    status in (
      'pending',
      'running',
      'completed',
      'manual_needed',
      'failed',
      'cancelled',
      'obsolete'
    )
  ),
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  not_before timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  superseded_by_job_id uuid references public.audio_feature_backfill_job(id),
  error_code text,
  error_message text,
  progress jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index audio_feature_backfill_job_pending_idx
  on public.audio_feature_backfill_job (not_before, created_at)
  where status = 'pending';

create index audio_feature_backfill_job_song_idx
  on public.audio_feature_backfill_job (song_id, created_at desc);

create unique index audio_feature_backfill_job_one_active_per_song
  on public.audio_feature_backfill_job (song_id)
  where status in ('pending', 'running');
```

Why one active job per song instead of `(song_id, source_type)`: different
source types still write the same singleton `song_audio_feature` row. Allowing an
auto-search job and a manual URL job to run concurrently creates a real race,
where the slower job can overwrite the operator-approved source.

Claim RPC should lease work and fence writes:

```sql
create or replace function public.claim_pending_audio_feature_backfill_job(
  p_worker_id text,
  p_limit integer default 1,
  p_lease_seconds integer default 900
)
returns setof public.audio_feature_backfill_job
language plpgsql
security definer
as $$
begin
  return query
  with claimed as (
    select id
    from public.audio_feature_backfill_job
    where status = 'pending'
      and not_before <= now()
      and attempts < max_attempts
    order by not_before asc, created_at asc
    limit p_limit
    for update skip locked
  )
  update public.audio_feature_backfill_job j
  set status = 'running',
      attempts = attempts + 1,
      locked_at = now(),
      locked_by = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(started_at, now()),
      updated_at = now()
  from claimed
  where j.id = claimed.id
  returning j.*;
end;
$$;
```

Settlement helpers/RPCs should be compare-and-set style:

- enqueue fallback job idempotently; if an active job already exists, return that
  job id and state instead of erroring,
- for manual URL replacement, in one transaction mark any active job `obsolete`
  or `cancelled`, then insert the manual URL job,
- mark completed only when `id`, `status = 'running'`, and `locked_by` match;
  this prevents a cancelled/superseded worker from writing late,
- mark transient failure by setting `status = 'pending'` with retry/backoff in
  `not_before`, unless `attempts >= max_attempts`,
- mark low-confidence search as `manual_needed`,
- mark exhausted/non-recoverable processing as `failed`,
- never automatically enqueue a new `youtube_search` after `manual_needed` or
  terminal `failed`; only explicit operator action can create new work,
- sweep expired `running` leases back to `pending` or terminal `failed` so the
  selector cannot be wedged forever.

### 2. Global ReccoBeats provider lease

`audioFeatureBackfillConfig.concurrency` is per worker process, so the database
must enforce the provider-level cap when multiple worker replicas run. Add a
small DB-backed provider lease/advisory lock around the ReccoBeats file-analysis
section, initially with a global limit of 1.

Requirements:

- acquire before uploading the first generated clip;
- hold through all clip uploads for the job;
- set a lease expiry so crashes do not wedge the provider lock;
- release in `finally` after success/failure;
- fail/retry the job with backoff if the provider lease cannot be acquired.

### 3. Audio availability state helper

Add one shared helper/RPC and use it everywhere pipeline decisions need audio
state. Suggested return shape:

```ts
type AudioFeatureAvailability =
  | { state: "ready"; songId: string; audioFeatureId: string }
  | { state: "backfill_active"; songId: string; jobId: string }
  | { state: "manual_needed"; songId: string; jobId: string; errorCode: string | null }
  | { state: "unavailable_terminal"; songId: string; jobId: string; errorCode: string | null }
  | { state: "absent"; songId: string };
```

SQL priority:

1. `ready` if `song_audio_feature` exists.
2. `backfill_active` if latest relevant backfill job is `pending` or `running`.
3. `manual_needed` if latest relevant job is `manual_needed`.
4. `unavailable_terminal` if latest relevant job is terminal `failed`.
5. `absent` otherwise.

The selector RPC, audio stage, analysis gate, worker settlement, and control
panel should not each re-implement this logic.

### 4. Review/provenance table

Stores provenance for auto-inserted or manually provided features.

```sql
create table public.audio_feature_source_review (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.song(id) on delete cascade,
  audio_feature_id uuid not null references public.song_audio_feature(id) on delete cascade,
  backfill_job_id uuid references public.audio_feature_backfill_job(id) on delete set null,

  source_type text not null check (
    source_type in ('youtube_search', 'youtube_url')
  ),

  youtube_video_id text,
  youtube_url text,
  youtube_title text,
  youtube_channel text,
  youtube_duration_seconds integer,
  youtube_thumbnail_url text,

  search_query text,
  candidate_rank integer,
  match_score real,
  match_reasons jsonb not null default '[]'::jsonb,
  rejected_candidates jsonb not null default '[]'::jsonb,

  clip_starts_seconds real[] not null,
  clip_features jsonb not null,
  averaged_features jsonb not null,
  aggregation_metadata jsonb not null default '{}'::jsonb,

  status text not null default 'pending' check (
    status in ('pending', 'approved', 'rejected')
  ),
  reviewed_at timestamptz,
  reviewed_by text,
  rejection_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint audio_feature_source_review_youtube_required check (
    youtube_url is not null
  )
);

create index audio_feature_source_review_status_idx
  on public.audio_feature_source_review (status, created_at desc);

create index audio_feature_source_review_song_idx
  on public.audio_feature_source_review (song_id, created_at desc);

create unique index audio_feature_source_review_one_pending_per_song
  on public.audio_feature_source_review (song_id)
  where status = 'pending';

create unique index audio_feature_source_review_song_video_once
  on public.audio_feature_source_review (song_id, youtube_video_id)
  where youtube_video_id is not null;
```

The table is named generically (`audio_feature_source_review`) because it covers
automatic YouTube search and operator-provided YouTube URL sources alike. The
control-panel UI label is still “Audio review”.

## Worker modules to add

Suggested module layout:

```text
src/lib/integrations/youtube-audio/
  config.ts
  yt-dlp.ts
  ffmpeg.ts
  scoring.ts
  types.ts
  service.ts

src/lib/integrations/reccobeats/file-analysis.ts

src/lib/domains/enrichment/audio-feature-backfill/
  jobs.ts
  reviews.ts
  service.ts
  types.ts

src/worker/poll-audio-feature-backfill.ts
```

No barrel exports.

### `yt-dlp.ts`

Responsibilities:

- Check executable availability.
- Search YouTube.
- Hydrate candidate metadata.
- Download selected URL to temp file.

Use `Bun.spawn` with explicit args and timeout handling.

Search approach:

1. Run flat search:

```bash
yt-dlp --dump-single-json --skip-download --flat-playlist "ytsearch8:<query>"
```

2. Parse `entries` defensively. Some yt-dlp versions output JSON lines or different shapes, so wrapper should accept:
   - single object with `entries`, or
   - newline-delimited JSON objects.

3. Hydrate top candidates with:

```bash
yt-dlp --dump-single-json --skip-download --no-playlist "https://www.youtube.com/watch?v=<id>"
```

Download command:

```bash
yt-dlp \
  --no-playlist \
  --no-continue \
  --restrict-filenames \
  --max-filesize "80M" \
  -f "bestaudio[abr<=192]/bestaudio/best" \
  -o "/tmp/hearted-audio-feature-backfill/<jobId>/source.%(ext)s" \
  "<youtube-url>"
```

Notes:

- YouTube sources are often `webm`, `m4a`, or `opus`, not mp3.
- Do not require source mp3 for yt-dlp path.
- The ReccoBeats upload clips should be mp3.

### `ffmpeg.ts`

Responsibilities:

- Run `ffprobe` to validate input file.
- Compute duration.
- Extract clips.
- Clean up temp files.

Validation:

- Must contain at least one audio stream.
- Duration should be reasonable:
  - no hard minimum; intros/interludes are valid songs, so send whatever audio exists;
  - hard maximum: e.g. 20 minutes to avoid full mixes.
- Source file size under configured max.

Clip starts:

- ReccoBeats analyzes at most 30 seconds per upload and truncates longer files.
- Generate 1–3 clips from the source:
  - if duration is <= 30s, create one clip containing the available audio;
  - if duration is > 30s, use candidate centers at roughly 25%, 50%, and 75%, clamp to valid start positions, and de-duplicate identical starts caused by short duration.
- For each generated clip:

```ts
clipDuration = Math.min(duration, 30)
start = clamp(duration * fraction - clipDuration / 2, 0, duration - clipDuration)
fractions = [0.25, 0.5, 0.75]
```

Clip command:

```bash
ffmpeg -v error -y \
  -ss <start> \
  -t <clipDuration> \
  -i <source> \
  -vn \
  -ac 2 \
  -ar 44100 \
  -codec:a libmp3lame \
  -b:a 128k \
  <clip.mp3>
```

Ensure each clip is < 5MB before upload.

### `file-analysis.ts`

Responsibilities:

- Call ReccoBeats file endpoint:

```text
POST https://api.reccobeats.com/v1/analysis/audio-features
multipart/form-data: audioFile=@clip.mp3
```

- Parse response fields:
  - `acousticness`
  - `danceability`
  - `energy`
  - `instrumentalness`
  - `liveness`
  - `loudness`
  - `speechiness`
  - `tempo`
  - `valence`

- Respect rate limits:
  - retry on 429 using `Retry-After` if present,
  - retry transient 5xx/network failures,
  - cap retries.

- Require every generated clip to analyze successfully after per-clip retries. If
  any clip still fails, fail/retry the job instead of averaging partial data.
- Merge clip responses with feature-aware aggregation, not one blind arithmetic
  average:
  - duration-weighted arithmetic mean for bounded 0–1 features (`acousticness`,
    `danceability`, `energy`, `instrumentalness`, `liveness`, `speechiness`,
    `valence`);
  - duration-weighted loudness in linear power space, then convert back to dB;
  - tempo via weighted median after normalizing obvious half/double-tempo variants.
- Store raw `clip_features`, final `averaged_features`, and
  `aggregation_metadata` with method/version, clip durations, tempo strategy,
  tempo confidence, and per-feature spread. This matches ReccoBeats'
  documentation for audio longer than 30 seconds: divide it into multiple files,
  extract features from each, then compute the average.
- Set `key`, `mode`, `time_signature` to `null` because the file-analysis endpoint
  does not return them. This is safe: song-matching scoring
  (`src/lib/domains/taste/song-matching/scoring.ts`) only uses the 9 numeric
  features this endpoint *does* return (energy, valence, danceability,
  acousticness, instrumentalness, speechiness, liveness, tempo, loudness) and
  never reads key/mode/time_signature, so backfilled rows match exactly as well as
  catalog rows.

### `scoring.ts`

Responsibilities:

- Score candidate correctness.
- Reject obvious wrong versions.

Inputs:

- DB song:
  - `name`
  - `artists`
  - `album_name`
  - `duration_ms`
  - optional `spotify_id`
- YouTube candidate:
  - title
  - channel/uploader
  - duration
  - URL/video ID

Normalization:

- lowercase
- remove punctuation/diacritics
- remove bracketed suffixes for matching but retain them for penalty detection
- normalize `&` / `and`
- split artist arrays

Positive signals:

- title includes song title tokens
- title includes primary artist tokens
- channel is `<Artist> - Topic`
- channel includes artist name
- title contains:
  - `official audio`
  - `official video`
  - `provided to youtube by`
- duration difference small:
  - strong if <= 5s
  - okay if <= 12s
  - weak if duration unknown

Negative/reject signals:

Hard reject if title/channel indicates:

- `live`
- `remix`
- `cover`
- `karaoke`
- `instrumental` unless original/known instrumental
- `sped up`
- `slowed`
- `nightcore`
- `8d audio`
- `reaction`
- `tutorial`
- `lyrics` is not necessarily reject, but lower confidence unless no better official candidate

Thresholds:

- `minScore = 0.82`
- top candidate must beat second candidate by `0.08`
- if duration exists and differs by > 25s, reject unless title/channel is extremely strong.

Return a typed result:

```ts
type CandidateDecision =
  | { kind: "selected"; candidate: YoutubeCandidate; score: number; reasons: string[] }
  | { kind: "manual_needed"; candidates: ScoredCandidate[]; reason: string };
```

### `service.ts`

Orchestrates one backfill job:

1. Load and re-check the claimed job. If it is no longer `running` for this
   worker lease, stop without writing.
2. Load song row.
3. Resolve source:
   - `youtube_search`: search + score.
   - `youtube_url`: hydrate exact URL metadata.
4. Download source audio into job temp dir.
5. Validate source.
6. Extract clips.
7. Analyze clips with ReccoBeats.
8. Before DB writes, re-check the job fence (`id`, `status = 'running'`,
   `locked_by`). This prevents late writes from cancelled or superseded jobs.
9. Re-check `song_audio_feature`:
   - for `youtube_search`, if a feature now exists, skip/obsolete this auto job
     without overwriting;
   - for `youtube_url`, overwriting is allowed only because operator replacement
     cancelled/obsoleted active work before enqueueing the job.
10. Upsert `song_audio_feature` and return row.
11. Insert review/provenance row.
12. Resolve existing `job_item_failure` rows for `audio_features` where applicable.
13. Mark backfill job completed with the same fence.
14. Emit/wake enrichment for affected accounts so LLM analysis can run after the
   external backfill settles.
15. Cleanup temp dir.

Expected failures should be structured:

```ts
type AudioBackfillErrorCode =
  | "yt_search_no_candidates"
  | "yt_search_low_confidence"
  | "yt_download_failed"
  | "ffprobe_invalid_audio"
  | "ffmpeg_clip_failed"
  | "reccobeats_rate_limited"
  | "reccobeats_transient"
  | "source_missing"
  | "db_write_failed";
```

## Integration with existing audio features stage

The pipeline is state-driven, not retry-window-driven. The audio stage does not
write a suppression failure for deferred work. It creates or observes an active
backfill job, then lets the canonical audio availability state control future
selection.

### Selector rules

Update `select_liked_song_ids_needing_enrichment_work` to use the audio
availability helper:

- `needs_audio_features = true` only when availability is `absent`.
- `needs_audio_features = false` when availability is `ready`,
  `backfill_active`, `manual_needed`, or `unavailable_terminal`.
- `needs_analysis = false` while availability is `backfill_active`. This is what
  enforces "wait for yt-dlp in case it succeeds".
- `needs_analysis` may become true again once availability is `ready`,
  `manual_needed`, or `unavailable_terminal`. At that point the wait is over:
  analysis can use audio features if present, or fall back to lyrics-only / the
  existing input-missing rules if not.

Also handle historical rows: resolve existing unresolved non-terminal
`source_not_found` audio failure rows from the pre-backfill behavior during the
migration (`resolved_at = now()`), otherwise they can suppress the new backfill
path for up to 30 days.

### Stage outcome plumbing

Extend stage accounting with a first-class deferred count instead of encoding it
as failure:

```ts
type StageOutcome =
  | { kind: "skipped"; stage: EnrichmentStageName; candidateSongIds: string[] }
  | {
      kind: "attempted";
      stage: EnrichmentStageName;
      candidateSongIds: string[];
      attemptedSongIds: string[];
      succeededSongIds: string[];
      deferredSongIds: string[];
      failures: StageFailure[];
    };
```

Progress should count deferred songs as handled for the current chunk, but not as
successes or failures. Add a `deferred` stage status/count if useful for UI; at
minimum ensure `doneCount === 0 && hasMoreSongs` does not classify a pure
backfill-deferred chunk as a blocked hot loop.

### Audio stage rules

In `src/lib/workflows/enrichment-pipeline/stages/audio-features.ts`:

1. Resolve audio availability for the ready song IDs before any provider call.
2. `ready` → include in done/succeeded semantics by existing feature row.
3. `backfill_active` → put in `deferredSongIds`; do not call ReccoBeats catalog.
4. `manual_needed` / `unavailable_terminal` → do not call ReccoBeats catalog and
   do not auto-enqueue another YouTube search. These states should normally be
   filtered out by the selector; if a stale work plan includes them, treat them
   as terminal audio unavailability for this stage.
5. `absent` → call ReccoBeats catalog lookup.
6. Catalog success → upsert `song_audio_feature` as today.
7. Catalog `not_found` → enqueue `youtube_search` fallback. If enqueue returns an
   existing active job because another worker won the race, use that job. Either
   way, put the song in `deferredSongIds` and record no `source_not_found`
   failure row.
8. Catalog transient/provider error → keep existing provider failure behavior.

### Post-Phase-A analysis gate

The current orchestrator computes the work plan once, before Phase A. That means
Phase B can run from a stale `needAnalysis` list after Phase A just created a
backfill job. Fix this at the root by adding a fresh gate immediately before
`runSongAnalysis`:

1. Start from `workPlan.needAnalysis`.
2. Re-read audio availability for those song IDs after audio features and genre
   tagging finish.
3. Remove/defer songs whose state is `backfill_active`.
4. Allow songs whose state is `ready`, `manual_needed`, `unavailable_terminal`,
   or `absent` to proceed. `absent` should be rare here; if it occurs, the audio
   stage did not request backfill and the existing analysis input-gate behavior
   should decide whether lyrics-only analysis is possible.

This gate is the piece that prevents LLM analysis from running too early in the
same chunk that enqueued yt-dlp backfill.

### Backfill settlement must wake enrichment

Because the selector hides `backfill_active` songs, the account-level enrichment
job may legitimately settle while yt-dlp is still running. “Wake” here means an
internal library-processing scheduling signal, not a user notification. Every
terminal backfill state transition must wake the library-processing system again:

- on `completed`, wake affected accounts so analysis can run with the new audio
  features;
- on `manual_needed` or terminal `failed`, wake affected accounts so analysis can
  proceed without waiting forever, or surface the existing input-missing/manual
  source state.

Prefer a small internal library-processing change such as
`audio_feature_backfill_settled` carrying `songId` and affected account IDs. The
affected accounts are all accounts that currently like the song and have
entitlement/unlock for it, not only `requested_by_account_id`, because the audio
feature row is song-level shared data.

### Hot-loop guarantees

The no-hot-loop guarantee comes from all of these together:

- one active backfill job per song in the database,
- selector hides `backfill_active` from both audio lookup and analysis,
- audio stage independently checks availability before provider calls,
- terminal `manual_needed` / `failed` states suppress automatic re-search,
- backfill worker fences writes by job lease so superseded jobs cannot overwrite,
- stale-running sweeps clear or terminalize expired leases.

## Control panel review center

### Navigation

Add new nav item in `control-panel/src/App.tsx`:

- key: `audio-review`
- label: `Audio review`
- icon: `WaveformIcon` or similar from Phosphor.

### Server endpoints

Add handlers in `control-panel/server/index.ts`:

```text
GET  /api/audio-feature-reviews?status=pending|approved|rejected
POST /api/audio-feature-reviews/:id/approve
POST /api/audio-feature-reviews/:id/reject
POST /api/audio-feature-reviews/:id/replace-youtube
POST /api/audio-feature-manual-jobs/youtube-url
```

The MVP ships these:

```text
GET  /api/audio-feature-reviews?status=pending
POST /api/audio-feature-reviews/:id/approve
POST /api/audio-feature-reviews/:id/reject
POST /api/audio-feature-reviews/:id/replace-youtube
```

### Server implementation files

Suggested files:

```text
control-panel/server/audio-feature-reviews.ts
control-panel/src/sections/AudioReviewSection.tsx
```

Keep server SQL local to `control-panel/server/` and do not import product modules.

### Review list query shape

Return:

```ts
interface AudioFeatureReviewRow {
  id: string;
  status: "pending" | "approved" | "rejected";
  sourceType: "youtube_search" | "youtube_url";
  createdAt: string;

  songId: string;
  songName: string;
  artists: string[];
  albumName: string | null;
  imageUrl: string | null;
  spotifyDurationMs: number | null;

  audioFeatureId: string;
  acousticness: number | null;
  danceability: number | null;
  energy: number | null;
  instrumentalness: number | null;
  liveness: number | null;
  loudness: number | null;
  speechiness: number | null;
  tempo: number | null;
  valence: number | null;

  youtubeUrl: string | null;
  youtubeVideoId: string | null;
  youtubeTitle: string | null;
  youtubeChannel: string | null;
  youtubeDurationSeconds: number | null;
  youtubeThumbnailUrl: string | null;

  searchQuery: string | null;
  matchScore: number | null;
  matchReasons: string[];
  clipStartsSeconds: number[];
  aggregationMetadata: Record<string, unknown>;
}
```

### UI behavior

Each pending review card/table row should show:

- “Pending review · currently live” warning.
- App song metadata.
- YouTube title/channel/duration.
- YouTube link.
- Optional embed/thumbnail.
- Match score and reasons.
- Extracted feature values.
- Aggregation metadata, especially low tempo confidence or high per-feature spread.

Actions:

- **Looks correct**
  - calls approve endpoint.
  - marks `status = 'approved'`, `reviewed_at = now()`.

- **Reject & delete feature**
  - destructive confirm.
  - deletes the exact feature row by `audio_feature_id` and `song_id`.
  - marks review `rejected`.

- **Replace with YouTube URL**
  - input for URL.
  - recommended behavior:
    1. reject/delete current feature,
    2. enqueue new `youtube_url` job,
    3. show queued replacement result.

### Approval SQL

```sql
update public.audio_feature_source_review
set status = 'approved',
    reviewed_at = now(),
    reviewed_by = $reviewed_by,
    updated_at = now()
where id = $id
  and status = 'pending';
```

### Reject SQL

Reject must be transactional and delete only the exact linked row.

```sql
begin;

select *
from public.audio_feature_source_review
where id = $id
  and status = 'pending'
for update;

delete from public.song_audio_feature saf
using public.audio_feature_source_review r
where r.id = $id
  and saf.id = r.audio_feature_id
  and saf.song_id = r.song_id;

update public.audio_feature_source_review
set status = 'rejected',
    reviewed_at = now(),
    reviewed_by = $reviewed_by,
    rejection_reason = $reason,
    updated_at = now()
where id = $id;

commit;
```

If zero rows are deleted, return an explicit warning/error because the feature may have already been replaced.

### Downstream invalidation on reject

Auto-derived features are live immediately, so a later rejection can mean
`song_analysis` and `song_embedding` were generated from bad audio features.
Reject should therefore do more than delete the feature row:

- If `song_analysis.created_at >= audio_feature_source_review.created_at` and the
  analysis payload includes audio feature context, delete or invalidate that
  `song_analysis` row.
- Delete/invalidate the corresponding `song_embedding` because it derives from
  the analysis text.
- Wake enrichment for affected accounts so the song can be re-analyzed with the
  replacement feature or lyrics-only inputs.
- Keep the delete scoped to the rejected review's song and feature provenance;
  do not bulk-delete unrelated analysis created before the rejected feature.

Preferred MVP behavior is invalidation + wake. The alternative is to prevent LLM
analysis from consuming pending-review auto features until review is approved,
but that contradicts the earlier decision that auto features are live
immediately. Do not leave this implicit: otherwise rejection leaves stale
downstream artifacts.

## Manual replacement semantics

### Replace with YouTube URL

Input validation:

- Allow only YouTube hosts:
  - `youtube.com`
  - `www.youtube.com`
  - `music.youtube.com`
  - `youtu.be`
- Extract and store canonical URL/video ID if possible.
- Enqueue:

```text
source_type = 'youtube_url'
source_url = '<url>'
```

Suggested sequence:

1. Reject current review and delete exact feature.
2. In the same transaction, cancel/obsolete any active backfill job for the song.
3. Enqueue the replacement job.
4. UI shows replacement queued.

The worker must fence completion by job status/lease so a cancelled automatic job
cannot write a late feature over the operator-provided replacement.

## ReccoBeats analysis details

File endpoint constraints:

- Max upload file size: 5MB.
- Maximum audio length: 30s; ReccoBeats truncates audio beyond 30s.
- Supported upload formats include MP3.
- ReccoBeats documents the multi-clip approach for longer audio: divide audio
  into multiple files, extract features from each, then average the values.

For every source:

1. Extract 1–3 mp3 clips depending on source duration.
2. Upload clips sequentially under the DB-backed global ReccoBeats provider lock.
3. Require every generated clip to succeed after retries; fail/retry the job on
   partial clip failure rather than averaging incomplete data.
4. Merge successful generated clip features with the feature-aware aggregation
   algorithm below.
5. Insert/upsert:

```ts
{
  song_id,
  acousticness,
  danceability,
  energy,
  instrumentalness,
  liveness,
  loudness,
  speechiness,
  tempo,
  valence,
  key: null,
  mode: null,
  time_signature: null,
}
```

Aggregation algorithm:

- Treat generated clips as weighted by actual clip duration. With normal 30s
  clips this collapses to equal weighting, but short tracks and de-duplicated
  starts still aggregate correctly.
- For bounded 0–1 features, use duration-weighted arithmetic mean:
  - `acousticness`
  - `danceability`
  - `energy`
  - `instrumentalness`
  - `liveness`
  - `speechiness`
  - `valence`
- For `loudness`, do not average dB directly. Convert each dB value to linear
  power, take the duration-weighted mean, then convert back to dB:

```ts
linear = 10 ** (loudnessDb / 10)
averageDb = 10 * Math.log10(weightedMean(linearValues, durations))
```

- For `tempo`, avoid plain arithmetic mean because half-time/double-time
  estimates can produce fake tempos. Use weighted median after normalizing each
  clip tempo to the closest half/double variant of the dominant cluster:
  - generate candidate variants for each clip tempo: `tempo / 2`, `tempo`,
    `tempo * 2` within the valid ReccoBeats tempo range;
  - use the weighted median raw tempo as the initial reference;
  - map each clip tempo to the variant closest to that reference;
  - take the weighted median of the normalized tempos;
  - if normalized tempos still disagree beyond `tempoHalfDoubleTolerance`, keep
    the weighted median but set `tempoConfidence = "low"` in metadata.
- Store `aggregation_metadata`, for example:

```ts
{
  method: "duration_weighted_feature_aware_v1",
  clipDurationsSeconds: [30, 30, 30],
  tempoStrategy: "weighted_median_half_double_normalized",
  tempoConfidence: "high", // "high" | "low"
  featureStdDev: {
    energy: 0.04,
    valence: 0.09,
    tempo: 2.1
  }
}
```

Rate limiting:

- On 429, respect `Retry-After` header.
- Limit global ReccoBeats file-analysis concurrency with a DB-backed provider
  lease/advisory lock, initially capped at 1.
- Do not analyze many songs in parallel initially.

## Safety, policy, and security

- Do not accept arbitrary non-YouTube URLs.
- Do not use browser cookies in the worker unless explicitly needed later.
- Do not expose temporary files.
- Delete temp files in `finally`.
- Avoid logging sensitive tokens or full URLs that contain secrets.
- Log YouTube video IDs/URLs only where acceptable for operator review.
- Treat all yt-dlp output and metadata as untrusted.

## Observability

Log structured events:

- `youtube-audio-backfill-queued`
- `youtube-audio-backfill-claimed`
- `youtube-audio-search-complete`
- `youtube-audio-candidate-selected`
- `youtube-audio-low-confidence`
- `youtube-audio-download-complete`
- `youtube-audio-clips-created`
- `youtube-audio-reccobeats-complete`
- `youtube-audio-feature-upserted`
- `youtube-audio-review-created`
- `youtube-audio-backfill-failed`

Metrics to expose in control panel eventually:

- pending review count
- approved count
- rejected count
- auto candidate acceptance rate
- low-confidence/manual-needed count
- average processing duration
- ReccoBeats failures/rate limits

## Testing plan

Use `bun run test`.

### Unit tests

- `scoring.ts`
  - exact official audio wins.
  - live/remix/cover/sped-up/slowed rejected.
  - duration mismatch penalized.
  - top score gap enforced.

- `ffmpeg.ts` arg builder
  - clip starts computed correctly.
  - short duration handling.
  - temp paths scoped by job ID.

- `yt-dlp.ts` parser
  - parses `entries` object.
  - parses newline JSON fallback.
  - handles no candidates.

- `file-analysis.ts`
  - aggregates bounded 0–1 features with duration-weighted mean.
  - aggregates loudness in linear power space, then converts back to dB.
  - aggregates tempo with weighted median plus half/double normalization.
  - requires every generated clip to succeed after retries.
  - handles 429 retry-after.
  - rejects malformed response.

- job service
  - high-confidence path upserts + review created.
  - low-confidence path does not insert.
  - manual URL path marks approved.
  - auto-search skips final write if a `song_audio_feature` appeared after the job started.
  - global provider lock acquisition/release wraps ReccoBeats clip uploads.
  - cleanup happens on failure.

### Deferred-state integration tests

These are the highest-value tests for the plumbing because they verify the
shared audio availability state across selector, stages, and worker settlement.

- Selector suppresses active backfill:
  - fixture has entitled liked song, no `song_audio_feature`, and an
    `audio_feature_backfill_job` with `status = 'pending'` or `running`;
  - selector returns no `needs_audio_features` for that song;
  - selector also returns no `needs_analysis` while the backfill is active.

- Audio stage does not re-request catalog while active:
  - fixture or mocked availability returns `backfill_active`;
  - `runAudioFeatures` returns the song as deferred;
  - ReccoBeats catalog lookup mock is not called;
  - no `source_not_found` / `job_item_failure` row is recorded.

- Catalog miss creates one active job and defers:
  - ReccoBeats returns `not_found`;
  - audio stage enqueues exactly one `youtube_search` job;
  - repeated stage/selector passes observe that job and do not enqueue or lookup
    again.

- Same-chunk analysis gate:
  - initial work plan includes `needAudioFeatures` and `needAnalysis` for the
    same song;
  - audio stage creates a backfill job;
  - the post-Phase-A gate removes the song from the analysis sub-batch;
  - LLM analysis mock is not called and no `song_analysis` row is created.

- Backfill success resumes analysis:
  - backfill worker marks job `completed` and inserts `song_audio_feature`;
  - settlement emits/wakes enrichment for affected accounts;
  - next selector pass allows `needs_analysis`;
  - analysis receives the new audio features.

- Terminal/manual-needed backfill stops waiting and does not auto-retry:
  - job settles as `manual_needed` or terminal `failed`;
  - selector does not return `needs_audio_features`;
  - selector may return `needs_analysis` if analysis is still missing;
  - audio stage does not enqueue another `youtube_search` job.

- Manual replacement cancels active auto job:
  - an auto-search job is `running`;
  - operator replaces with YouTube URL;
  - active auto job becomes `obsolete`/`cancelled` and manual job is inserted;
  - late completion from the superseded worker is fenced and cannot update
    `song_audio_feature`.

- Stale-running recovery:
  - a `running` job with expired `lease_expires_at` is swept;
  - it returns to `pending` when attempts remain or becomes terminal `failed`
    when attempts are exhausted;
  - selector is not wedged forever in `backfill_active`.

- Historical `source_not_found` migration:
  - unresolved audio `source_not_found` failure row exists from old behavior;
  - migration resolves the row with `resolved_at = now()`;
  - new selector/stage can start the backfill path immediately.

### Control panel tests

If existing control-panel tests are limited, add lightweight server/action tests where practical:

- approve endpoint updates status.
- reject endpoint deletes exact `audio_feature_id` only.
- reject invalidates downstream `song_analysis` / `song_embedding` only when they
  were created after the rejected feature and used audio context.
- replace YouTube validates host.
- replace YouTube cancels/obsoletes active auto jobs transactionally.
- review list maps DB rows to UI shape.

### External-process tests

Do not call real YouTube/ReccoBeats in unit tests.

- Stub `Bun.spawn`/process wrapper.
- Stub `fetch` for ReccoBeats.
- Optionally add a manual smoke script, not part of default tests:

```text
scripts/smoke/yt-dlp-audio-feature-backfill.ts
```

## Implementation phases

### Phase 1 — infrastructure and schema

- Update `Dockerfile.worker` with yt-dlp/ffmpeg/ffprobe.
- Add `audioFeatureBackfillConfig` object in `src/lib/integrations/youtube-audio/config.ts`.
- Add DB migration:
  - `audio_feature_backfill_job` with one active job per song, lease columns, and
    terminal statuses (`manual_needed`, `failed`, `cancelled`, `obsolete`),
  - review/provenance table,
  - audio availability helper/RPC used by selector and stages,
  - claim/settlement RPCs with fenced completion,
  - stale-running sweep support,
  - DB-backed global ReccoBeats provider lease/advisory lock.
- Add generated database types after migration if workflow requires it.

Acceptance:

- Worker image builds.
- `yt-dlp`, `ffmpeg`, `ffprobe` available inside container.
- Migration applies locally.
- The database enforces one active backfill job per song.
- The availability helper returns `ready`, `backfill_active`, `manual_needed`,
  `unavailable_terminal`, or `absent` for representative fixtures.

### Phase 2 — core worker services

- Add yt-dlp wrapper.
- Add ffprobe/ffmpeg wrapper.
- Add ReccoBeats file-analysis client.
- Add DB-backed global ReccoBeats provider lease/advisory lock helper.
- Add scoring.
- Add backfill job service using fenced settlement.
- Add affected-account wake/enrichment event helper for backfill settlement.
- Add tests.

Acceptance:

- A mocked high-confidence YouTube candidate produces feature-aware aggregated features and writes review row.
- A low-confidence result marks the job `manual_needed` and does not write audio features.
- A cancelled/superseded job cannot write a late `song_audio_feature` row.
- An auto-search job skips final write if another feature appeared while it was running.
- All generated clips must succeed before aggregated features are written.

### Phase 3 — worker polling loop

- Add `src/worker/poll-audio-feature-backfill.ts`.
- Wire into `src/worker/index.ts`.
- Respect `audioFeatureBackfillConfig.concurrency` and the DB-backed global
  ReccoBeats provider lease/advisory lock.
- Add stale running-job recovery; this is required, not optional.
- Emit/wake enrichment when a job settles as `completed`, `manual_needed`, or
  terminal `failed`.

Acceptance:

- Pending fallback jobs are claimed and processed.
- Running jobs heartbeat or do not wedge indefinitely.
- Expired leases are retried or terminalized.
- ReccoBeats file-analysis work is globally serialized across worker replicas.
- Backfill settlement schedules follow-up enrichment for affected accounts.

### Phase 4 — deferred-state pipeline integration

- Extend stage outcome/accounting/progress to represent deferred songs without
  writing failure rows.
- Update `select_liked_song_ids_needing_enrichment_work` to use audio
  availability state:
  - hide `backfill_active` from audio lookup and analysis,
  - prevent automatic retry for `manual_needed` / terminal `failed`,
  - allow analysis again once backfill is no longer active.
- Resolve historical unresolved audio `source_not_found` rows in the migration so
  old suppression does not block the new backfill path.
- Update `src/lib/workflows/enrichment-pipeline/stages/audio-features.ts`:
  - check availability before ReccoBeats,
  - enqueue `youtube_search` only from `absent` + catalog `not_found`,
  - return deferred for active/enqueued jobs.
- Add the post-Phase-A analysis gate so a song whose backfill was just enqueued
  in the same chunk is not sent to LLM analysis.
- Add the deferred-state integration tests listed above.

Acceptance:

- Catalog miss creates exactly one active fallback job per song and records no
  `source_not_found` failure.
- While a job is pending/running, repeated selector/stage passes do not call
  ReccoBeats catalog lookup and do not run LLM analysis.
- Backfill completion makes the feature exist and subsequent analysis uses it.
- Terminal/manual-needed backfill stops waiting, prevents auto-search retry, and
  allows the analysis/input-missing path to proceed.

### Phase 5 — control-panel review MVP

- Add `AudioReviewSection`.
- Add server endpoints:
  - list pending
  - approve
  - reject/delete
  - replace with YouTube URL
- Add UI actions with destructive confirmation.

Acceptance:

- Pending auto insertions appear as “currently live”.
- Approve hides row from pending.
- Reject deletes exact feature row and marks rejected.
- Replace with URL enqueues manual URL job.

### Phase 6 — production rollout

- Deploy the rebuilt worker image.
- Verify `yt-dlp`/`ffmpeg`/`ffprobe` binaries in container logs.
- Review the first pending rows in the control panel as real misses flow through.
- Tune scoring thresholds (`minScore`, `minScoreGap`) in `config.ts` based on the
  observed rejection rate.

## Acceptance criteria for the whole feature

- ReccoBeats catalog misses can be automatically backfilled via yt-dlp when confidence is high.
- Catalog misses create deferred backfill work, not `source_not_found` failure rows.
- While backfill is active, neither ReccoBeats catalog lookup nor LLM analysis hot-loops for that song.
- Auto features are live immediately in `song_audio_feature`.
- Every auto insertion has a review/provenance row with YouTube link and scoring reasons.
- Operators can approve/dismiss correct rows.
- Operators can reject rows, which deletes the exact inserted feature row and invalidates downstream artifacts that used it.
- Operators can replace rejected/bad rows with a YouTube URL.
- Worker cleans up temp files and respects provider rate limits with a DB-backed global provider lock.
- Dockerized worker runs on Ubuntu/Coolify without host-level yt-dlp/ffmpeg install.
- Tests cover scoring, parsing, feature-aware aggregation, DB write semantics, deferred-state plumbing, and review actions.

## Resolved decisions

1. **Table name:** `audio_feature_source_review` (general — covers automatic
   YouTube search and operator-provided YouTube URL sources). UI label stays
   “Audio review”.
2. **Manual URL replacement flow:** reject deletes the exact `song_audio_feature`
   row, cancels/obsoletes active backfill work for the song, then enqueues the
   replacement job. The song has no audio feature until the new job completes —
   accepted gap.
3. **Manual YouTube URL jobs** create `approved` review rows for provenance.
4. **Control panel** shows pending only for the MVP; status filters for
   approved/rejected come later.
5. **Configuration** is a single `audioFeatureBackfillConfig` object constant — no
   env vars, no feature flag. The backfill is always on.
6. **Manual MP3 upload is out of scope** — replacement is YouTube URL only.
7. **Catalog miss is deferred work, not a failure** — deferral is represented by
   the active backfill job, not by a `job_item_failure` suppression row.
8. **One active backfill job per song** — both automatic search and manual URL
   jobs write the same singleton `song_audio_feature` row, so manual replacement
   cancels/obsoletes any active automatic job before enqueueing the replacement.
9. **LLM analysis waits only while backfill is active** — once backfill completes
   or settles terminal/manual-needed, enrichment is woken and analysis can run
   with the feature if present or the existing no-audio behavior if not.
10. **Reject invalidates downstream derived artifacts** — rejecting a live auto
   feature also invalidates analysis/embedding rows that were derived from that
   feature, then wakes enrichment.
11. **Historical audio `source_not_found` rows are resolved in migration** — old
   unresolved non-terminal catalog-miss rows should get `resolved_at = now()` so
   they do not suppress the new backfill path.
12. **Auto-search does not overwrite newly existing features** — before writing,
   an auto-search job re-checks `song_audio_feature`; if a feature appeared after
   the job started, it skips/obsoletes itself. Manual URL jobs may overwrite only
   as an explicit replacement after cancelling active work.
13. **Terminal/manual-needed states do not auto-retry** — new automatic search is
   blocked after `manual_needed` or terminal `failed`; only explicit operator
   action can create new work.
14. **Stale running jobs use leases** — expired `running` leases are swept back
   to `pending` while attempts remain, then terminal `failed` when exhausted.
15. **ReccoBeats file analysis is globally serialized** — use a DB-backed
   provider lease/advisory lock so worker replicas still respect concurrency 1.
16. **Clip analysis follows ReccoBeats guidance with feature-aware aggregation**
   — generate 1–3 clips depending on duration, require all generated clips to
   succeed after retries, then merge bounded features with duration-weighted
   means, loudness in linear power space, and tempo with weighted median plus
   half/double normalization.
17. **No hard minimum duration** — intros/interludes are valid; create at least
   one clip with whatever audio exists, subject to ffprobe validity and file-size
   constraints.
