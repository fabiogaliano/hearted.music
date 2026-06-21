# Crisp metadata hard filters — implementation phases

Date: 2026-06-21
Status: Dependency-based implementation breakdown

## Sources read

Source-of-truth docs in this directory:

- `crisp-metadata-hard-filters-plan.md`
- `crisp-metadata-hard-filters-decisions.md`
- `crisp-metadata-hard-filters-terminology.md`

Relevant verified code seams:

- Playlist server reads/writes: `src/lib/server/playlists.functions.ts`
- Playlist queries: `src/lib/domains/library/playlists/queries.ts`
- Playlist UI and stories: `src/features/playlists/PlaylistsCoverFlowScreen.tsx`, `src/features/playlists/components/explorations/SpotlightPanel.tsx`, `src/features/playlists/components/explorations/WritingSurface.tsx`, `src/features/playlists/components/GenrePillsPicker.tsx`, related Ladle stories
- Match refresh: `src/lib/workflows/match-snapshot-refresh/profiles.ts`, `src/lib/workflows/match-snapshot-refresh/orchestrator.ts`, `src/lib/workflows/match-snapshot-refresh/write-match-snapshot.ts`
- Matching exclusions/cache: `src/lib/domains/taste/song-matching/service.ts`, `src/lib/domains/taste/song-matching/cache.ts`
- Candidate eligibility: `getEntitledDataEnrichedSongIds(accountId)` and `select_entitled_data_enriched_liked_song_ids`
- Metadata sources: song language/release-year/vocal migrations, `liked_song.liked_at`

## Dependency map

The plan has three kinds of work that should not start from separate interpretations:

1. Saved filter shape and validation.
2. UI draft/display semantics.
3. Matching predicate semantics.

Those must share one domain contract before UI, server, matching, detector, and backfill work fan out.

## Shared-contract gate before parallel work

Land this before parallel implementation begins:

- `PlaylistMatchFiltersV1`, `ReleaseYearFilterV1`, `LikedAtFilterV1`.
- Strict save parser and forgiving read parser.
- Normalization rules: omit inactive filters, dedupe language codes preserving selection order, no stored labels, fixed UTC preset ranges, dynamic `today` only for explicit custom through-today.
- Display-label helpers for chips/controls.
- Predicate helpers for language, release year, liked date, and vocals.
- Language catalog and search/count ordering helpers.
- Shared DTOs for `savePlaylistMatchConfig` and `getPlaylistMatchFilterOptions`.
- `playlist.match_filters` migration, `song.vocal_gender` comment update, regenerated DB types.

Until this lands, do not split UI/server/matching work across branches.

## Phase 1 — Shared contract + persistence foundation

### Goal

Create the durable code and database contract every later branch uses.

### Why this phase exists

Without a shared domain module and DB column, UI, server saves, option reads, matching exclusions, detector behavior, and backfill would each need to invent the filter shape. That is the highest divergence risk in this feature.

### Inputs / dependencies

- Source docs in this directory.
- Existing playlist fields: `match_intent`, `genre_pills`.
- Existing metadata columns: `song.language`, `song.language_secondary`, `song.release_year`, `song.vocal_gender`, `liked_song.liked_at`.

### Outputs

- New domain module, recommended: `src/lib/domains/taste/match-filters/`.
- Types, schemas, read/save parsers, normalizers, display helpers, predicate helpers.
- Comprehensive checked-in language catalog.
- Migration adding `playlist.match_filters jsonb NOT NULL DEFAULT '{"version":1}'::jsonb` plus object check.
- Migration/comment update for exact-only `song.vocal_gender` filter semantics.
- Regenerated `src/lib/data/database.types.ts`.
- Domain tests for parser/validation, labels, date/year normalization, language search/order, and predicates.

### Key touchpoints

- `src/lib/domains/taste/match-filters/*`
- `supabase/migrations/*`
- `src/lib/data/database.types.ts`
- `src/lib/domains/library/playlists/queries.ts` type fallout from generated `Playlist`
- Existing tests that construct `Playlist` fixtures

### Risks

