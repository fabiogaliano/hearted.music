# Playlist match filters implementation plan

## 1. Framing and end-state

This plan adds per-playlist hard filters to Hearted's matching configuration.

A playlist's matching setup will have:

- **Soft matching text**: mood, vibe, style, energy, context.
- **Soft genre pills**: genres remain fuzzy/adjacent, not hard gates.
- **Match filters**:
  - lyric language
  - release year range
  - liked date range
  - vocals, filled by a lightweight keyword detector into a visible removable control

Hard filters are shared configuration. They will first affect matching suggestions, and later the "create playlist from liked songs" flow can consume the same filter object.

Filter semantics are strict: if a filter is active, a song must have known metadata that satisfies it. Missing or unknown values do not pass active hard filters.

All new UI surfaces must be iterated in Ladle with mock/local state and reviewed before production wiring.

---

## 2. Current repo state and verified seams

### Existing playlist matching inputs

Playlist matching configuration currently lives on `playlist`:

- `playlist.match_intent text | null`
  - Saved by `savePlaylistMatchIntent` in `src/lib/server/playlists.functions.ts`
  - Written via `updatePlaylistMatchIntent` in `src/lib/domains/library/playlists/queries.ts`
  - Used as the playlist description/input text for profile computation.
- `playlist.genre_pills text[]`
  - Saved by `savePlaylistGenrePills`
  - Genre pills are soft steering only.

The playlist detail UI is centered around:

- `src/features/playlists/PlaylistsCoverFlowScreen.tsx`
- `src/features/playlists/components/explorations/SpotlightPanel.tsx`
- `src/features/playlists/components/explorations/WritingSurface.tsx`
- `src/features/playlists/components/GenrePillsPicker.tsx`

`WritingSurface` already has an edit/save/cancel flow for matching intent and genre pills. The match-filter UI should compose into this surface rather than creating a separate page-level flow.

### Existing metadata available for filters

Song metadata already exists for three of the planned hard filters:

- `song.language`
- `song.language_secondary`
- `song.language_confidence`
- `song.language_checked_at`
- `song.release_year`
- `song.release_year_checked_at`
- `song.vocal_gender`

The implementation must also update the existing `song.vocal_gender` database comment/documentation so it describes exact-only filter semantics. Matching filters treat `mixed` as its own non-matching value for female/male filters.

Liked-era filtering is account-specific and comes from:

- `liked_song.liked_at`
- `liked_song.unliked_at`

Because `liked_at` belongs to the account-song relationship, it must be loaded from `liked_song` for the current account. It should not be treated as global song metadata.

### Matching refresh seam

The match snapshot refresh currently:

1. Loads target playlists and computes playlist profiles in `src/lib/workflows/match-snapshot-refresh/profiles.ts`.
2. Loads candidate song ids with `getEntitledDataEnrichedSongIds(accountId)`.
3. Hydrates songs with `getByIds(songIds)`.
4. Loads the existing pair-level exclusion set with `loadExclusionSet(accountId)`.
5. Calls `matchBatch(...)` with the exclusion set in `src/lib/workflows/match-snapshot-refresh/orchestrator.ts`.

The matcher consumes exclusions before scoring in `src/lib/domains/taste/song-matching/service.ts`.

The exclusion set uses composite keys:

```ts
`${songId}:${playlistId}`
```

This is the correct seam for hard filters because filters are playlist-specific. A song can be excluded from one playlist and still remain eligible for another.

### Cache and invalidation seam

Snapshot metadata already includes an `exclusionSetHash` in `src/lib/domains/taste/song-matching/cache.ts`.

If match-filter exclusions are unioned into the same effective exclusion set before matching and snapshot writing, filter changes naturally affect snapshot hashing.

Matching intent and genre pills are not exclusions. They remain soft profile inputs and continue to affect snapshot hashes through playlist profile computation.

Playlist metadata saves already trigger match refresh invalidation through `PlaylistManagementChanges.sessionFlushed(...)`. The new combined save contract should use the same invalidation path.

### UI prototyping seam

The repo already supports Ladle:

- `bun run ladle`
- `bun run ladle:build`

Existing playlist stories include:

- `WritingSurface.stories.tsx`
- `SpotlightPanel.stories.tsx`
- `IntentEditor.stories.tsx`
- `GenreChip.stories.tsx`

Every new UI surface from this plan should first be added to Ladle with mock/local state, reviewed, and approved before production wiring.

---

## 3. Product rules and filter semantics

### Matching inputs

A playlist has three kinds of matching inputs:

