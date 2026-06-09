## 1. LRCLIB Provider (lyrics domain)

- [ ] 1.1 Add `src/lib/domains/enrichment/lyrics/providers/lrclib.ts`: a client
      that queries `https://lrclib.net/api/get` by the full track signature
      (`track_name`, `artist_name`, `album_name`, `duration` in seconds —
      LRCLIB matches duration ±2s), with `/api/search` fallback validated
      locally (duration ±2s + name similarity floor). Zod-validated response,
      class + factory + Result, TaggedError for failures, `User-Agent` header
      identifying the app. No API key.
- [ ] 1.2 Add LRCLIB types in
      `src/lib/domains/enrichment/lyrics/types/lrclib.types.ts`
      (`{ instrumental, plainLyrics, syncedLyrics }`), Zod-first; 404 body is
      `{ code: 404, name: "TrackNotFound" }`.
- [ ] 1.3 Define the shared `LyricsOutcome` type
      (`lyrics | instrumental | not_found`, with source
      `lrclib | genius | genius_page` + confidence) in
      `types/lyrics.types.ts`.
- [ ] 1.4 Thread `albumName` and `durationSec` through the lyrics fetch path:
      extend `BatchSong` (`content-analysis/song-batch-analysis.ts`) and the
      orchestrator's `songsToAnalyze` mapping from `song.album_name` /
      `song.duration_ms`.

## 2. Genius Instrumental-Page Detection

- [ ] 2.1 In `src/lib/domains/enrichment/lyrics/service.ts` `fetchLyrics`,
      when the lyrics container (`[data-lyrics-container="true"]`) is absent,
      check the fetched HTML for the "This song is an instrumental" marker:
      marker present → instrumental outcome (`source: "genius_page"`); marker
      absent → keep `GeniusParseError`.
- [ ] 2.2 Snapshot-test the marker detection against a captured
      instrumental-page fixture (Brock Berrigan "Crossing Paths") and a
      lyrical-page fixture (Arctic Monkeys "Mardy Bum") so a Genius copy change
      fails loudly.

## 3. Provider-Ordered LyricsService

- [ ] 3.1 In `src/lib/domains/enrichment/lyrics/service.ts`, make
      `LyricsService` try LRCLIB first, then Genius on LRCLIB not_found;
      return a `LyricsOutcome`. Preserve existing rate-limit/concurrency.
- [ ] 3.2 Apply the spurious-match override: LRCLIB `instrumental: true` wins
      over a Genius match whose confidence is below the existing floor
      (`utils/string-similarity.ts` / `utils/search-strategy.ts`); a
      high-confidence Genius match stays lyrical.
- [ ] 3.3 Update `createLyricsService` wiring and any callers consuming the old
      `string | NoLyricsError` shape to the new `LyricsOutcome`.

## 4. Persistence

- [ ] 4.1 Add a migration in `supabase/migrations/` extending `song_lyrics`
      with `fetch_status text` (`lyrics | instrumental | not_found`) and
      `source text` (`lrclib | genius | genius_page`); allow an empty document
      for non-lyrics rows. RLS stays deny-all. (Per design.md Decision 5,
      option A.)
- [ ] 4.2 In `src/lib/domains/enrichment/lyrics/queries.ts`, always upsert a
      row after a fetch attempt recording `fetch_status` + `source`; expose a
      read that distinguishes "no row" from `not_found`.
- [ ] 4.3 Run the migration locally and verify the column + a sample of each
      `fetch_status` via the supabase-local workflow.

## 5. Content-Type Classifier (analysis routing)

- [ ] 5.1 In `src/lib/domains/enrichment/content-analysis/song-analysis.ts`,
      replace `detectInstrumental` with a precedence classifier returning
      `"lyrical" | "instrumental" | "unknown"`: confirmed-instrumental fetch
      outcome (LRCLIB flag or genius_page) → lyrics-present → genre keyword
      match → instrumentalness ≥ 0.9 → unknown. Low/mid instrumentalness gets
      no vote.
- [ ] 5.2 Add the curated instrumental genre keyword set (excluding generic
      electronic tags) as a single source of truth (e.g.
      `content-analysis/instrumental-genres.ts`).
- [ ] 5.3 Route `analyzeSong`: lyrical → lyrical prompt; instrumental →
      instrumental prompt (`getInstrumentalPrompt`); unknown → no LLM call,
      mark retry candidate. Thread `fetch_status` into `AnalyzeSongInput`.

## 6. Pipeline

- [ ] 6.1 In `content-analysis/pipeline.ts`, propagate the lyrics-fetch outcome
      into analysis; ensure unknown songs are not analyzed as instrumentals and
      are recorded as retry candidates (not silently terminal).
- [ ] 6.2 Confirm `getSongsNeedingAnalysis` still re-picks songs whose
      `fetch_status` changes (e.g. an LRCLIB hit on a previously not_found
      song) on a later run.

