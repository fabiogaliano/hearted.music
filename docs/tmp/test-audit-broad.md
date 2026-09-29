# Test audit — broad sweep (2026-09-29)

Six read-only lanes: src/lib, UI, worker, extension, control-panel+scripts, cross-cutting.
Nothing edited. Dead-code claims in Batch A re-verified by grep (only definition + tests reference each symbol).

## Batch A — tests pinning dead production code (high confidence, net-negative prod LOC)

| # | Test | Dead production code unlocked | Remaining owner / note |
|---|------|-------------------------------|------------------------|
| A1 | `src/worker/__tests__/batch-size.test.ts` (whole file) | `src/worker/batch-size.ts` (`getChunkSize`; last caller removed in 93a08477) | `enrichment-pipeline/__tests__/progress.test.ts` owns live `batchSizeForSequence` |
| A2 | `src/lib/observability/__tests__/product-events.test.ts` (whole file) | `formatProductEventPayload`, `ProductEventArgs` in `product-events.ts:79-95` (never had a caller, 027944f3) | `useAnalytics` builds payload itself; typecheck via callers |
| A3 | `enrichment-pipeline/__tests__/queue-integration.test.ts` — `getOrCreateEnrichmentJob` (L80-287) + `createEnrichmentJob` (L322-362) blocks | `library-processing-queue.ts:64-102`; `activeJobResponseQueue` helper | live `ensureEnrichmentJob` block keeps selectionMode pin (L376) |
| A4 | `song-matching/__tests__/decision-queries.test.ts:363-410` `getMatchDecisions` | `decision-queries.ts:115-129` (callers removed 3b32600c) | `getMatchDecisionsForSongs` block |
| A5 | `accounts/__tests__/preferences-queries.test.ts` (whole file) | `isOnboardingComplete` `preferences-queries.ts:108-122`; stale mock at `onboarding.free-allocation.test.ts:45` | 609c3652 fixed it and removed its only caller in the same commit |
| A6 | `extension/__tests__/playlist-write-acknowledgement.test.ts` update/delete blocks (L140-283); `spotify-client.test.ts` updatePlaylist/deletePlaylist cases + 2 `unavailableCommands` rows | `updatePlaylistAcknowledged`/`deletePlaylistAcknowledged` (`playlist-write-acknowledgement.ts:132-186`), app `updatePlaylist`/`deletePlaylist` (`spotify-client.ts:142-158`) | `createPlaylistAcknowledged` block + regression pins stay; extension-side handlers untouched |
| A7 | `extension/__tests__/spotify-reconnect.test.ts` (whole file) | `src/lib/extension/spotify-reconnect.ts` (superseded 45730a11) | `spotify-action-outcome.test.ts` AUTH_REQUIRED/TOKEN_EXPIRED |
| A8 | `extensions/src/__tests__/command-routing.test.ts:592` unknown command → UNSUPPORTED_OPERATION | unreachable branch `command-handler.ts:227-235` (dispatcher `parseSpotifyCommand` rejects first; executor map is exhaustive by type) | `dispatcher.test.ts:460` INVALID_PARAMS via real front door |

Follow-up (separate, behavior/endpoint decision): `acknowledgePlaylistUpdate`/`acknowledgePlaylistDelete` server fns become uncalled after A6.

## Batch B — duplicate / redundant tests (test-only)