1. **Matching intent text**
   - Soft signal.
   - Used for vibe, mood, style, energy, context, and other fuzzy descriptions.
2. **Genre pills**
   - Soft signal.
   - Genres remain fuzzy and adjacent.
   - Genre pills must not become hard gates.
3. **Match filters**
   - Hard constraints.
   - A song must satisfy every active filter to be eligible for that playlist.

### Active filter semantics

Filters combine as:

- **AND across filter types**: Portuguese + release year 1960-1969 + liked in 2022 means the song must satisfy all three.
- **OR within language**: Portuguese or Hungarian means either language can satisfy the language filter.

If a hard filter is active, missing metadata does not pass.

Examples:

- Release year filter active, `song.release_year = null` -> excluded.
- Language filter active, `song.language = null` and no matching `language_secondary` -> excluded.
- Vocal gender filter active, `song.vocal_gender = null` or `unknown` -> excluded.
- Liked-date filter active, no active `liked_song` row for the account -> excluded.

There is no unknown-metadata toggle in the planned UI.

### Language semantics

A language filter stores one or more language codes from the app language catalog.

Create a language catalog in the match-filters domain module. Recommended file:

`src/lib/domains/taste/match-filters/languages.ts`

The catalog is the source of truth for selectable and savable language codes. It must be a comprehensive checked-in catalog of language codes the app allows for filtering, including ISO 639-1 and supported ISO 639-3 codes used by lyric-language detection. Do not limit the catalog to languages already detected in the user's library. Each catalog entry must have:

```ts
type MatchFilterLanguageOption = {
  code: string;
  label: string;
};
```

The picker should prioritize languages already detected in the user's matching-eligible active liked songs, but search must allow any catalog language.

A song satisfies the language filter if either:

- `song.language` is one of the selected codes, or
- `song.language_secondary` is one of the selected codes.

If neither matches, the song is excluded.

### Release-year semantics

A release-year filter stores a discriminated union that preserves the user's range intent without sentinel bounds:

- exact year
- inclusive range
- inclusive upper-bound-only range
- inclusive lower-bound-only range

Supported UI modes:

- decade presets, normalized to `kind: "range"`
- exact year, normalized to `kind: "exact"`
- before/through year, normalized to `kind: "before"` with an inclusive `end`
- after/from year, normalized to `kind: "after"` with an inclusive `start`
- custom range, normalized to `kind: "range"`

Do not store display labels in `match_filters`. Chip/control labels must be derived from the normalized filter value by domain display helpers.

The release-year filter uses the existing `song.release_year` value and is labelled simply as "Release year" in the UI.

If the song has no `release_year`, it is excluded when the release-year filter is active.

### Liked-date semantics (`likedAt`)

A liked-date filter stores a discriminated union that preserves the user's date intent without sentinel bounds:

- inclusive UTC date range with a fixed end date or dynamic UTC "today" end
- inclusive UTC upper-bound-only date range
- inclusive UTC lower-bound-only date range

Supported UI modes:

- year presets from the matching-eligible liked-song timeline, normalized to `kind: "range"` with fixed January 1 through December 31 UTC dates
- before/through date, normalized to `kind: "before"` with an inclusive `endDate`
- after/from date, normalized to `kind: "after"` with an inclusive `startDate`
- custom date range, normalized to `kind: "range"`
- explicit custom "through today" range, normalized to `kind: "range"` with `end.kind = "today"`

Do not store display labels in `match_filters`. Chip/control labels must be derived from the normalized filter value by domain display helpers.

The liked-date filter uses the active `liked_song.liked_at` row for the current account.

The timeline UI starts at the user's oldest matching-eligible active liked song date in UTC and ends at the server's current UTC date. If the user explicitly chooses a custom "through today" upper bound, it remains dynamic and is evaluated as the current UTC date at match-refresh time. Named year presets always save fixed UTC calendar-year boundaries. If the user sets a fixed upper boundary, the saved UTC date is used as a hard boundary.

Date-only liked-date filters are evaluated against `liked_song.liked_at` with half-open timestamp ranges:

- `kind: "range"` start boundary: `startDate` at `00:00:00.000Z`, inclusive
- `kind: "range"` fixed end boundary: the day after `end.date` at `00:00:00.000Z`, exclusive
- `kind: "range"` dynamic today boundary: the day after the current UTC date at `00:00:00.000Z`, exclusive
- `kind: "before"` boundary: before the day after `endDate` at `00:00:00.000Z`
- `kind: "after"` boundary: on or after `startDate` at `00:00:00.000Z`

### Vocals semantics (`vocalGender`)

