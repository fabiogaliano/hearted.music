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
  - Reject flow should allow operator replacement by either:
    - pasting a YouTube URL, or
    - uploading/providing an `.mp3` file.
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
- ReccoBeats audio file analysis docs: `POST /v1/analysis/audio-features`, multipart `audioFile`, max 5MB, max 30s useful analysis.

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

### Automatic path

1. Normal enrichment tries ReccoBeats catalog lookup.
2. If catalog returns `not_found`, enqueue a YouTube audio feature fallback job.
3. Worker claims fallback job.
4. Worker searches YouTube with `yt-dlp`.
5. Worker scores candidates.
6. If top candidate passes confidence threshold:
   - download best audio to temp directory,
   - validate with `ffprobe`,
   - extract 3 × 30s mp3 clips with `ffmpeg`,
   - upload each clip to ReccoBeats file-analysis endpoint,
   - average returned features,
   - upsert `song_audio_feature`,
   - create pending review row linked to the exact inserted/updated audio feature.
7. If confidence is too low:
   - do not insert,
   - mark fallback job failed/manual-needed,
   - surface in control panel as needing manual source.

### Manual YouTube URL path

1. Operator provides a YouTube URL in control panel.
2. Control panel enqueues a fallback job with `source_type = 'youtube_url'`.
3. Worker downloads exactly that URL.
4. Worker analyzes and upserts features.
5. Operator chose it, so the review row is created `approved` immediately with `reviewed_by = 'control-panel'`.

### Manual MP3 path