## 7. Blocked-Failure Observability & Bounded Escalation

- [ ] 7.1 In `content-analysis/song-batch-analysis.ts` and
      `enrichment-pipeline/stages/song-analysis.ts`, carry the underlying
      lyrics-fetch error into blocked-skip `StageFailure`s: populate
      `provider`, `statusCode`, `causeTag`, and an `error_message` containing
      the error class + URL instead of the canned "provider unavailable" text.
- [ ] 7.2 In `enrichment-pipeline/failure-policy.ts`, add the
      `analysis_blocked_*` codes to the prior-unresolved-count lookup
      (`BACKOFF_CODES` plumbing / `count_unresolved_job_item_failures`) and
      escalate to terminal with `analysis_inputs_missing` semantics when the
      prior count reaches the threshold (constant, default 4) — routing
      through the existing replacement-credit compensation unchanged.
- [ ] 7.3 Unit-test the escalation ladder: below threshold stays non-terminal
      with suppression; at threshold becomes terminal; compensation fires once
      (idempotent RPC).

## 8. Selector Hardening (chunk selection)

- [ ] 8.1 Add a migration recreating
      `select_liked_song_ids_needing_enrichment_work`:
      `needs_embedding` additionally requires
      `EXISTS (SELECT 1 FROM song_analysis …)` (embedding's input dependency),
      and `needs_content_activation` gains the same
      `NOT EXISTS (… job_item_failure … suppress_until > now())` suppression
      branch every other stage has.
- [ ] 8.2 Integration-test the recreated selector against local fixtures: a
      song with blocked analysis (no `song_analysis` row + active suppression)
      is returned by **no** flag; a song with analysis but no embedding is
      returned with `needs_embedding`; an active `content_activation`
      suppression masks `needs_content_activation` until it lapses.

## 9. Blocked-Chunk Stop Outcome (worker / library-processing)

- [ ] 9.1 Extend the `enrichment_stopped` reason union with `"blocked"` in
      `library-processing/types.ts` and `changes/enrichment.ts`.
- [ ] 9.2 In `library-processing/runner.ts` (and `worker/execute.ts` as
      needed), detect a blocked chunk — zero songs attempted across all stages
      while the post-chunk `hasMoreSongs` probe still reports work — and apply
      `enrichment_stopped(reason: "blocked")` instead of
      `enrichment_completed(requestSatisfied: false)`.
- [ ] 9.3 Test: a blocked chunk leaves the workflow stale without re-ensuring a
      job in the same apply cycle (existing stopped semantics), and a normal
      partial chunk still completes-unsatisfied and re-ensures.

## 10. UI — Song Detail Panel

- [ ] 10.1 In
      `src/features/liked-songs/components/song-detail-panel/song-detail-adapter.ts`,
      parse `SongAnalysisInstrumentalSchema` in parallel with `SongReadSchema`
      and expose an `instrumentalRead` (or a discriminated read) so the panel
      can render confirmed instrumentals.
- [ ] 10.2 In `SongDetailPanelSurface.tsx`, render the instrumental read
      (headline / compound_mood / sonic_texture / mood_description),
      brand-voiced and sound-first.
- [ ] 10.3 Split `UnreadState`: a distinct, honest "lyrics unavailable" copy
      for unknown, separate from "Quiet one"; keep "Listening" only while
      genuinely analyzing. Verify the Veridis Quo / Closer rows now render an
      instrumental read instead of "Quiet one".

## 11. Retire instrumentalness from routing

- [ ] 11.1 Remove instrumentalness as a routing input everywhere except the
      ≥ 0.9 high-extreme tiebreak (task 5.1); keep it stored in
      `song_audio_feature` and the persisted analysis for matching/embeddings.

## 12. Tests & Verification

- [ ] 12.1 Provider tests for LRCLIB (instrumental: true, lyrics hit, 404,
      duration-mismatch search fallback) and the provider-order/override logic
      in LyricsService (`__tests__/` co-located).
- [ ] 12.2 Classifier tests covering the precedence with the real cases: Need
      You Now (lyrical despite 0.70), Saib (instrumental via LRCLIB flag /
      genre despite 0.01), Daft Punk (instrumental via ≥ 0.9), Crossing Paths
      (instrumental via genius_page), Remix/Hamayoun (lyrical or unknown,
      never confident-instrumental), Laurence Guy (unknown).
- [ ] 12.3 Adapter test: an instrumental-shaped analysis row yields a
      renderable instrumental read (not `read = null`).
- [ ] 12.4 Incident convergence check against the local DB: account
      `612d2e86…` / song `b836987a…` resolves to instrumental, gains an
      analysis row, stops being selected for embedding, and the worker settles
      (`enrichment_completed(requestSatisfied: true)` or no work owed) instead
      of looping.
- [ ] 12.5 `bun run test`, `bun run typecheck`, and `bunx biome check` green;
      `openspec validate add-lrclib-and-instrumental-detection --strict`
      passes.