Vocal gender is represented as an exact-only hard filter once selected or detected.

For a `female` filter, only songs with `song.vocal_gender = 'female'` pass.

For a `male` filter, only songs with `song.vocal_gender = 'male'` pass.

`mixed`, `unknown`, and `null` do not pass a female or male filter.

Broad vocal-gender phrases in matching intent text auto-fill the exact-only vocals filter. The filled filter must be visible as a removable chip/control; it must not be hidden.

### Empty results

Hard filters are allowed to produce no suggestions.

Matching should not automatically relax filters, drop the strictest filter, or fall back to soft matching when filters are active. Existing match-page controls can still let users adjust general matching strictness, but hard filters remain hard.

---

## 4. Phased delivery overview

Build this in slices. Each UI-bearing slice must go through Ladle review before production wiring.

1. **Phase 1: Domain model + local/mock UI prototype**
   - Define `match_filters` domain types and validation.
   - Build Ladle stories for the new filter UI with local/mock state.
   - Iterate the UI until it composes well with the existing playlist writing surface.

2. **Phase 2: Schema + server contracts + option reads**
   - Add `playlist.match_filters jsonb`.
   - Add combined per-playlist save contract.
   - Add filter option/bounds read contract.

3. **Phase 3: Production editor wiring**
   - Wire approved UI into `WritingSurface` / `SpotlightPanel`.
   - Save `match_intent`, `genre_pills`, and `match_filters` together.

4. **Phase 4: Matching enforcement**
   - Load filter metadata during match refresh.
   - Build per-pair exclusions from active filters.
   - Union filter exclusions into the existing exclusion set before scoring.

5. **Phase 5: Vocals keyword detector**
   - Detect vocal-gender phrases in matching intent.
   - Fill a visible removable vocals chip/control for newly edited intent text.
   - Add a one-time backfill for existing playlist intents with unambiguous vocal-gender phrases.
   - Enforce the saved `vocalGender` filter through the same matching path.

6. **Phase 6: Future create-playlist consumer**
   - Reuse the same `match_filters` object for the later "create playlist from liked songs" feature.

---

## 5. Cross-cutting UI process: Ladle review gate

Every new UI surface from this plan must be prototyped in Ladle with mock/local state before production wiring.

This gate applies to every new UI component or composed state, not only the filter controls.

Required Ladle coverage includes:

- no filters / collapsed advanced area
- multiple active compact filter chips
- expanded advanced filters with all controls
- vocals detected chip state
- loading/error state for filter options
- dense and edge cases:
  - long playlist names
  - many selected languages
  - narrow drawer widths
  - empty or sparse option bounds, including hidden release-year and liked-date add/edit controls
  - filters composed with existing intent and genre pills

The implementation should use the existing playlist stories as the composition target:

- `WritingSurface.stories.tsx`
- `SpotlightPanel.stories.tsx`

Run `bun run ladle:build` before considering a UI phase complete.

Do not wire a new UI surface into production until its Ladle stories have been reviewed and approved.

---

## 6. Phase 1: Domain model + local/mock UI prototype

### Goals

- Establish the `match_filters` shape in TypeScript.
- Build the UI in Ladle with local/mock data before any production wiring.
- Validate that the controls compose with Hearted's existing visual system.

### Domain work

Create a domain module for match filters. Recommended location:

`src/lib/domains/taste/match-filters/`

The module should own:

- TypeScript types
- Zod schemas
- the language catalog and language label/search helpers
- normalization helpers
- display label helpers
- predicate helpers used later by matching

The domain module must make illegal states unrepresentable where practical.

### UI prototype work

Prototype components with local state and no server dependency:

- compact active filter chips
- advanced filters collapsible area
- searchable language multi-select
- mode-aware release-year controls for exact, before/through, after/from, and range
- mode-aware liked-date controls for before/through, after/from, and range
- clear/remove affordances
- visible vocals chip/control state

The advanced filters area should be composed below Genres and above Save/Cancel in `WritingSurface`.

The advanced filters trigger should be:

- collapsed by default when no filters are active
- open when filters exist or when a detector-filled chip exists
- a button row labelled "Advanced filters" with an active-filter count and `aria-expanded`
- operable by click, Enter, and Space

When the user manually opens the advanced filters area during an edit session, it should stay open for that edit session even if the last filter is cleared. Exact visual treatment should be settled in Ladle before production wiring.

Active filters should display as compact chips under the existing intent/genre area. Each chip has a remove action. Expanded controls also provide clear actions.

---