1. Operator uploads/provides an `.mp3` file in control panel.
2. Control panel stores the file in a private Supabase Storage bucket.
3. Control panel enqueues fallback job with `source_type = 'manual_mp3'` and storage path.
4. Worker downloads the file from Storage.
5. Worker validates it with `ffprobe`.
6. Worker extracts clips, calls ReccoBeats, upserts features.
7. Worker deletes the uploaded source file after success/failure cleanup.
8. Review row is marked `approved` automatically.

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
} as const;
```

`concurrency: 1` is deliberate — ReccoBeats file analysis is rate-limited, so the
poll loop processes one job at a time. Bump it only after observing headroom.

## Database design

### 1. Fallback queue table

Prefer a dedicated table instead of overloading the existing `job` enum. This is song-level fallback work and does not need account-level lifecycle semantics.

Sketch:

```sql
create table public.audio_feature_backfill_job (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.song(id) on delete cascade,
  requested_by_account_id uuid references public.account(id) on delete set null,

  source_type text not null check (
    source_type in ('youtube_search', 'youtube_url', 'manual_mp3')
  ),
  source_url text,
  source_storage_bucket text,
  source_storage_path text,

  status text not null default 'pending' check (
    status in ('pending', 'running', 'completed', 'failed', 'cancelled')
  ),
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  not_before timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  completed_at timestamptz,
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

create unique index audio_feature_backfill_job_one_pending_per_song_source
  on public.audio_feature_backfill_job (song_id, source_type)
  where status in ('pending', 'running');
```

Consider a claim RPC similar to existing worker claim patterns:

```sql
create or replace function public.claim_pending_audio_feature_backfill_job(
  p_worker_id text,
  p_limit integer default 1
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
      started_at = coalesce(started_at, now()),
      updated_at = now()
  from claimed
  where j.id = claimed.id
  returning j.*;
end;
$$;
```

Also add settlement helpers/RPCs or query functions for:

- enqueue fallback job idempotently,
- mark completed,
- mark failed with retry/backoff,
- cancel stale/obsolete jobs.

### 2. Review/provenance table

Stores provenance for auto-inserted or manually provided features.

```sql
create table public.audio_feature_source_review (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.song(id) on delete cascade,
  audio_feature_id uuid not null references public.song_audio_feature(id) on delete cascade,
  backfill_job_id uuid references public.audio_feature_backfill_job(id) on delete set null,

  source_type text not null check (
    source_type in ('youtube_search', 'youtube_url', 'manual_mp3')
  ),

  youtube_video_id text,
  youtube_url text,
  youtube_title text,
  youtube_channel text,
  youtube_duration_seconds integer,
  youtube_thumbnail_url text,

  manual_storage_bucket text,
  manual_storage_path text,
  manual_original_filename text,

  search_query text,
  candidate_rank integer,
  match_score real,
  match_reasons jsonb not null default '[]'::jsonb,
  rejected_candidates jsonb not null default '[]'::jsonb,

  clip_starts_seconds real[] not null,
  clip_features jsonb not null,
  averaged_features jsonb not null,

  status text not null default 'pending' check (
    status in ('pending', 'approved', 'rejected')
  ),
  reviewed_at timestamptz,
  reviewed_by text,
  rejection_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint audio_feature_source_review_youtube_required check (
    source_type = 'manual_mp3'
    or youtube_url is not null
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
YouTube and manual MP3 sources alike. The control-panel UI label is still
“Audio review”.

### 3. Storage bucket for manual MP3 sources

Add a private Supabase Storage bucket, e.g.:

```text
audio-feature-manual-sources
```

Storage policy/access:

- Control panel server uploads using service role.
- Worker downloads using service role.
- Do not expose publicly.
- Delete source object after processing where possible.

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
  - hard minimum: 45s unless manual override; otherwise cannot sample 3 clips well.
  - hard maximum: e.g. 20 minutes to avoid full mixes.
- Source file size under configured max.

Clip starts:

- Use 3 clips at roughly 25%, 50%, 75% centers.
- For a 30s clip:

```ts
start = clamp(duration * fraction - 15, 0, duration - 30)
fractions = [0.25, 0.5, 0.75]
```

Clip command:

```bash
ffmpeg -v error -y \
  -ss <start> \
  -t 30 \
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

- Average 3 clip responses.
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

1. Load song row.
2. Resolve source:
   - `youtube_search`: search + score.
   - `youtube_url`: hydrate exact URL metadata.
   - `manual_mp3`: download Storage object.
3. Download/copy source audio into job temp dir.
4. Validate source.
5. Extract clips.
6. Analyze clips with ReccoBeats.
7. Upsert `song_audio_feature` and return row.
8. Insert review/provenance row.
9. Resolve existing `job_item_failure` rows for `audio_features` where applicable.
10. Mark backfill job completed.
11. Cleanup temp dir and manual storage object.

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
  | "manual_source_missing"
  | "db_write_failed";
```

## Integration with existing audio features stage

In `src/lib/workflows/enrichment-pipeline/stages/audio-features.ts`:

- Keep current ReccoBeats catalog lookup first.
- On `not_found`, enqueue `audio_feature_backfill_job` with `source_type = 'youtube_search'`.

Stage outcome — a catalog miss with backfill always-on is **deferred work, not a
failure**. The pipeline must wait for the backfill to resolve before deciding the
song's audio status:

1. Catalog miss → enqueue fallback job → audio stage reports a non-failure
   **deferred** state. Do not mark the song's audio stage failed at this point.
2. When the backfill job completes and upserts `song_audio_feature`, the audio
   stage is satisfied (feature now exists).
3. Only if the backfill job **terminally fails** (exhausts retries, or scoring
   returns low-confidence / manual-needed) does the audio stage resolve to a real
   failure.

This means the pipeline needs to model "audio pending external backfill" as a
distinct, non-error state rather than reusing `source_not_found` as a failure.

Failure/status codes:

- Replace the immediate `source_not_found` failure on catalog miss with a
  deferred status (e.g. `audio_backfill_deferred`) while a job is pending/running.
- `audio_backfill_manual_needed` — terminal: low confidence, operator must supply
  a source.
- Existing terminal failure only after the backfill job itself gives up.

Avoid hot-looping: the partial unique index on `audio_feature_backfill_job`
(`one_pending_per_song_source`) guarantees at most one in-flight job per song, and
the deferred status keeps the selector from re-requesting catalog lookup while a
job is live. Once `song_audio_feature` exists, the selector naturally stops asking.

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
POST /api/audio-feature-reviews/:id/replace-mp3
POST /api/audio-feature-manual-jobs/youtube-url
POST /api/audio-feature-manual-jobs/mp3
```

The MVP ships these (MP3 endpoints land in Phase 6):

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
  sourceType: "youtube_search" | "youtube_url" | "manual_mp3";
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

- **Replace with MP3**
  - file input accepting `.mp3`.
  - upload file to Storage via control panel server.
  - enqueue new `manual_mp3` job.

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
2. Enqueue replacement job.
3. UI shows replacement queued.


### Replace with MP3

Input validation:

- MIME type best-effort check.
- File extension `.mp3`.
- Max upload size, e.g. 25MB or 50MB.

Storage path:

```text
audio-feature-manual-sources/<reviewId-or-jobId>/<sanitized-filename>.mp3
```

Job payload:

```text
source_type = 'manual_mp3'
source_storage_bucket = 'audio-feature-manual-sources'
source_storage_path = '<path>'
```

Worker validates real file type with `ffprobe`; do not trust MIME/extension alone.

## ReccoBeats analysis details

File endpoint constraints:

- Max upload file size: 5MB.
- Max useful analysis duration: 30s.
- Supported upload formats include MP3.

For every source:

1. Extract 3 mp3 clips.
2. Upload clips sequentially or with very low concurrency.
3. Average numeric feature fields.
4. Insert/upsert:

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

Rate limiting:

- On 429, respect `Retry-After` header.
- Limit global ReccoBeats file-analysis concurrency to 1–2.
- Do not analyze many songs in parallel initially.

## Safety, policy, and security

- Do not accept arbitrary non-YouTube URLs.
- Do not use browser cookies in the worker unless explicitly needed later.
- Do not expose temporary files.
- Delete temp files in `finally`.
- Keep manual upload bucket private.
- Avoid logging full signed URLs or sensitive Storage tokens.
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
  - averages features.
  - handles 429 retry-after.
  - rejects malformed response.

- job service
  - high-confidence path upserts + review created.
  - low-confidence path does not insert.
  - manual URL path marks approved.
  - manual MP3 path validates Storage source.
  - cleanup happens on failure.

### Control panel tests

If existing control-panel tests are limited, add lightweight server/action tests where practical:

- approve endpoint updates status.
- reject endpoint deletes exact `audio_feature_id` only.
- replace YouTube validates host.
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
  - `audio_feature_backfill_job`
  - review/provenance table
  - private Storage bucket if doing MP3 in same phase
  - claim/settlement RPCs if preferred
- Add generated database types after migration if workflow requires it.

Acceptance:

- Worker image builds.
- `yt-dlp`, `ffmpeg`, `ffprobe` available inside container.
- Migration applies locally.

### Phase 2 — core worker services

- Add yt-dlp wrapper.
- Add ffprobe/ffmpeg wrapper.
- Add ReccoBeats file-analysis client.
- Add scoring.
- Add backfill job service.
- Add tests.

Acceptance:

- A mocked high-confidence YouTube candidate produces averaged features and writes review row.
- A low-confidence result does not write audio features.

### Phase 3 — worker polling loop

- Add `src/worker/poll-audio-feature-backfill.ts`.
- Wire into `src/worker/index.ts`.
- Respect `audioFeatureBackfillConfig.concurrency`.
- Add stale running-job recovery if needed.

Acceptance:

- Pending fallback jobs are claimed and processed.
- Running jobs heartbeat or do not wedge indefinitely.

### Phase 4 — enqueue from audio-features stage

- On ReccoBeats catalog `not_found`, enqueue `youtube_search` fallback and resolve
  the audio stage to the deferred (non-failure) state.
- Ensure idempotency (one in-flight job per song via the partial unique index).
- Resolve to a real failure only when the backfill job terminally fails.

Acceptance:

- Catalog miss creates exactly one pending fallback job per song and does not show
  as a failure while pending/running.
- Backfill completion makes the feature exist and satisfies the audio stage.
- Terminal backfill failure surfaces the song as needing a manual source.

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

### Phase 6 — manual MP3 upload

- Add private Storage bucket and upload endpoint.
- Add `.mp3` input in UI.
- Worker handles `manual_mp3` jobs.
- Source object cleanup.

Acceptance:

- Operator can upload MP3 and get approved audio features generated from it.

### Phase 7 — production rollout

- Deploy the rebuilt worker image.
- Verify `yt-dlp`/`ffmpeg`/`ffprobe` binaries in container logs.
- Review the first pending rows in the control panel as real misses flow through.
- Tune scoring thresholds (`minScore`, `minScoreGap`) in `config.ts` based on the
  observed rejection rate.

## Acceptance criteria for the whole feature

- ReccoBeats catalog misses can be automatically backfilled via yt-dlp when confidence is high.
- Auto features are live immediately in `song_audio_feature`.
- Every auto insertion has a review/provenance row with YouTube link and scoring reasons.
- Operators can approve/dismiss correct rows.
- Operators can reject rows, which deletes the exact inserted feature row.
- Operators can replace rejected/bad rows with a YouTube URL.
- Operators can replace with manual MP3 after upload phase.
- Worker cleans up temp files and respects provider rate limits.
- Dockerized worker runs on Ubuntu/Coolify without host-level yt-dlp/ffmpeg install.
- Tests cover scoring, parsing, averaging, DB write semantics, and review actions.

## Resolved decisions

1. **Table name:** `audio_feature_source_review` (general — covers YouTube and
   manual MP3). UI label stays “Audio review”.
2. **Manual URL replacement flow:** reject deletes the exact `song_audio_feature`
   row immediately, then enqueues the replacement job. The song has no audio
   feature until the new job completes — accepted gap.
3. **Manual YouTube URL jobs** create `approved` review rows for provenance.
4. **Control panel** shows pending only for the MVP; status filters for
   approved/rejected come later.
5. **Configuration** is a single `audioFeatureBackfillConfig` object constant — no
   env vars, no feature flag. The backfill is always on.
6. **MP3 upload** is deferred (Phase 6); URL replacement ships in the MVP.
7. **Catalog miss is deferred work, not a failure** — the audio stage only fails
   if the backfill job terminally fails.
