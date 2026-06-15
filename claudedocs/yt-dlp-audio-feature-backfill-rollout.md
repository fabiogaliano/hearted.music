# yt-dlp audio-feature backfill — rollout runbook

Operational guide for shipping the YouTube→ReccoBeats audio-feature backfill and
its control-panel review center. Implementation plan:
`claudedocs/yt-dlp-audio-feature-backfill-plan.md`.

## What ships

When a song has no `song_audio_feature` row and the ReccoBeats **catalog**
lookup misses, the audio stage no longer records a `source_not_found` failure.
Instead it enqueues a `youtube_search` backfill job and defers the song. A worker
loop downloads the best-matching YouTube audio (yt-dlp), clips it (ffmpeg),
extracts features via the ReccoBeats **file-analysis** endpoint (globally
serialized by a DB lease), aggregates the clips, and writes the feature row
**live** plus a `pending` review row. Operators review pending rows in the
control panel and approve / reject / replace.

Audio availability is a single state — `ready > backfill_active >
manual_needed / unavailable_terminal > absent` — computed by
`audio_feature_state(song_id)`. The enrichment selector, audio stage, analysis
gate, worker, and control panel all read that one definition. LLM analysis waits
only while a song is `backfill_active`; terminal states (`manual_needed`,
`unavailable_terminal`) stop waiting and let the existing lyrics-only path run.

## Migrations (apply in order)

Standard `supabase db push` against prod applies these from the files — prod has
no prior versions, so the `CREATE OR REPLACE` functions land cleanly with no
manual DROP needed.

| File | Adds |
| --- | --- |
| `20260615130000_audio_feature_backfill.sql` | `audio_feature_backfill_job`, `audio_feature_source_review`, `provider_concurrency_lease` (all RLS deny-all), `audio_feature_state()`, `get_audio_feature_availability()`, claim/enqueue/fenced-settlement RPCs, stale sweep, provider lease RPCs |
| `20260615140000_entitled_likers_of_song.sql` | `get_entitled_likers_of_song()` — drives the post-settlement enrichment wake |
| `20260615150000_audio_state_selector.sql` | rewrites `select_liked_song_ids_needing_enrichment_work` to be availability-state driven; resolves historical `source_not_found` suppression rows |

Key schema decisions baked into the files:

- `audio_feature_source_review.audio_feature_id` is `ON DELETE SET NULL`
  (nullable), **not** CASCADE: a review is provenance and must survive the
  deletion of the feature it describes (operator reject deletes the feature, then
  marks the review `rejected`).
- Settlement RPCs are `RETURNS SETOF` so a rejected write-fence returns an empty
  set (not a single all-NULL row) the caller can detect.
- `needs_audio_features` keeps the **transient** `audio_features` suppress_until
  window (only `source_not_found` suppression was replaced by state). A flaky
  catalog endpoint still gets its Retry-After backoff instead of re-hammering.

After `db push`, regenerate types:
`supabase gen types typescript --db-url "<prod-db-url>" --schema public`.

## Worker image

`Dockerfile.worker` installs `python3`/`python3-venv`/`python3-pip`, `ffmpeg`
(provides `ffprobe`), `ca-certificates`, and `yt-dlp` into `/opt/yt-dlp`
symlinked onto `PATH`. Deploy the rebuilt image and confirm in container logs /
a shell:

```
yt-dlp --version
ffmpeg -version | head -1
ffprobe -version | head -1
```

`checkYtDlpAvailable()` runs at job time; a missing binary marks the job
`manual_needed` rather than crashing the loop.

## Configuration / tuning

All thresholds live in `src/lib/integrations/youtube-audio/config.ts`
(`audioFeatureBackfillConfig`) — no migration needed to retune:

- `minScore` (0.82) / `minScoreGap` (0.08): raise if too many wrong matches get
  auto-inserted (rejection rate high); lower if too many land `manual_needed`.
- `concurrency` (1): per-process; the DB lease (`provider_concurrency_lease`,
  seeded `reccobeats_file_analysis`) caps ReccoBeats across replicas.
- `clipCount` / `clipSeconds` / `clipBitrateKbps`: clip extraction.

Tune `minScore`/`minScoreGap` after watching the first batch of real pending
rows and their accept/reject ratio.

## Control panel review center

Nav: **Audio review** (Actions group). Endpoints (local-only Bun server):

```
GET  /api/audio-feature-reviews?status=pending
POST /api/audio-feature-reviews/:id/approve
POST /api/audio-feature-reviews/:id/reject
POST /api/audio-feature-reviews/:id/replace-youtube   { url }
```

- **Approve** → `status='approved'`. Hides the row from pending.
- **Reject & delete** → one transaction: delete the exact feature row (by
  `audio_feature_id` + `song_id`), invalidate `song_analysis` / `song_embedding`
  for that song created **at/after** the review (the window the live feature
  could have polluted), mark the review `rejected`. After commit, wake
  enrichment for all entitled likers so the song re-analyzes.
- **Replace URL** → validates the YouTube host (allow-list:
  `youtube.com`, `www.youtube.com`, `music.youtube.com`, `youtu.be`), rejects +
  invalidates as above, and enqueues a `youtube_url` manual job in the same
  transaction. `enqueue_audio_feature_backfill_manual` obsoletes any active auto
  job first, so a late automatic worker can't overwrite the operator's pick.

Reject/replace use `control-panel/server/db.ts#tx` — the one deliberate
read-write path in an otherwise read-only module.

## Verification checklist

- [ ] Migrations applied; types regenerated.
- [ ] Worker image rebuilt; `yt-dlp`/`ffmpeg`/`ffprobe` present in container.
- [ ] A catalog miss creates exactly one active `youtube_search` job and **no**
      `source_not_found` failure row.
- [ ] While a job is pending/running the song is not re-offered for catalog
      lookup and not sent to LLM analysis.
- [ ] On `completed`, the feature exists and the song re-analyzes.
- [ ] `manual_needed` / terminal `failed` stop auto-retry but let analysis /
      input-missing proceed.
- [ ] First pending rows appear in **Audio review** as "pending · live".
- [ ] Approve hides the row; reject deletes the exact feature + re-queues;
      replace enqueues a manual job.

## Notes / known limitations

- **Local `supabase db reset` is currently broken** in this environment with
  `relation "supabase_migrations.seed_files" does not exist` — a Supabase CLI
  seed-tracking issue at a pre-existing migration, unrelated to this feature.
  Migrations were verified by incremental apply + the integration suite
  (`src/lib/domains/enrichment/audio-feature-backfill/__tests__/backfill-lifecycle.integration.test.ts`,
  `src/lib/workflows/enrichment-pipeline/__tests__/selector-lifecycle.integration.test.ts`).
  A from-scratch psql chain also stops earlier on platform schemas (`storage.*`)
  the CLI bootstraps outside migrations. Prod `db push` is unaffected.
- The settlement **wake** reuses `BillingChanges.songsUnlocked` rather than a new
  change kind — it marks enrichment stale and ensures a pending enrichment job
  per affected account. Enrichment is event-driven (no periodic re-scan), so the
  wake is required for re-analysis after a reject, not just a latency
  optimization.
- Reject's downstream invalidation is **time-scoped** (`created_at >= review`)
  and song-scoped; it does not inspect the analysis payload for an audio marker
  (none is reliably persisted), so it conservatively re-analyzes any analysis
  that could have consumed the live feature.
```