## 7. Phase 2: Schema + server contracts + option reads

### Schema migration

Add one playlist column:

```sql
ALTER TABLE playlist
  ADD COLUMN match_filters jsonb NOT NULL DEFAULT '{"version":1}'::jsonb;

ALTER TABLE playlist
  ADD CONSTRAINT playlist_match_filters_object
  CHECK (jsonb_typeof(match_filters) = 'object');
```

Use light DB constraints and strict app validation. Do not encode the full JSON schema in SQL checks.

Add a migration/comment update for `song.vocal_gender` so database documentation matches exact-only filter semantics: `female` filters pass only `female`, `male` filters pass only `male`, and `mixed` does not pass either filter.

Regenerate database types after the migration.

### Save contract

Replace the separate production save calls with a combined per-playlist server function:

`savePlaylistMatchConfig`

Input:

```ts
type SavePlaylistMatchConfigInput = {
  playlistId: string;
  matchIntent: string | null;
  genrePills: string[];
  matchFilters: PlaylistMatchFiltersV1;
};
```

Output:

```ts
type SavePlaylistMatchConfigResult = {
  matchIntent: string | null;
  genrePills: string[];
  matchFilters: PlaylistMatchFiltersV1;
};
```

Behavior:

- Verify playlist ownership with the current account.
- Trim and normalize `matchIntent`.
- Sanitize genre pills with the existing genre sanitizer.
- Validate and normalize `matchFilters` with the domain schema.
- Write all three playlist fields together.
- Always emit the same metadata-changed invalidation used by current intent/genre saves.
- If validation or playlist-field write fails, reject the save and do not partially save.
- If metadata-changed invalidation fails after the playlist row is written, log the invalidation failure as a non-fatal degraded success and still return the normalized saved values.

The existing separate save functions should be refactored away from production callers and deleted once tests are updated.

### Filter option read contract

Add a dedicated server function:

`getPlaylistMatchFilterOptions`

It should return option data for the current account based on songs that are currently eligible for matching candidates. Use the same eligibility semantics as `getEntitledDataEnrichedSongIds(accountId)` so counts and bounds match the suggestions feature.

It should return:

```ts
type PlaylistMatchFilterOptions = {
  languages: Array<{
    code: string;
    label: string;
    count: number;
    source: "detected" | "catalog";
  }>;
  releaseYears: {
    min: number | null;
    max: number | null;
    counts?: Array<{ year: number; count: number }>;
  };
  likedAt: {
    oldest: string | null;
    today: string;
    yearCounts: Array<{ year: number; count: number }>;
  };
};
```

Language picker behavior:

- Show languages detected in matching-eligible active liked songs first.
- Include counts for detected languages from matching-eligible active liked songs.
- Count both `song.language` and `song.language_secondary`; a bilingual song can increment two language option counts, but never more than once for the same code.
- Treat per-language counts as option hints only. Do not show computed combined-result counts for multi-select language drafts in this phase.
- Also allow search across every language in the app language catalog by language name or code.
- Catalog languages with no detected matching-eligible count are still selectable.
- Detected song language codes that are not present in the catalog are not selectable and should be logged internally so the catalog can be expanded.

Release-year options:

- Use the release-year span from matching-eligible active liked songs for control bounds.
- Option bounds guide the controls only; save validation uses the app year bounds, not the current option min/max.
- If `min` or `max` is `null`, the UI must not show the release-year add/edit control.
- Existing active release-year chips remain visible and removable even when bounds are unavailable.
- Return `counts` when available from the same compact aggregation. The UI must not require release-year counts to render the control.

Liked-date options:

- Use the UTC date of the user's oldest matching-eligible active liked song as the lower timeline bound.
- Use the server's current UTC date as the upper timeline bound.
- Return `oldest` and `today` as `YYYY-MM-DD` UTC date strings.
- If `oldest` is `null`, the UI must not show the liked-date add/edit control.
- Existing active liked-date chips remain visible and removable even when bounds are unavailable.
- Include year counts for year presets using UTC years.

If option loading fails:

- Existing active filter chips remain visible.
- Existing filter chip remove actions remain enabled.
- Adding new filters and editing filter values is disabled.
- Save remains available for intent/genre changes and sends the preserved filter draft, minus any filters the user removed.
- Copy should be minimal.
- Intent and genre editing should remain possible.

---

## 8. Phase 3: Production editor wiring

Wire the approved Ladle UI into the existing playlist writing flow.

### Component flow

Update the playlist summary/view model to include `matchFilters` from `playlist.match_filters`.

Thread filter draft state through:

- `PlaylistsCoverFlowScreen.tsx`
- `SpotlightPanel.tsx`
- `WritingSurface.tsx`

The editor should draft these fields together:

- matching intent text
- genre pills
- match filters

Use one Save/Cancel flow.

### Save behavior

On Save:

- call `savePlaylistMatchConfig`
- preserve the draft until the save succeeds
- close edit mode only on success
- update local saved state with normalized response values
- invalidate the playlist management query

On failure:

- keep the editor open
- preserve the draft
- show an inline error near Save

### Collapsed display

When not editing:

- show the saved matching intent
- show saved genre pills
- show compact active filter chips under the existing intent/genre area

Filter chips should be visible source-of-truth, not hidden behavior.

### Control behavior

- Language: searchable multi-select chips.
- Release year: mode-aware controls for exact year, before/through year, after/from year, and custom range, with editable year fields; hide the add/edit control when release-year bounds are unavailable.
- Liked date: mode-aware controls for before/through date, after/from date, and custom date range, with editable date fields; hide the add/edit control when liked-date bounds are unavailable.
- Advanced filters: collapsible, count-bearing, toggleable by click and keyboard, open when filters exist.

Use native or ARIA-compliant controls first; custom visuals are secondary. Keyboard navigation and exact visual treatment must be part of the Ladle review.

---

## 9. Phase 4: Matching enforcement via exclusion set

### Placement

Do not modify the account-global candidate RPC for per-playlist filters.

Add a match-filter exclusion step after candidate songs and target playlists are loaded, and before `matchBatch(...)` runs.

Recommended shape:

```ts
loadMatchFilterExclusions({
  accountId,
  playlists,
  profiles,
  candidateSongIds,
}): Promise<{
  exclusions: Set<string>;
  summary: MatchFiltersExclusionSummary;
}>
```

Keep exclusion sources distinct, then build one effective set:

- `baseExclusionSet`: existing decisions and songs already in playlists from `loadExclusionSet(accountId)`
- `filterExclusions`: hard-filter pair exclusions from `loadMatchFilterExclusions(...)`
- `effectiveExclusionSet`: union of `baseExclusionSet` and `filterExclusions`

Pass `effectiveExclusionSet` to both `matchBatch(...)` and `writeMatchSnapshot(...)`. This is required so hard-filter changes affect both scoring eligibility and `exclusionSetHash`.

The exclusion step must parse each playlist's `match_filters` through the shared domain parser. Invalid stored filters normalize to `{ version: 1 }` for that playlist only. Log a structured warning with `accountId`, `playlistId`, and parser error details, then continue matching.

### Metadata loading

Load filter metadata for candidate song ids once per refresh:

- from `song`:
  - `id`
  - `language`
  - `language_secondary`
  - `release_year`
  - `vocal_gender`
- from `liked_song` for the current account:
  - `song_id`
  - `liked_at`
  - only active rows where `unliked_at IS NULL`

`liked_at` must come from an account-scoped query because it is not global song metadata.

### Predicate behavior

For each candidate `(song, playlist)` pair:

- Parse the playlist's `match_filters` with the shared domain parser before evaluating predicates.
- If parsing fails, normalize that playlist to `{ version: 1 }`, log the parser error details, and do not add filter exclusions for that playlist.
- If the playlist has no active filters, do not add a filter exclusion.
- If any active filter is not satisfied, add `${songId}:${playlistId}` to the exclusion set.
- Missing metadata fails active filters.
- Filters combine with AND across types and OR within selected languages.

### Failure behavior

If loading the base exclusion set fails, log the failure, use an empty `baseExclusionSet`, and still apply filter exclusions.

If loading match-filter metadata fails during refresh:

- log the failure
- skip match-filter exclusions for that refresh
- continue matching with the base exclusion set

This is a degraded matching run, not a fatal refresh failure.

Invalid stored `match_filters` on one playlist is not a metadata-load failure. It only disables hard filters for that playlist for that refresh.

### Logging

Log counts initially; do not add user-facing counts in the first enforcement phase.

`MatchFiltersExclusionSummary` is for internal diagnostics/logging only. Do not show per-song exclusion reasons to users in the first enforcement phase.

Use this shape:

```ts
type MatchFilterType = "languages" | "releaseYear" | "likedAt" | "vocalGender";

type MatchFiltersExclusionSummary = {
  activeFilterPlaylistCount: number;
  candidatePairCount: number;
  excludedPairCount: number;
  failedChecksByType: Record<MatchFilterType, number>;
  excludedPairsByPlaylist: Record<string, number>;
  invalidStoredFiltersByPlaylist: Record<string, number>;
  degraded: {
    baseExclusions: boolean;
    filterMetadata: boolean;
  };
};
```

