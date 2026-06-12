# Decisions & Deviations Log — add-lrclib-and-instrumental-detection

Running log of on-the-spot decisions and deviations from the plan
(proposal/design/tasks), captured by the orchestrator as each phase completes.
"Deviation" = a choice not explicitly dictated by design.md / spec / tasks.md.

## Phase 1 — Lyrics foundations (§1) + DB migrations (§4.1, §4.3, §8.1)

### §1 LRCLIB provider & types
- **User-Agent**: `hearted/1.0 (https://github.com/hearted-app/hearted)` — org slug
  guessed from the npm package name; sensible-default, no canonical value given.
- **Search-fallback similarity floor**: `0.6`, reusing `MIN_COMBINED_SCORE` from
  `search-strategy.ts` (copied value, not a shared import — that file is Genius-specific).
- **Title/artist weighting** on search candidates: `55/45`, matching existing Genius scoring.
- **Search-fallback confidence**: `0.8` (vs `1.0` for exact `/api/get` match) to signal lower certainty.
- **`LyricsOutcome`** implemented as Zod schema + inferred type (matches downstream persistence-validation use).
- **`albumName`/`durationSec` optional** on `BatchSong` (underlying `song` columns are nullable).
- **ms→s**: `Math.round(duration_ms / 1000)`.

### DB migrations
- **Provenance column named `fetch_source`, NOT `source`** (design said `source`) — a pre-existing
  `song_lyrics.source` column is part of the table UNIQUE key. `source` = unique-key provider key;
  `fetch_source` = provenance of the fetch outcome. Locked in by migration.
- `fetch_status`: NOT NULL, CHECK in (lyrics|instrumental|not_found). Backfill: 73 existing rows → `lyrics`.
- `fetch_source`: nullable, CHECK `NULL OR in (lrclib|genius|genius_page)`. Backfill → `genius`.
- `document` made nullable (non-lyrics rows). `content_hash`/`schema_version` stayed NOT NULL → non-lyrics
  rows need sentinels (handled in §4.2).
- **Selector recreate** based on `20260517072352_normalize_database_vocabulary` body; only two surgical edits:
  `needs_embedding` gains `EXISTS(song_analysis)`; `needs_content_activation` gains the
  `NOT EXISTS(job_item_failure … suppress_until > now())` branch. Stage string `content_activation`,
  failure code `content_activation_failed` confirmed from `failure-policy.ts`.
- **Migration application deviation**: `supabase migration up --local` was blocked by 3 schema_migrations
  versions with no local files (artifacts of the local Docker DB being shared across worktrees / applied
  from main repo — confirmed benign by user). Applied via `docker exec psql` + hand-stamped the 2 new
  versions into `schema_migrations`. **No `db reset`.** Migration files are correct & apply cleanly on a
  fresh DB. User decision: leave the history divergence as-is.

## Phase 2 — LyricsService rework (§2, §3) + queries persistence (§4.2)

### §2/§3 service
- **Genius instrumental marker**: exact string `"This song is an instrumental"`, exported as
  `GENIUS_INSTRUMENTAL_MARKER`. Snapshot test pins it.