- Zod version in the repo is v4; match existing import/style.
- Save-time and read-time parsing intentionally differ: save rejects unknown keys; read ignores unknown stored keys unless a known field is invalid.
- Language catalog must include ISO 639-1 and supported ISO 639-3 detector outputs, not only languages already seen in a library.
- Generated DB type changes will force fixture updates.

### Parallelizable within phase

- Language catalog construction can run alongside schema/parser work once the saved code format is locked.
- Predicate tests can run alongside display-label helper tests.
- Migration and DB type generation can run after the root saved shape is committed.

### Exit criteria

- `PlaylistMatchFiltersV1` default parses as `{ version: 1 }`.
- Invalid known stored fields normalize the whole object to `{ version: 1 }` on read.
- Unknown write payload keys fail validation.
- Domain predicates prove strict AND-across-types, OR-within-language behavior.
- Migration applies and generated types include `playlist.match_filters`.
- Relevant unit tests pass with `bun run test` target selection or full `bun run test` if practical.

## Phase 2 — Mock UI + Ladle review branch

### Goal

Design and approve the Advanced filters UI with local/mock state before production wiring.

### Why this phase exists

The plan requires every new UI surface to be reviewed in Ladle before production wiring. This phase resolves interaction and accessibility behavior without depending on server data or persistence.

### Inputs / dependencies

- Phase 1 domain types, display helpers, filter count/chip helpers, option DTO types.
- Existing visual composition in `WritingSurface` and `SpotlightPanel`.
- Existing `GenrePillsPicker` accessibility patterns.

### Outputs

- Advanced filters UI components with local/mock state.
- Compact active filter chips.
- Searchable language multi-select.
- Release-year controls for exact, before/through, after/from, custom range, and decade presets.
- Liked-date controls for before/through, after/from, custom range, year presets, and explicit through-today.
- Manual Vocals control with Female/Male and chip removal.
- Ladle stories covering required empty/loading/error/dense/narrow states.

### Key touchpoints

- `src/features/playlists/components/explorations/WritingSurface.tsx`
- `src/features/playlists/components/explorations/WritingSurface.stories.tsx`
- `src/features/playlists/components/explorations/SpotlightPanel.stories.tsx`
- New non-barrel component files under the playlist feature or a match-filters component subdirectory
- `playlist-explorations.css` or component-local class usage if needed

### Risks

- The Advanced filters trigger must be a button row with `aria-expanded` and click/Enter/Space operation.
- Active count counts visible chips, not filter families.
- Language chips are one chip per selected language and preserve selected order.
- Outside edit mode, chips are display-only.
- Loading/error options states must still allow chip removal but disable expanded controls.
- Visual details can be decided in Ladle, but behavioral details cannot drift from the decisions doc.

### Parallelizable within phase

- Language picker and chip row can be built independently from year/date controls.
- Release-year and liked-date controls can be prototyped independently after shared range component decisions.
- Story scenarios can be added while components are still local-state only.

### Exit criteria

- Stories cover all required states from the plan and decisions doc.
- Keyboard behavior is verified for chips, picker, controls, and collapsible area.
- `bun run ladle:build` succeeds.
- UI is reviewed and approved before Phase 5 production wiring begins.

## Phase 3 — Server save/read/options branch

### Goal

Expose the durable server contracts needed by production UI and later matching/backfill work.

### Why this phase exists

Production wiring needs one all-or-nothing save path and a compact account-scoped options read. Matching and UI should not call separate intent/genre saves once `matchFilters` exists.

### Inputs / dependencies

- Phase 1 DB column, generated types, domain parser/normalizer, language catalog.
- Existing playlist ownership pattern in `savePlaylistMatchIntent` and `savePlaylistGenrePills`.
- Existing metadata invalidation via `PlaylistManagementChanges.sessionFlushed(...)`.
- Existing candidate eligibility semantics from `getEntitledDataEnrichedSongIds(accountId)` / selector RPC.

### Outputs