`excludedPairCount` counts each excluded `(song, playlist)` pair once. `failedChecksByType` counts every failed hard-filter check, so one excluded pair can increment more than one filter-type counter.

---

## 10. Phase 5: Vocals keyword detector

### Goal

Detect vocal-gender phrases in matching intent text and fill a visible removable vocals filter control.

The detector is deterministic and local. It does not depend on provider env vars or LLM availability.

Phase 5 also includes a one-time production backfill for existing playlist intents with unambiguous vocal-gender phrases.

### Scope

The detector covers vocal gender only.

It should recognize a broad keyword list for female and male terms, including singular/plural and common music phrasing.

Initial female keyword families:

- female
- woman
- women
- girl
- girls
- feminine
- female vocals
- female voices
- woman singer
- women singers
- girl vocals
- female-fronted
- female vocalist

Initial male keyword families:

- male
- man
- men
- boy
- boys
- masculine
- male vocals
- male voices
- man singer
- men singers
- boy vocals
- male-fronted
- male vocalist

The implementation should expand this list deliberately with tests. Avoid hidden inference from artist names, images, or external guesses.

### Editor behavior

Run the detector on draft matching-intent changes while the editor is open.

When the detector finds an unambiguous vocal-gender phrase and the draft has no `vocalGender` filter:

- fill the visible exact-only vocals filter chip/control
- do not hide the filter
- allow the user to remove it before saving
- do not overwrite an existing draft or saved `vocalGender` filter automatically

Broad phrases such as “female vocals”, “female voices”, “female-fronted”, “male vocals”, “male voices”, and “male-fronted” auto-fill the corresponding exact-only filter.

If both female and male signals are detected in the same intent, do not auto-fill a filter unless the rule is unambiguous.

If the user removes an auto-filled chip during an edit session, do not re-add it during that edit session unless a later intent edit changes the unambiguous detected gender. After the user saves with no `vocalGender` filter, future editor opens must not re-add the chip solely from unchanged saved intent text; detection may run again only after the user changes the intent text.

### One-time existing-intent backfill

Add an idempotent maintenance script for the first production release of this feature. Recommended location:

`scripts/backfill-playlist-match-filter-vocals.ts`

Backfill behavior:

- Scan playlists with non-empty `match_intent`.
- Parse existing `match_filters` with the shared domain parser.
- Skip playlists that already have `matchFilters.vocalGender`.
- Run the same deterministic detector used by the editor.
- If detection is unambiguous, write the normalized `vocalGender` filter while preserving all other existing filters.
- If detection is ambiguous or absent, leave the playlist unchanged.
- Log changed, skipped-existing, skipped-ambiguous, skipped-invalid, and failed counts.
- For accounts with changed target playlists, emit the existing metadata-changed match-refresh invalidation.

The script should support a dry-run mode that reports planned changes without writing.

---

## 11. Phase 6: Future create-playlist consumer

The same `match_filters` object should be reusable by the future "create playlist from liked songs" feature.

That feature should consume:

- soft matching text
- genre pills
- hard match filters

It should use the same domain predicates as matching enforcement so filter behavior does not diverge between suggestions and playlist creation.

This phase should not introduce a second filter schema.

---

## 12. Data/schema details

### Stored shape

Store filters in `playlist.match_filters jsonb`.

The no-filter default is:

```json
{ "version": 1 }
```

Recommended TypeScript shape:

```ts
type ReleaseYearFilterV1 =
  | { kind: "exact"; year: number }
  | { kind: "before"; end: number }
  | { kind: "after"; start: number }
  | { kind: "range"; start: number; end: number };

type LikedAtFilterV1 =
  | { kind: "before"; endDate: string }
  | { kind: "after"; startDate: string }
  | {
      kind: "range";
      startDate: string;
      end: { kind: "date"; date: string } | { kind: "today" };
    };

type PlaylistMatchFiltersV1 = {
  version: 1;
  languages?: {
    codes: string[];
  };
  releaseYear?: ReleaseYearFilterV1;
  likedAt?: LikedAtFilterV1;
  vocalGender?: "female" | "male";
};
```

Inactive filters should be omitted. Empty arrays should normalize away. Display labels should not be stored; derive labels from these normalized values.

### Validation rules