- **Snapshot fixtures constructed (not real-captured)** — minimal HTML exercising container-present /
  container-absent±marker. Deterministic & network-free, but does NOT detect a future real Genius copy
  change (a frozen real fixture wouldn't either). FOLLOW-UP candidate for Phase 6: capture a real
  Brock Berrigan page for higher fidelity.
- **Decision 4 override floor**: `GENIUS_LYRIC_CONFIDENCE_FLOOR = 0.6` (mirrors `MIN_COMBINED_SCORE`).
- **`GeniusNotFoundError` → `{kind:"not_found"}` in ok channel** (deviation): a Genius search 404 is
  treated as a *confirmed* not_found rather than an error. Parse errors (no container, no marker) stay
  unconfirmed errors. Aligns with spec "definitive no-lyrics is an outcome." Within spec intent.
- **`fetchAndStoreLyrics` retained `@deprecated`** for legacy `service.test.ts` — produces 3 TS6387
  deprecation warnings (not errors). CLEANUP candidate for Phase 6 (remove if no real callers remain).
- **`searchSong` return widened** to `SearchHit = ResponseHitsResult & { score }` so the override can read confidence.
- **Temporary seam**: at both callers (`song-batch-analysis.ts`, `pipeline.ts`), `kind:"instrumental"`
  and `kind:"not_found"` both currently map to `NoLyricsAvailableError` → `skippedConfirmedInputsMissing`.
  Phase 3 (§5/§6) replaces this with real routing (instrumental→instrumental analysis; unknown→retry candidate).
- **GAP for Phase 3**: `pipeline.ts` `SongToAnalyze` lacks album/duration → LRCLIB skipped on that path.
  Only the worker batch path (`BatchSong`) is fully wired. Phase 3 must extend `SongToAnalyze`.

### §4.2 queries
- Functions added: `upsertFetchOutcome(songId, outcome, sections?)`, `getSongFetchOutcome(songId): StoredFetchOutcome | null`.
  NOTE: function exists but the **call is not yet wired** ("always upsert after a fetch attempt") — Phase 3 wires it.
- **Sentinels**: `content_hash = "no-content"` (can't collide with `ly_v1_<hex>`), `schema_version = 0`
  (real docs start at 1).
- **Unique-key `source` for non-lyrics rows**: instrumental→provider name (`lrclib`/`genius`; `genius_page`
  collapses to `genius`); not_found→sentinel `"not_found"` (one not_found row per song).
- **Read shape**: `null` = no row (never attempted) vs `StoredFetchOutcome` = attempted; latest row by
  `updated_at DESC LIMIT 1` so a re-fetch with a new provider surfaces the latest status.
- **`database.types.ts` updated manually** (codegen not re-run) to reflect the migration.

## Phase 3 — Classifier (§5) + retire instrumentalness (§11) + pipeline (§6)

- **`detectInstrumental` → `classifyContentType`** returning `"lyrical" | "instrumental" | "unknown"` with the
  5-step precedence (Decision 3). Instrumentalness < 0.9 gets no vote.
- **Curated genre keywords (final, `instrumental-genres.ts`)**: instrumental, instrumental hip-hop/hip hop,
  neoclassical, neoclassical darkwave, contemporary classical, classical, chamber music, orchestral, film score,
  soundtrack, ambient, drone, post-rock/post rock, math rock, trap instrumental, lo-fi/lo fi instrumental,
  beats, chillhop. Excluded: electronic, house, techno, deep house, dance.
  DEVIATION: added drone, chamber music, orchestral, film score, soundtrack, beats, chillhop beyond the spec's
  explicit list (intent-matching). "beats" is the broadest add — watch for false positives.
- **"Unknown" / retry candidate**: `AnalyzeSongRetryCandidate {kind:"retry_candidate"; songId}` returned as the
  Ok variant of `analyzeSong`; NO `song_analysis` row written; worker batch path carries a `retryCandidateSongIds[]`
  bucket added to the stage `skippedSet` (NOT counted as failures, NO failure rows). Unknown is "representable" via
  `song_lyrics.fetch_status` (e.g. `not_found`) + absent analysis row.
- **Single persistence call site**: inside `service.ts` `fetchAndStoreOutcome` via `upsertFetchOutcome` (one row per
  successful resolution). Transient errors SKIP persistence (no row overwrite) — preserves "never attempted" vs
  "confirmed not_found". Genius lyrics still persist their sections.
- **`SongToAnalyze` extended** with `albumName?`/`durationMs?`; `getSongsNeedingAnalysis` maps `track.album_name`/
  `track.duration_ms`. Closes the Phase 2 LRCLIB-on-pipeline gap.
- **§6.2 re-resolution**: NO code change — retry candidates have no analysis row so `getSongsNeedingAnalysis`
  re-picks them structurally. No dedicated test added (agent judged it structurally guaranteed). FOLLOW-UP: Phase 6
  may add an explicit re-resolution test.
- **DECISION #7 (watch)**: precedence step 2 keys on `input.lyrics` ≥ 50-word floor (`LYRICS_WORD_FLOOR`, was
  `INSTRUMENTAL_WORD_THRESHOLD`), NOT on `fetchOutcome.kind==="lyrics"`. Rationale: classifier stays pure on the
  input struct. RISK: requires the pipeline to actually load LRCLIB lyric text into `input.lyrics`; unit tests set it
  manually. PHASE 6 must verify end-to-end that a LRCLIB lyrics outcome → lyrical classification.
- **`stages/song-analysis.ts` touched (minimal)**: destructured `retryCandidateSongIds`, logged, added to
  `skippedSet`. NO escalation logic (that's §7). §7 must note retry candidates produce no failure rows here.
- **Scripts updated** for the union return type: `scripts/analyze-liked-songs.ts`, `scripts/seed-landing-songs.ts`.
- 38 classifier tests added (real cases: Need You Now, Saib, Daft Punk, Crossing Paths, Remix/Hamayoun, Laurence Guy).

## Phase 4 — Blocked-failure observability (§7) ‖ blocked-chunk stop (§9) ‖ UI (§10)

Ran as 3 concurrent agents on disjoint file sets. Merged state verified by orchestrator:
typecheck exit 0, 1919 tests pass, biome clean. (The §10 agent transiently saw 10 failures —
the mid-flight window of §7's concurrent edits; gone once §7 finished.)

### §7 blocked-failure observability + escalation
- Error threading: `prefetchLyrics` → `LyricsCacheEntry.error` → new `blockedSkipErrors: Map<songId, LyricsPrefetchError>`
  on `BatchAnalysisOutcome` → `blockedSkipErrorDetail()` in `stages/song-analysis.ts` → `StageFailure.{message,provider,statusCode,causeTag}`.
  Message format `GeniusParseError: <reason> — <url>`. Only `lyrics`/`both` buckets carry per-song errors;
  audio-unavailable stays canned (no per-song error available).
- Blocked codes wired into `BACKOFF_CODES`: `ANALYSIS_BLOCKED_LYRICS_UNAVAILABLE`, `ANALYSIS_BLOCKED_AUDIO_UNAVAILABLE`,
  `ANALYSIS_BLOCKED_BOTH_UNAVAILABLE`.
- Threshold: `BLOCKED_ESCALATION_THRESHOLD = 4` exported from `failure-policy.ts`.
- Terminalization: `applyFailurePolicy` returns `{isTerminal:true, escalatedToInputsMissing:true}` at ≥ threshold;
  `record-failure.ts` rewrites DB `failure_code` → `analysis_inputs_missing` (so the existing server-side compensation
  gate passes) and calls the idempotent `grantAnalysisFailureReplacementCredit` RPC after the row write.
  DEVIATION (within intent): compensation is fired from `record-failure.ts` co-located with the write rather than via the
  orchestrator's `compensateAnalysisInputsMissing` path — that path still handles directly-confirmed failures unchanged.
- No migration: `count_unresolved_job_item_failures` already accepts arbitrary codes; `job_item_failure.error_message` exists.
- 31 new tests.

### §9 blocked-chunk stop
- `"blocked"` added to `enrichment_stopped` reason union (`types.ts`) + `changes/enrichment.ts` `stopped()` helper.
  No Zod enum exists for this union (plain TS) — nothing else to update.
- Detection: `result.doneCount === 0 && result.hasMoreSongs` in `runEnrichmentJob` (runner.ts), after `markJobCompleted`,
  before the normal requestSatisfied path. `doneCount = progress.done` (succeeded+failed across stages) — existing signal, no new one.
- Reconciler: NO change needed — `enrichment_stopped` is handled uniformly (`clearActiveJob`, `isFailureChange` keys on
  `change.kind` not `reason`); `blocked` joins `error`/`local_limit` automatically.
- 6 new tests.

### §10 UI
- `read` shape: TWO separate fields (`read: SongRead|null` + `instrumentalRead: SongInstrumentalRead|null`) rather than a
  discriminated union — avoids refactoring all existing `song.read` truthy-check call sites. Mutual exclusivity holds because
  the two Zod schemas are disjoint.
- Instrumental render: new `InstrumentalReadLayer` mirroring `ReadLayer` styling (headline=display-44, `compound_mood · sonic_texture`
  as uppercase overture row, `mood_description` as body paragraph). No new visual language.
- Lyrics-unavailable copy: "No words yet" / "We don't have the words for this one yet." (replaces "Quiet one / couldn't find enough").
- Analyzing-vs-unknown: `pending|analyzing|isEnrichmentRunning` → "Listening"; `analyzed|failed` w/ no parseable output → "lyrics unavailable".
- **OPEN HANDOFF (needs decision)**: the liked-song RPC does NOT surface `content_type`/`fetch_status`, so the panel cannot
  distinguish a confirmed `unknown` (retry candidate) from a stale pre-existing row — both show "lyrics unavailable" (honest, but
  not precise), and there's a question of whether a resolved-unknown song reaches a "resolved" UI state at all or could sit on
  "Listening". Phase 6 to investigate displayState behavior for unknown songs; escalate to user if a real gap vs spec scenario
  "Analyzing versus resolved". No fake signal introduced.
- 4 adapter tests (task 12.3).

## Phase 6 — Final tests + verification (§8.2, §12.1–12.5) + investigations

Orchestrator-verified final state: typecheck exit 0; biome clean (after fixing the 2 fixture a11y
errors by adding `lang="en"`); `bun run test` 1916 passed / 0 failed (89 skipped are DB-integration
tests that auto-skip without local-DB env; 1972 pass WITH it); `openspec validate --strict` → valid.

- **§8.2**: 6 selector integration tests (no-analysis→no needs_embedding; analysis→needs_embedding;
  analysis+embedding→not flagged; incident scenario→no flag; content_activation suppress→masked; lapsed→flagged).
  Auto-skip without local-DB env.
- **§12.1 / §12.2**: verified fully covered by Phases 1–3; no gaps; no new tests needed.
- **§12.4** (incident convergence): DETERMINISTIC parts verified against the live local DB — Crossing Paths
  (`b836987a…`) has genres `{funk, beats, instrumental hip-hop}` → classifies instrumental via genius_page
  (step 1) OR genre (step 3); the selector returns it under NO flag (no song_analysis row + active analysis
  suppression + embedding input-gate). Loop is structurally closed. DEFERRED (not fakeable here): generating
  the real instrumental `song_analysis` row + the live `enrichment_completed(requestSatisfied:true)` settle
  needs the LLM + network + GENIUS_CLIENT_TOKEN — an operational re-run, not a code-completeness item.
- **Cleanup**: removed the deprecated `fetchAndStoreLyrics` + `resolveSections` (no production callers; the one
  dev-script caller `scripts/fetch-lyrics.ts` migrated to `fetchAndStoreOutcome`; its exclusive test file deleted).
  Fixed 2 biome a11y errors on the Phase-2 HTML fixtures (`lang="en"`).
- **Real Brock Berrigan fixture**: not captured (spec allows constructed HTML). Optional follow-up.

### Investigation D1 — Decision #7 end-to-end → CLEAN (not a bug)
LRCLIB `kind:"lyrics"` text IS plumbed into `input.lyrics`: `fetchAndStoreOutcome` → cache `{lyrics: outcome.text}`
→ batch loop `const lyrics = cachedEntry?.lyrics ?? song.lyrics` → `AnalyzeSongInput.lyrics` → classifier step 2
fires on the 50-word floor. Traced in `song-batch-analysis.ts:165-172,313` and `pipeline.ts:633-638`. Covered.

### Investigation D2 — displayState for unknown songs → REAL GAP (needs user decision)
A cleanly-resolved `unknown` song (retry candidate: no `song_analysis` row, no terminal failure, e.g. lyrics
resolved `not_found`) stays at `liked_song_decorated.display_state = 'pending'` forever, because the view computes
`analyzed` only when a `song_analysis` row exists. `SongDetailPanelSurface.tsx:561-564` treats `pending` as
analyzing → shows "Listening" indefinitely, NOT the new "No words yet" copy. This contradicts spec scenario
"Analyzing versus resolved" for the unknown case. (Note: an unknown song that keeps FAILING to fetch escalates to
terminal after 4 attempts via §7 → `display_state='failed'` → "No words yet" correctly; only the clean-not_found
path is stuck.) CLOSING SIGNAL: surface `song_lyrics.fetch_status` through the `liked_song_decorated` view + the
liked-song page RPC as e.g. `content_fetch_status`; the panel is already prepared (commented at
`SongDetailPanelSurface.tsx:529-535`). NOT implemented — it is an RPC/view migration beyond §10's listed tasks
(adapter+surface only). Escalated to user.

## Phase 7 — Resolved-unknown presentation (§13, D2 fix) — USER APPROVED

User chose "fix it now". Implemented as a purely additive vertical slice; orchestrator confirmed
typecheck exit 0 afterward (a stale LSP diagnostic on the already-deleted lyrics `service.test.ts`
was a false alarm — file confirmed gone, project compiles).

- **Migration** `20260612150000_liked_song_decorated_content_fetch_status.sql`: recreated
  `liked_song_decorated` adding `content_fetch_status` via `LEFT JOIN LATERAL (… song_lyrics …
  ORDER BY updated_at DESC LIMIT 1)` (same pattern as the existing `song_analysis` lateral). View
  DROP+CREATE (column-list change); all 3 RPC return shapes updated. `display_state` itself UNCHANGED —
  fix is additive, no existing consumer touched. Applied via direct psql + version-stamp (shared-DB
  divergence; no reset), matching Phase 1.
- **Threading**: RPC row `content_fetch_status` → `LikedSong.contentFetchStatus` (optional, to avoid
  breaking existing fixtures; server mapper always populates it) → `SongDetail.contentFetchStatus` →
  `UnreadState`.
- **Final predicate**: `fetchSettledWithNoRead = contentFetchStatus === "not_found" || === "instrumental"`;
  `isAnalyzing = !fetchSettledWithNoRead && (isEnrichmentRunning || displayState ∈ {analyzing,pending} ||
  contentFetchStatus === "lyrics")`. So a settled `not_found` (or `instrumental` with no parsed read)
  overrides `isEnrichmentRunning` → shows "No words yet"; genuinely pre-resolution songs still show "Listening".
- **DEVIATION (logged)**: `instrumental`-fetch-without-a-parsed-read is treated as "No words yet" (resolved-
  unavailable) rather than "Listening" — a fetch that settled instrumental but produced no analysis read has
  no read to show, so it's resolved, not in-flight.
- `database.types.ts` updated for the view's new column. 16 new tests (4 adapter + 12 surface).

## FINAL STATE (orchestrator-verified)
All tasks §1–§13 complete. typecheck exit 0; biome clean; `bun run test` green (1928 passed / 0 failed,
89 DB-integration skipped without local-DB env); `openspec validate add-lrclib-and-instrumental-detection
--strict` → valid. Two migrations from Phase 1 + one from Phase 7 applied locally via direct-psql+stamp
(shared-DB divergence; never reset); all three migration FILES apply cleanly on a fresh DB.

### Operational follow-ups (not code-blocking)
- §12.4 live settle: generating the real instrumental `song_analysis` row for the incident song + observing
  `enrichment_completed(requestSatisfied:true)` needs a live worker run (LLM + GENIUS_CLIENT_TOKEN). The
  loop-prevention invariant is verified structurally; this is an operational re-check.
- Optional: capture a REAL Brock Berrigan instrumental page as the snapshot fixture (Phase 2 used constructed HTML).