- `savePlaylistMatchConfig` server function.
- Query helper that writes `match_intent`, `genre_pills`, and `match_filters` together.
- `getPlaylistMatchFilterOptions` server function.
- Playlist read/view-model parsing path that normalizes invalid stored filters to `{ version: 1 }` and logs structured warnings.
- Production callers prepared to stop using separate save functions.
- Server tests for ownership, normalization, validation failure, write failure, invalidation success/failure, and option aggregation.

### Key touchpoints

- `src/lib/server/playlists.functions.ts`
- `src/lib/domains/library/playlists/queries.ts`
- `src/features/playlists/queries.ts` for options query keys/options
- `src/lib/domains/library/liked-songs/queries.ts` or a dedicated option aggregation helper
- `src/lib/domains/library/songs/queries.ts` if compact metadata helpers are added
- `src/lib/workflows/library-processing/service.ts`
- `src/lib/server/__tests__/playlists.functions.test.ts`

### Risks

- Current production save calls run intent and genres separately in parallel; replacing them requires one transaction-shaped update to avoid partial saves.
- `matchIntent` normalization is trim-only for leading/trailing whitespace; internal whitespace/newlines must be preserved.
- Options must use matching-eligible active liked songs, not all songs and not all liked songs.
- Detected language codes missing from the catalog are not selectable and must be logged.
- Save invalidation failure after a successful write is a degraded success, not a failed save.

### Parallelizable within phase

- Combined save contract and options read can be developed in parallel after the domain module exists.
- Option aggregation tests can be written alongside server function tests.
- Playlist read parsing can be added independently from options aggregation.

### Exit criteria

- `savePlaylistMatchConfig` returns normalized saved values.
- Invalid filter payloads reject without partially writing playlist fields.
- Non-fatal invalidation failure is logged and still returns success.
- Options response matches the locked return shape and candidate population.
- Separate save functions are no longer needed by production callers once Phase 5 lands.
- Relevant Vitest coverage passes.

## Phase 4 — Matching enforcement branch

### Goal

Make saved hard filters affect matching suggestions by adding per-song/per-playlist exclusions before scoring and snapshot writing.

### Why this phase exists

Filters are playlist-specific hard gates. The existing exclusion set is already the correct seam because it uses `${songId}:${playlistId}` composite keys and is consumed before scoring.

### Inputs / dependencies

- Phase 1 domain parser and predicates.
- `playlist.match_filters` present on target playlist rows.
- Existing refresh flow in `orchestrator.ts`.
- Existing candidate song ids from `getEntitledDataEnrichedSongIds(accountId)`.
- Existing base exclusion loader `loadExclusionSet(accountId)`.

### Outputs

- `loadMatchFilterExclusions(...)` or equivalent refresh-stage helper.
- Compact metadata load for candidate song ids:
  - `song.id`, `song.language`, `song.language_secondary`, `song.release_year`, `song.vocal_gender`
  - account-scoped active `liked_song.song_id`, `liked_song.liked_at`
- `baseExclusionSet`, `filterExclusions`, and `effectiveExclusionSet` kept distinct.
- `effectiveExclusionSet` passed to both `matchBatch(...)` and `writeMatchSnapshot(...)`.
- Internal `MatchFiltersExclusionSummary` logging.
- Tests for predicates, metadata failure degradation, invalid stored filters, and snapshot hash participation.

### Key touchpoints

- `src/lib/workflows/match-snapshot-refresh/orchestrator.ts`
- New helper under `src/lib/workflows/match-snapshot-refresh/` or domain-adjacent module
- `src/lib/workflows/match-snapshot-refresh/write-match-snapshot.ts`
- `src/lib/domains/taste/song-matching/service.ts` only if existing exclusion behavior needs tests; avoid changing scorer semantics
- `src/lib/domains/taste/song-matching/cache.ts` should work once the effective set is passed
- Compact song/liked-song metadata queries

### Risks

- Candidate-pair loops can become large; build maps once, short-circuit active filters, and avoid repeated DB reads.
- If base exclusion load fails, matching should continue with filter exclusions.
- If filter metadata load fails, matching should continue with base exclusions only.
- Invalid stored filters disable filters only for that playlist and must not crash refresh.
- `failedChecksByType` can count multiple failures per pair; `excludedPairCount` counts each pair once.