- `version` must be `1`.
- `languages.codes` must be non-empty when present.
- Language codes must match supported language code format and exist in the app language catalog.
- `releaseYear.kind` must be one of `exact`, `before`, `after`, or `range`.
- `releaseYear.exact.year`, `releaseYear.before.end`, `releaseYear.after.start`, and `releaseYear.range.start/end` are inclusive 4-digit years from `1000` through `9999`.
- `releaseYear.range.start <= releaseYear.range.end`.
- Release-year option `min`/`max` guide UI controls but are not validation bounds.
- `likedAt.kind` must be one of `before`, `after`, or `range`.
- `likedAt.before.endDate`, `likedAt.after.startDate`, and `likedAt.range.startDate` use valid calendar-date `YYYY-MM-DD` UTC date-only strings.
- `likedAt.range.end.kind = 'date'` uses a valid calendar-date `YYYY-MM-DD` UTC date-only string and must be on/after `likedAt.range.startDate`.
- `likedAt.range.end.kind = 'today'` is only used for an explicit custom "through today" range and evaluates dynamically to the current UTC date at match refresh time.
- Liked-date year presets always save fixed January 1 through December 31 UTC ranges, including the current year.
- `likedAt` predicate helpers must convert saved date-only values into half-open UTC timestamp ranges before comparing with `liked_song.liked_at`.
- `vocalGender` is only `female` or `male`.

### Naming

Use `match_filters` for the database column and `matchFilters` in TypeScript.

Use `PlaylistMatchFiltersV1` for the root saved TypeScript type.

Use `likedAt` internally and **Liked date** in UI copy.

Use `vocalGender` internally and **Vocals** in UI copy.

Use **Female** / **Male** for vocals value labels in UI copy.

Use `genrePills` for combined save/read payloads.

Use `filters` in UI copy.

---

## 13. Server/read contract details

### Combined save

`savePlaylistMatchConfig` replaces the production use of separate intent and genre save functions.

The save contract returns normalized saved values so the UI can reconcile with sanitized server state.

Validation failure rejects the save and leaves the editor open.

A metadata invalidation failure after a successful playlist write does not reject the save. The server logs the invalidation failure and returns the normalized saved values.

### Playlist reads

Playlist management reads must include `match_filters` once the database type is regenerated.

The playlist view model should parse `match_filters` through the domain parser before handing it to UI components. Invalid stored data should normalize to `{ version: 1 }` and log an internal warning with parser error details rather than crash the playlist screen.

If the editor saves after loading invalid stored filters as `{ version: 1 }`, `savePlaylistMatchConfig` writes the normalized draft and repairs the stored row.

### Filter options read

`getPlaylistMatchFilterOptions` is account-scoped.

It must only consider active liked songs that are currently eligible matching candidates unless a future feature explicitly needs a different population.

The endpoint should avoid returning full song rows. Return compact option/bounds data only.

The future create-playlist consumer should reuse the same `match_filters` schema and predicate helpers, but it may use a separate option source if its candidate population differs from matching suggestions.

---

## 14. Matching logic and edge cases

### Language

A song passes language when selected codes include `song.language` or `song.language_secondary`.

A song fails language when:

- `song.language` is null and `song.language_secondary` does not match
- neither primary nor secondary language is selected

### Release year

A song fails release year when `song.release_year` is null.

Otherwise, evaluate by filter kind:

```ts
switch (releaseYear.kind) {
  case "exact":
    return song.release_year === releaseYear.year;
  case "before":
    return song.release_year <= releaseYear.end;
  case "after":
    return song.release_year >= releaseYear.start;
  case "range":
    return releaseYear.start <= song.release_year && song.release_year <= releaseYear.end;
}
```

### Liked date (`likedAt`)

A song fails the liked-date filter when no active liked row is found.

Otherwise, evaluate the saved UTC date intent with half-open timestamp ranges:

- `kind: "before"`: pass when `liked_at < dayAfter(endDate) at 00:00:00.000Z`
- `kind: "after"`: pass when `liked_at >= startDate at 00:00:00.000Z`
- `kind: "range"` with fixed end date `E`: pass when `liked_at >= startDate at 00:00:00.000Z` and `liked_at < dayAfter(E) at 00:00:00.000Z`
- `kind: "range"` with `end.kind = "today"`: resolve `today` to the current UTC date at match-refresh time and use the day after that UTC date as the exclusive upper boundary

### Vocal gender

A song passes vocal gender only when `song.vocal_gender` exactly matches the saved filter value.

`mixed`, `unknown`, and null fail female/male filters.

### Empty candidate sets

A playlist can end up with no eligible candidates after filters. This is valid. Do not relax filters automatically.

