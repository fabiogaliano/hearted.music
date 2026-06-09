## 1. LRCLIB Provider (lyrics domain)

- [ ] 1.1 Add `src/lib/domains/enrichment/lyrics/providers/lrclib.ts`: a client
      that queries `https://lrclib.net/api/get` (and `/api/search` fallback) by
      artist + title + album + duration, returning a Zod-validated response.
      Class + factory + `Result`, `TaggedError` for failures. No API key.
- [ ] 1.2 Add LRCLIB types in
      `src/lib/domains/enrichment/lyrics/types/lrclib.types.ts`
      (`{ instrumental, plainLyrics, syncedLyrics }`), Zod-first.
- [ ] 1.3 Define the shared `LyricsOutcome` type
      (`lyrics | instrumental | not_found`, with `source` + `confidence`) in
      `types/lyrics.types.ts`.

## 2. Provider-Ordered LyricsService

- [ ] 2.1 In `src/lib/domains/enrichment/lyrics/service.ts`, make
      `LyricsService` try LRCLIB first, then Genius on LRCLIB `not_found`;
      return a `LyricsOutcome`. Preserve existing rate-limit/concurrency.
- [ ] 2.2 Apply the spurious-match override: LRCLIB `instrumental: true` wins
      over a Genius match whose confidence is below the existing floor
      (`utils/string-similarity.ts` / `utils/search-strategy.ts`); a
      high-confidence Genius match stays `lyrical`.
- [ ] 2.3 Update `createLyricsService` wiring and any callers consuming the old
      `string | NoLyricsError` shape to the new `LyricsOutcome`.

## 3. Persistence

- [ ] 3.1 Add a migration in `supabase/migrations/` extending `song_lyrics` with
      `fetch_status text` (`lyrics` | `instrumental` | `not_found`) and `source
      text`; allow an empty `document` for non-`lyrics` rows. RLS stays deny-all.
      (Per design.md Decision 4, option A.)
- [ ] 3.2 In `src/lib/domains/enrichment/lyrics/queries.ts`, always upsert a row
      after a fetch attempt recording `fetch_status` + `source`; expose a read
      that distinguishes "no row" from `not_found`.
- [ ] 3.3 Run the migration locally and verify the column + a sample of each
      `fetch_status` via the supabase-local workflow.

## 4. Content-Type Classifier (analysis routing)

- [ ] 4.1 In
      `src/lib/domains/enrichment/content-analysis/song-analysis.ts`, replace
      `detectInstrumental` with a precedence classifier returning
      `"lyrical" | "instrumental" | "unknown"`: LRCLIB instrumental →
      lyrics-present → genre keyword match → `instrumentalness >= 0.9` →
      `unknown`. Low/mid `instrumentalness` gets no vote.
- [ ] 4.2 Add the curated instrumental genre keyword set (excluding generic
      electronic tags) as a single source of truth (e.g.
      `content-analysis/instrumental-genres.ts`).
- [ ] 4.3 Route `analyzeSong`: `lyrical` → lyrical prompt; `instrumental` →
      instrumental prompt (`getInstrumentalPrompt`); `unknown` → no LLM call,
      mark retry candidate. Thread `fetch_status` into `AnalyzeSongInput`.

## 5. Pipeline

- [ ] 5.1 In `content-analysis/pipeline.ts`, propagate the lyrics-fetch outcome
      into analysis; ensure `unknown` songs are not analyzed as instrumentals and
      are recorded as retry candidates (not silently terminal).
- [ ] 5.2 Confirm `getSongsNeedingAnalysis` still re-picks songs whose
      `fetch_status` changes (e.g. an LRCLIB hit on a previously `not_found`
      song) on a later run.

## 6. UI — Song Detail Panel

- [ ] 6.1 In
      `src/features/liked-songs/components/song-detail-panel/song-detail-adapter.ts`,
      parse `SongAnalysisInstrumentalSchema` in parallel with `SongReadSchema`
      and expose an `instrumentalRead` (or a discriminated `read`) so the panel
      can render confirmed instrumentals.
- [ ] 6.2 In `SongDetailPanelSurface.tsx`, render the instrumental read
      (`headline` / `compound_mood` / `sonic_texture` / `mood_description`),
      brand-voiced and sound-first.
- [ ] 6.3 Split `UnreadState`: a distinct, honest "lyrics unavailable" copy for
      `unknown`, separate from "Quiet one"; keep "Listening" only while genuinely
      analyzing. Verify the Veridis Quo / Closer rows now render an instrumental
      read instead of "Quiet one".

## 7. Retire instrumentalness from routing

- [ ] 7.1 Remove `instrumentalness` as a routing input everywhere except the
      `>= 0.9` high-extreme tiebreak (step 4); keep it stored in
      `song_audio_feature` and the persisted analysis for matching/embeddings.

## 8. Tests & Verification

- [ ] 8.1 Provider tests for LRCLIB (`instrumental: true`, lyrics hit, `404`) and
      the provider-order/override logic in `LyricsService`
      (`__tests__/` co-located).
- [ ] 8.2 Classifier tests covering the precedence with the real cases: Need You
      Now (lyrical despite 0.70), Saib (instrumental via LRCLIB flag / genre
      despite 0.01), Daft Punk (instrumental via `>= 0.9`), Remix/Hamayoun
      (lyrical or `unknown`, never confident-instrumental), Laurence Guy
      (`unknown`).
- [ ] 8.3 Adapter test: an instrumental-shaped analysis row yields a renderable
      instrumental read (not `read = null`).
- [ ] 8.4 `bun run test`, `bun run typecheck`, and `bunx biome check` green;
      `openspec validate add-lrclib-and-instrumental-detection --strict` passes.