- B1 `src/worker/__tests__/progress-shape.test.ts` — restates Zod schema; production only uses `.partial()`; owner `progress/__tests__/parse.test.ts`.
- B2 `match-review-queue/__tests__/readiness.test.ts` — every branch asserted at consumers (jobs.functions, scheduler ×2, playlists.management).
- B3 `features/matching/__tests__/MatchingHeader.test.tsx` L31-97 — duplicates `MatchModeToggle.test.tsx`; keep progress counter test; reword comment `MatchingHeader.tsx:34-37`.
- B4 `control-panel/server/__tests__/telemetry-db.test.ts` — superseded by date-pinned `telemetry-reports.test.ts`.
- B5 `control-panel/server/__tests__/history-api.test.ts` L101-120 — pass-through wrappers; owned by `local-store.test.ts`.
- B6 `control-panel/server/__tests__/audio-feature-reviews.test.ts:46` mapRow snake→camel (siblings already pruned in 3a357b47).
- B7 `src/lib/extension/__tests__/spotify-client.test.ts:268-281` 8× unavailable `it.each` — one private branch; keep L241.
- B8 `extensions/src/content/__tests__/app-bridge.test.ts:123` malformed messages — passes via nonce guard, not `isPageMessage`.
- B9 `match-refresh-debounce.test.ts:7-26` constant table — same values asserted via `resolveMatchRefreshAvailableAt`.
- B10 `song-matching/__tests__/retention.test.ts:213` constant literal, misleading title.
- B11 `song-matching/__tests__/strictness.test.ts:9-29` — values owned by `preferences-queries.strictness.test.ts` (keep `strictnessScore` block). Medium.

## Batch C — dead production branches kept alive by copy tests

- C1 `MatchingEmptyState.test.tsx` static-copy + building-copy tests; delete `"all-decided"`/`"no-matches"` branches + `ComponentReason` (component comment admits they're dead). Priority owned by `queue-helpers.test.ts`.

## Batch D — rewrites (keep the contract, fix the coupling)

- D1 `notify-listener.test.ts:57` — reconnect catch-up passes even if `onlisten` handler deleted; fire `onListen()` alone.
- D2 `poll-match-deck-jobs.test.ts` — dedupe capture_ahead pairs (:267/:320, :282/:336); drive `dispatchDeckJob` cases through `runClaimedDeckJob`; drop test-only export.
- D3 `playlist-profiling-integration.test.ts:518,560` — `expect(true).toBe(true)` notice + silent early returns (live-only).
- D4 Copy → role/regex: `ClaimHandleStep.test.tsx:224-297`, `CompletionScreen.test.tsx`, `ExtensionStatusRow.test.tsx`, `TelemetrySection.test.tsx` (also fix PostHog "—" false-pass), `HistorySection.test.tsx:68`.
- D5 Handle-identity replays (SettingsPage/Sidebar/DashboardHeader) — negatives assert props the components don't accept.
- D6 Identifier source-greps `song-batch-analysis.test.ts:415`, `song-analysis-stage.test.ts:678` → Biome `noRestrictedImports` or behavioral check.
- D7 `release-year-hydration.test.ts:67,75,83` — fold into flow tests; drop test-only `reader`/`concurrency` params.
- D8 Chunking files ×4 replay `chunkedRead`; move `installClient` to `src/test/mocks.ts`; keep ">100 split" pins.
- D9 `QueueCardContent.test.tsx`, `match.card-actions.test.ts` mock `react` — rewrite with real render (regression pins; do not delete).
- D10 `makeJob` duplicated in 8 files → `src/test/fixtures.ts`.

## Retained false positives (highlights)

Wire pins (gzip/413), app↔extension serialization both halves, operator-exclusion SQL greps, instrumental CAS `status = 'pending'` grep, chunking ">100" pins, `onboarding-steps` migration predicate parse, `@tanstack/react-start` mocks in server-fn tests (exemplar pattern), module-singleton `reset*ForTests`.

## Coverage gaps / product follow-ups (not fixed)

- `capture_visible_pairs` + dismiss-queue-item RPCs: only `it.todo`/`describe.skip` placeholders; no integration test.
- Deck-job settlement CAS has no `*.integration.test.ts`.
- `ensureEnrichmentJob` unique-conflict retry untested.
- `useAnalytics` `schema_version` stamping untested.
- `poll-match-deck-jobs.ts` hand-rolls the loop `poll-loop.ts` shares.
- `scripts/backfill-playlist-match-filter-vocals.ts` may be a spent one-shot.