### Degraded filter metadata load

If filter metadata cannot be loaded, skip filter exclusions and continue the refresh. Log the degraded run.

---

## 15. UI/UX states and interaction requirements

### Editor layout

Filters live inside the existing writing surface editor, below Genres and above Save/Cancel, in a collapsible advanced area.

The collapsed trigger is a button row:

- label: "Advanced filters"
- count of active filters
- `aria-expanded` reflecting the open state
- click, Enter, and Space toggle the area

The advanced area is collapsed by default when no filters are active and open when filters exist or when a detector-filled chip exists. If the user manually opens the area during an edit session, keep it open for that edit session even if the last filter is cleared.

### Collapsed saved state

When not editing, active filters appear as compact chips under the existing intent/genre area.

Each chip has a remove action. Expanded controls also include Clear actions.

### Loading state

When filter options are loading:

- show existing active chips
- keep existing filter chip remove actions enabled
- disable adding new filters and editing filter values
- keep Save available for intent/genre changes and send the preserved filter draft
- keep copy minimal
- do not block editing intent or genres

### Error state

When saving fails:

- keep editor open
- preserve the draft
- show inline error near Save

When filter options fail to load:

- existing filters remain visible
- existing filter chip remove actions remain enabled
- adding new filters and editing filter values is disabled
- Save remains available for intent/genre changes and sends the preserved filter draft, minus any filters the user removed
- intent and genres remain editable

### Accessibility

Use native or ARIA-compliant controls before custom visuals.

The language picker, release-year slider, liked-date timeline, chips, and collapsible advanced area must be usable by keyboard.

Ladle review must include keyboard behavior.

---

## 16. Integration, cache, and deployment notes

### Query invalidation

After `savePlaylistMatchConfig` succeeds, the UI should:

- update local saved state from normalized response
- invalidate playlist management query

The server function emits the existing metadata-changed processing signal as part of the save contract.

If the server logs a non-fatal metadata invalidation failure after writing the playlist row, the UI still treats the save as successful because the configuration was persisted.

### Snapshot invalidation

Filter changes affect matching in two ways:

- saved playlist metadata changes trigger match refresh invalidation
- filter exclusions join `effectiveExclusionSet`, which is passed to matching and snapshot writing, affecting `exclusionSetHash`

Matching intent and genre pills remain soft profile inputs and are not added to `effectiveExclusionSet`.

### Deployment

No feature flag is required.

For this plan, work on a feature branch and merge when complete.

Recommended implementation order:

1. UI prototypes with local/mock state in Ladle.
2. Domain types and validation.
3. Schema migration and generated DB types.
4. Server save/read contracts.
5. Production UI wiring.
6. Matching enforcement.
7. Vocals keyword detector.

No provider-disabled or env-var behavior is needed because the planned implementation is deterministic and DB-driven.

---

## 17. Testing and acceptance checks

Required checks:

- Domain/unit tests for `match_filters` parsing and validation.
- Domain/unit tests for language catalog lookup, label search, detected-first option ordering, primary/secondary language count behavior, and rejection of uncataloged language codes.
- Server function tests for `savePlaylistMatchConfig`:
  - ownership check
  - input normalization
  - all-or-nothing validation failure
  - metadata invalidation
  - non-fatal invalidation failure after successful playlist write
- Matching predicate tests:
  - language OR behavior
  - AND across filter types
  - missing metadata excludes
  - release-year inclusive boundaries
  - release-year validation bounds independent from option min/max
  - liked-date account-scoped source
  - liked-date UTC date boundary behavior
  - liked-date half-open timestamp comparison
  - liked-date fixed year preset normalization versus explicit dynamic today
  - vocals exact matching
- Vocals detector tests for broad phrase detection, ambiguous female+male text, no hidden inference, edit-session dismissal suppression, and no re-add on editor open.
- Backfill tests or dry-run verification for preserving existing filters, skipping existing `vocalGender` filters, skipping ambiguous text, and emitting metadata invalidation for changed target playlists.
- Ladle stories for all new UI states.
- `bun run ladle:build` for UI phases.
- Relevant Vitest coverage with `bun run test`.

Do not consider a UI-bearing phase complete until the corresponding Ladle stories have been reviewed and approved.

---

## 18. Deferred/future enhancements

- Use original-release-year enrichment if the current release-year source proves too noisy.
- Add richer histogram visuals to release-year or liked-date timelines.
- Add stricter or broader vocals-detector phrases based on observed false positives/negatives.
- Add the future create-playlist-from-liked-songs consumer using the same `match_filters` domain module.