### Parallelizable within phase

- Metadata loader can be built independently from exclusion summary logging.
- Unit predicate tests can expand while orchestrator integration is added.
- Snapshot hash tests can be added once effective-set plumbing is in place.

### Exit criteria

- Active filters exclude failing pairs before scoring.
- Missing metadata fails active filters.
- Filter changes alter `exclusionSetHash` through the effective exclusion set.
- Degraded behaviors match the decisions doc.
- Existing soft matching profile path remains unchanged for intent and genre pills.
- Relevant `bun run test` coverage passes.

## Phase 5 — Production editor integration

### Goal

Wire the approved UI and server contracts into the real playlist detail editor with one draft and one Save/Cancel boundary.

### Why this phase exists

This is the first user-facing production slice. It depends on a reviewed UI and durable server contracts so the editor does not save hidden or partial filter state.

### Inputs / dependencies

- Phase 2 Ladle-approved components and stories.
- Phase 3 `savePlaylistMatchConfig` and `getPlaylistMatchFilterOptions`.
- Phase 1 parser/display helpers.
- Existing `playlist.isTarget` gating.

### Outputs

- `PlaylistSummary` includes parsed `matchFilters`.
- `PlaylistsCoverFlowScreen` maps `playlist.match_filters` into `matchFilters`.
- `SpotlightPanel` owns saved/draft `matchFilters` with intent and genres.
- `WritingSurface` renders Advanced filters below Genres and above Save/Cancel.
- Save calls `savePlaylistMatchConfig`; edit mode closes only on success.
- Inline save error near Save.
- Option loading/error states preserve chips and disable expanded controls.
- Collapsed non-editing display shows saved active filter chips.

### Key touchpoints

- `src/features/playlists/PlaylistsCoverFlowScreen.tsx`
- `src/features/playlists/components/explorations/SpotlightPanel.tsx`
- `src/features/playlists/components/explorations/WritingSurface.tsx`
- `src/features/playlists/components/explorations/types.ts`
- `src/features/playlists/queries.ts`
- Ladle stories updated to use production-shaped props with mock server-like options

### Risks

- Current `SpotlightPanel.save` optimistically closes edit mode before persistence; this must change.
- Current `onSave` returns `void`; production integration likely needs an async result carrying normalized values or an error path.
- Query invalidation must still hit playlist management after successful save.
- Invalid stored filters should render as no filters and repair only on explicit save.
- Non-target playlists must not expose the match-config editor.

### Parallelizable within phase

- View-model threading can happen alongside option-query hook wiring.
- Save/error state can be implemented independently from collapsed chip rendering once props are defined.
- Story updates can run alongside production wiring to keep reviewed states current.

### Exit criteria

- Editing drafts `matchIntent`, `genrePills`, and `matchFilters` together.
- Cancel restores all three fields.
- Save preserves draft and editor state on failure.
- Save success reconciles local state to normalized server response and closes editor.
- Active filters are visible outside edit mode.
- `bun run ladle:build` and relevant UI/server tests pass.

## Phase 6 — Vocals detector + backfill integration

### Goal

Auto-fill the visible exact-only Vocals filter from unambiguous intent text and backfill existing playlist intents once.

### Why this phase exists

The detector depends on the saved `vocalGender` field and the manual visible Vocals control. It should not introduce a separate hidden path or a second schema.

### Inputs / dependencies

- Phase 1 `vocalGender` schema and predicate.
- Phase 2/5 manual Vocals control and chip removal behavior.
- Phase 3 save path and invalidation behavior.
- Phase 4 matching enforcement for saved `vocalGender`.

### Outputs

- Deterministic local vocal-gender phrase detector.
- Editor integration that auto-fills only when unambiguous and no draft `vocalGender` exists.
- Dismissal tracking keyed to the exact current draft intent text.
- No re-add on future editor opens from unchanged saved intent text alone.
- Idempotent `scripts/backfill-playlist-match-filter-vocals.ts` with dry-run.
- Tests for detector phrases, ambiguity, dismissal, backfill preservation/skips, and invalidation.

