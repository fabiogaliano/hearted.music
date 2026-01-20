## 1. Lyrics service foundation
- [x] 1.1 Port `old_app/lib/services/lyrics/` modules into `src/lib/services/lyrics/`.
  - [x] 1.1a Port `LyricsService.ts`.
  - [x] 1.1b Port `utils/search-strategy.ts`.
  - [x] 1.1c Port `utils/string-similarity.ts` (Levenshtein algorithm).
  - [x] 1.1d Port `utils/lyrics-parser.ts`.
  - [x] 1.1e Port `utils/lyrics-transformer.ts` (annotation linking).
  - [x] 1.1f Port `types/genius.types.ts` + `types/lyrics.types.ts`.
  - [x] 1.1g Port `lib/utils/concurrency.ts` (ConcurrencyLimiter).
- [x] 1.2 Preserve v0 scoring constants (0.6 threshold, 55/45 weights, collaborator bonus).
- [x] 1.3 Apply ConcurrencyLimiter(5, 50ms) rate limiting defaults.

## 1b. Dependencies
- [x] 1b.1 Add dependencies: `wretch`, `htmlparser2`, `domhandler`, `domutils`, `css-select`.

## 2. Analysis pipeline integration
- [x] 2.1 Add a prefetch step that resolves lyrics for songs returned by `getSongsNeedingAnalysis()`.
- [x] 2.2 Ensure `SongAnalysisService.analyzeSong()` receives lyrics or a handled `NoLyricsError`.
- [x] 2.3 Add lightweight per-batch caching to avoid duplicate fetches in a run.
- [x] 2.4 Define prefetch cache contract (store null for not-found, `hasLyrics` helper, prepared track accessor).
- [x] 2.5 Implement prefetch orchestration (port TrackPrefetchService or embed in pipeline) including parallel lyrics + audio features prefetch.

## 3. Configuration + error handling
- [x] 3.1 Add `GENIUS_CLIENT_TOKEN` to env config and document required setup.
- [x] 3.2 Port error codes: `LYRICS_NOT_FOUND`, `LYRICS_PARSE_ERROR`, `LYRICS_FETCH_ERROR`, `LYRICS_SERVICE_ERROR`.
- [x] 3.3 Add `DEBUG_LYRICS_SEARCH` env toggle for candidate logging.

## 4. Tests
- [x] 4.1 Unit tests for query normalization and result scoring.
- [x] 4.2 Unit tests for HTML parsing / lyrics extraction.
- [x] 4.3 Unit tests for annotation transformation.
- [x] 4.4 Integration test for pipeline prefetch + analysis handoff using a mocked lyrics service.
- [x] 4.5 Smoke test for end-to-end lyrics service verification.
- [x] 4.6 Snapshot testing with baseline preservation (ported from v0).

> **Test locations:**
> - Unit tests: `src/lib/services/lyrics/__tests__/`
> - Pipeline integration: `src/lib/services/analysis/__tests__/pipeline-lyrics.test.ts`
> - Smoke test: `scripts/smoke-tests/lyrics-service.ts`
> - Snapshots: `src/lib/services/lyrics/__tests__/snapshots/`
> - Generate snapshots: `bun run lyrics:snapshot`
>
> All tests pass with `bun run test`. Integration tests require `GENIUS_CLIENT_TOKEN` env var.