### Key touchpoints

- `src/lib/domains/taste/match-filters/*` detector module or sibling
- `src/features/playlists/components/explorations/SpotlightPanel.tsx`
- `src/features/playlists/components/explorations/WritingSurface.tsx`
- `scripts/backfill-playlist-match-filter-vocals.ts`
- Playlist query helpers for scanning/updating backfill rows
- Library-processing invalidation helper

### Risks

- Broad words like `girl` / `boy` can false-positive; phrase tests must be deliberate.
- Mixed male+female signals should not auto-fill unless a specific rule is proven unambiguous.
- Detector must not overwrite manual or existing saved `vocalGender`.
- Backfill scans all playlists with non-empty `match_intent`, but invalidation is needed only for accounts whose target playlists changed.
- Dry-run must not write or invalidate.

### Parallelizable within phase

- Detector core and tests can start after Phase 1, before production UI integration.
- Backfill script structure can start after Phase 3, but final behavior depends on the detector core.
- Editor integration should wait until Phase 5 production draft state exists.

### Exit criteria

- Detector behavior matches locked decisions.
- Auto-filled chip is visible and removable.
- Dismissal/no-readd rules are covered by tests.
- Backfill dry-run reports planned changes without writes.
- Backfill write mode preserves existing filters and emits required invalidations.
- Relevant `bun run test` coverage passes.

## Phase 7 — Deferred create-playlist consumer

### Goal

Reuse the same `matchFilters` object and predicates for a future create-playlist-from-liked-songs flow.

### Why this phase exists

The plan explicitly reserves this future consumer, but it should not block suggestion filtering.

### Inputs / dependencies

- Completed shared domain schema and predicates.
- Matching enforcement proves the predicate semantics.
- Future create-playlist candidate population decision.

### Outputs

- Future create-playlist flow consumes soft text, genre pills, and hard filters.
- No second filter schema.
- Option source may differ only if the candidate population differs.

### Key touchpoints

- Future create-playlist feature modules.
- `src/lib/domains/taste/match-filters/` predicates and display helpers.

### Risks

- Reusing UI but changing candidate population may require a distinct options read while preserving saved semantics.
- Do not let create-playlist constraints drift from suggestion constraints.

### Parallelizable within phase

- Not applicable until that feature is scheduled.

### Exit criteria

- Future feature uses `PlaylistMatchFiltersV1` or its versioned successor.
- Predicate behavior remains shared with suggestions.

## Critical serial path

For the full shipped feature, the critical path is:

1. Phase 1 shared contract + persistence foundation.
2. Phase 2 mock UI and Ladle approval.
3. Phase 3 server save/read/options contracts.
4. Phase 5 production editor integration.
5. Final end-to-end acceptance with Phase 4 matching enforcement merged.
6. Phase 6 detector/backfill if vocals auto-fill is part of the release cut.

Phase 2 and Phase 3 can run in parallel after Phase 1. Phase 4 can also run in parallel after Phase 1 because it can seed stored filters in tests without production UI. The detector core from Phase 6 can begin after Phase 1, but editor integration and backfill writes should wait for the UI/save path.

## Parallelizable branches after Phase 1

```text
Phase 1 Shared contract + persistence
├─ Phase 2 Mock UI + Ladle review ─┐
├─ Phase 3 Server save/read/options ├─ Phase 5 Production editor integration
├─ Phase 4 Matching enforcement ────┘
└─ Phase 6 detector core ───────────── Phase 6 editor/backfill integration
```

Merge guidance:

- Phase 5 must not start until Phase 2 is reviewed and Phase 3 server contracts exist.
- Phase 4 can merge before Phase 5; it will be inert for users until filters can be saved, but tests can seed rows directly.
- Phase 6 detector core can merge before Phase 5 if it has no UI side effects.
- Phase 6 backfill should run only after schema, parser, detector, save/update helpers, and invalidation behavior are stable.
