# Crisp metadata hard filters — locked decisions and invariants

Date: 2026-06-20
Status: Working decisions doc for parallel implementation. This document captures rules that must not diverge across branches or implementers.

## Sources

This doc is extracted from and subordinate to:

- `claudedocs/crisp-metadata-hard-filters/crisp-metadata-hard-filters-plan.md`
- `claudedocs/crisp-metadata-hard-filters/crisp-metadata-hard-filters-terminology.md`
- `claudedocs/crisp-metadata-hard-filters/language-release-year-vocal-gender-matching-research.md`
- `claudedocs/crisp-metadata-hard-filters/language-release-year-vocal-gender-matching-research-2.md.md`

If this doc and the plan diverge, update both before implementation continues.

## UI-review boundary

- Pure visual-treatment questions that do not change saved data, matching semantics, accessibility requirements, or interaction behavior are deferred to Ladle review rather than locked here.
- Examples: exact spacing, wrapping polish, visual density tuning, and final presentation details.
- The invariants in this document still control behavior, state transitions, persistence, and accessibility semantics.

## 1. Canonical names

- Internal umbrella term: **match filters**
- UI section label: **Advanced filters**
- UI short noun: **filters**
- Database column: `playlist.match_filters`
- TypeScript field: `matchFilters`
- Root saved type: `PlaylistMatchFiltersV1`
- Root default value: `{ version: 1 }`
- Saved fields: `languages`, `releaseYear`, `likedAt`, `vocalGender`
- UI labels: **Language**, **Release year**, **Liked date**, **Vocals**
- Vocals value labels: **Female**, **Male**
- Combined save RPC: `savePlaylistMatchConfig`
- Options read RPC: `getPlaylistMatchFilterOptions`
- Domain module namespace: `match-filters`
- Exclusion loader: `loadMatchFilterExclusions`
- Diagnostic filter-type values: `languages | releaseYear | likedAt | vocalGender`
- One-time backfill script: `scripts/backfill-playlist-match-filter-vocals.ts`

## 2. Product invariants

A playlist has three matching inputs:

1. `matchIntent`: soft signal
2. `genrePills`: soft signal
3. `matchFilters`: hard constraints

Hard filters are strict:

- AND across filter types
- OR within selected languages
- If a hard filter is active, missing or unknown metadata does not pass
- Hard filters may legitimately produce zero suggestions
- Matching must not auto-relax hard filters or fall back to soft matching when a hard filter excludes candidates
- Genre pills must never become hard gates

Hard filters are shared playlist configuration. Suggestions use them first; future create-playlist-from-liked-songs must reuse the same saved object and predicate semantics.

Hard filters do not rewrite or strip `matchIntent` in v1. Soft matching continues to use the saved `matchIntent` plus `genrePills` through the existing canonical intent-text path.

## 3. Data model invariants

Persist filters in `playlist.match_filters jsonb`.

No-filter value:

```json
{ "version": 1 }
```

Saved shape:

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
  languages?: { codes: string[] };
  releaseYear?: ReleaseYearFilterV1;
  likedAt?: LikedAtFilterV1;
  vocalGender?: "female" | "male";
};
```

Normalization rules:

- inactive filters are omitted
- empty arrays normalize away
- display labels are never stored
- chip/control labels are derived from normalized values
- save-time validation is strict about unknown keys; app writes with extra keys are rejected
- read-time parsing is forgiving about unknown keys; unknown stored keys are ignored while known fields are preserved
- `version` must be `1`
- `languages.codes` must be non-empty when present
- language codes must match supported format and exist in the app catalog
- years are inclusive 4-digit years `1000..9999`
- `releaseYear.range.start <= releaseYear.range.end`
- liked-date strings are UTC `YYYY-MM-DD`
- fixed liked-date range end must be on/after start
- `end.kind = "today"` is only for explicit custom through-today ranges
- year presets always persist fixed Jan 1 through Dec 31 UTC boundaries, including the current year
- `vocalGender` is only `female` or `male`

Language-specific normalization:

- language order is semantic only for display, not filtering
- `languages.codes` preserves first selection order after dedupe/normalization
- there is no explicit max number of selected languages in v1

## 4. Metadata-source invariants

Use these exact metadata sources:

- Language: `song.language`, `song.language_secondary`
- Release year: `song.release_year`
- Vocals: `song.vocal_gender`
- Liked date: active `liked_song.liked_at` row for the current account only

`liked_at` is account-song relationship data, not global song metadata.

## 5. Filter semantics invariants

### Language

- Saved as one or more catalog codes
- Catalog is checked in and comprehensive for app-supported filterable languages
- Search is not limited to languages already detected in the user library
- A song passes if either `song.language` or `song.language_secondary` matches a selected code
- Otherwise it fails
- Missing primary and non-matching secondary fail when language filter is active

### Release year

- Uses existing `song.release_year`
- UI label is **Release year**
- UI modes normalize to saved unions only; display labels are derived
- Modes: decade preset, exact year, before/through year, after/from year, custom range
- Missing `release_year` fails when the filter is active
- Semantics are inclusive

### Liked date

- Uses active `liked_song.liked_at` for the current account
- UI label is **Liked date**
- UI modes: year preset, before/through date, after/from date, custom range, explicit custom through-today range
- Timeline lower bound is oldest matching-eligible active liked-song UTC date
- Timeline upper bound is server current UTC date
- Preset years persist fixed UTC year boundaries
- Explicit custom through-today persists dynamic `end.kind = "today"`
- Predicate evaluation converts saved date-only values into half-open UTC timestamp ranges
- No active liked row fails when the filter is active

### Vocals

- `vocalGender` is exact-only once selected or detected
- `female` passes only `song.vocal_gender = 'female'`
- `male` passes only `song.vocal_gender = 'male'`
- `mixed`, `unknown`, and `null` fail female/male filters
- A manual **Vocals** control exists in Advanced filters
- Detector and backfill prefill that same control; they are not a separate storage path

## 6. Save/read contract invariants

### Save

`savePlaylistMatchConfig` replaces separate production save calls.

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

- verify playlist ownership for current account
- normalize `matchIntent` by trimming only leading/trailing whitespace; preserve internal whitespace/newlines exactly; empty becomes `null`
- sanitize `genrePills` with the existing sanitizer
- validate and normalize `matchFilters`; reject save payloads that contain unknown keys
- write all three fields together
- reject validation/write failure with no partial save
- always emit existing metadata-changed invalidation on save attempt after a successful write
- if invalidation fails after write, log degraded success and still return normalized saved values

### Reads

- playlist management reads must include `match_filters`
- playlist UI/view models must parse `match_filters` through the shared parser before rendering
- read-time parsing ignores unknown keys but preserves known fields
- if a known field is present with invalid data, the whole stored object is treated as invalid rather than salvaging valid sibling fields
- otherwise invalid stored filters normalize to `{ version: 1 }`, log an internal warning, and must not crash the screen
- read/load paths stay side-effect free; invalid stored filters are not auto-repaired on read
- a later successful save repairs invalid stored rows by writing normalized draft state

### Options read

`getPlaylistMatchFilterOptions` is a no-input account-scoped read and uses the auth session plus the same candidate eligibility semantics as `getEntitledDataEnrichedSongIds(accountId)`.

Return shape:

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

Options behavior:

- language counts use matching-eligible active liked songs
- count both primary and secondary language, but never more than once per code per song
- detected codes missing from the catalog are not selectable and must be logged internally
- release-year option bounds guide controls only; they are not validation bounds
- if a saved active release-year or liked-date filter is outside current option bounds, preserve it exactly; the control must still render and allow inspecting/editing that out-of-bounds saved value rather than clamping or hiding it
- if release-year bounds are unavailable, hide add/edit control but keep existing active chip visible
- if liked-date oldest bound is unavailable, hide add/edit control but keep existing active chip visible
- options endpoint returns compact aggregates only, not full song rows

## 7. UI and read-model invariants

### Editing model

- `matchIntent`, `genrePills`, and `matchFilters` share one draft and one Save/Cancel flow
- draft remains until save succeeds
- after a successful save, collapsed display and local saved state reconcile immediately to the normalized server response values
- edit mode closes only on successful save
- save failure keeps editor open and preserves draft
- inline save error appears near Save

### Placement

- filters live in `WritingSurface`
- place Advanced filters below Genres and above Save/Cancel
- production wiring flows through `PlaylistsCoverFlowScreen.tsx`, `SpotlightPanel.tsx`, and `WritingSurface.tsx`
- keep the existing `playlist.isTarget` gating: the whole match-config editor remains hidden for non-target playlists

### Collapsed/non-editing state

- show saved intent
- show saved genres
- show compact active filter chips under the intent/genre area
- chips are visible source-of-truth, not hidden behavior
- outside edit mode, filter chips are display-only
- to edit or remove filters, the user must first enter edit mode, matching the current genres interaction pattern

### Advanced filters subsection

- trigger label: **Advanced filters**
- trigger includes active-filter count and `aria-expanded`
- trigger is operable by click, Enter, and Space
- collapsed by default only when no filters are active
- if any saved or draft filters exist, it starts open in edit mode
- if a detector-filled vocals chip exists, it also starts open
- once opened during an edit session, whether automatically or manually, it stays open for that edit session even if the last filter is cleared

### Active chips

- active chip count means visible active chips, not filter families
- all currently active draft filters count, including an unsaved detector-filled vocals chip
- chips use compact value-only labels, not filter-name-prefixed labels
- language chips are one chip per selected language
- removing a language chip removes only that language code
- if the last language chip is removed, omit the `languages` filter
- chip removal mutates the draft immediately; Save/Cancel is the only confirmation boundary
- active chips render in fixed filter-type order matching control order: `languages` -> `releaseYear` -> `likedAt` -> `vocalGender`
- within `languages`, chips preserve selected-order display
- removing one language chip preserves the remaining languages' relative order exactly; no re-sorting occurs after removal

### Language picker

- selected languages first
- then remaining detected languages by count descending
- then remaining catalog-only languages alphabetically
- search matches code, canonical English label, and curated aliases/endonyms
- any catalog language remains selectable even if undetected in the user library

### Controls

- language uses searchable multi-select chips
- release year uses mode-aware controls for exact, before/through, after/from, range
- liked date uses mode-aware controls for before/through, after/from, range
- vocals has a manual control with `Female` / `Male`
- vocals clearing uses the remove `X` on the selected `Female` or `Male` value; there is no separate inline Clear button for that control
- use native or ARIA-compliant controls first
- keyboard behavior is required for language picker, date/year controls, chips, and collapsible area

### Loading/error behavior for options

If filter options are loading or fail to load:

- existing active chips remain visible
- in edit mode, remove actions for existing draft chips remain enabled
- adding new filters and editing existing filter values is disabled
- expanded controls are fully disabled in this state; clearing/removing existing filters happens via chip removal only
- save remains available for intent/genre changes and sends preserved filter draft minus removed filters
- intent and genres remain editable
- copy stays minimal

## 8. Matching enforcement invariants

Do not modify the account-global candidate RPC for per-playlist filters.

Enforce hard filters by building per-pair exclusions after target playlists and candidate songs are loaded and before `matchBatch(...)` runs.

Use three sets:

- `baseExclusionSet`
- `filterExclusions`
- `effectiveExclusionSet = union(baseExclusionSet, filterExclusions)`

Pass `effectiveExclusionSet` to both `matchBatch(...)` and `writeMatchSnapshot(...)` so `exclusionSetHash` changes when hard-filter exclusions change.

Per-pair rule:

- parse playlist `match_filters`
- if parsing fails, normalize that playlist to `{ version: 1 }`, log parser error details, and skip hard-filter exclusions for that playlist only
- if no active filters, do not exclude on filter grounds
- if any active filter fails, add `${songId}:${playlistId}` to the exclusion set

Failure/degraded behavior:

- if base exclusion load fails, log it, use empty base set, still apply filter exclusions
- if match-filter metadata load fails, log it, skip filter exclusions for that refresh, and continue matching
- invalid stored filters on one playlist are not a fatal refresh failure

Diagnostics shape:

```ts
type MatchFiltersExclusionSummary = {
  activeFilterPlaylistCount: number;
  candidatePairCount: number;
  excludedPairCount: number;
  failedChecksByType: Record<"languages" | "releaseYear" | "likedAt" | "vocalGender", number>;
  excludedPairsByPlaylist: Record<string, number>;
  invalidStoredFiltersByPlaylist: Record<string, number>;
  degraded: {
    baseExclusions: boolean;
    filterMetadata: boolean;
  };
};
```

These diagnostics are internal only in v1.

## 9. Vocals detector invariants

- detector scope is vocal gender only
- detector is deterministic and local
- no LLM/provider/env dependency
- broad vocal-gender phrases auto-fill the exact-only vocals control when unambiguous and no draft `vocalGender` exists
- detector must not overwrite existing draft or saved `vocalGender`
- if both male and female signals are present, do not auto-fill unless rule is unambiguous
- if user removes an auto-filled chip, that dismissal is tied to the exact current draft intent text
- while the draft intent text remains unchanged, do not re-add the chip
- as soon as the draft intent text changes, detection may run again and re-add the chip if the new text still yields an unambiguous gender, even if it is the same gender as before
- after save with no `vocalGender`, future editor opens must not re-add it from unchanged saved intent text alone
- detection runs again only after the user changes intent text

Backfill invariants:

- idempotent script
- backfill all playlists with non-empty `match_intent`, not target playlists only
- skip playlists that already have `matchFilters.vocalGender`
- preserve all other existing filters
- skip ambiguous or absent detections
- support dry-run
- log changed, skipped-existing, skipped-ambiguous, skipped-invalid, failed counts
- emit existing metadata-changed invalidation for accounts with changed target playlists

## 10. Deployment, rollout, and testing invariants

- no feature flag
- deterministic DB-driven implementation; no provider-disabled behavior needed
- recommended order: Ladle prototype -> domain types/validation -> schema/types -> server contracts -> production UI wiring -> matching enforcement -> vocals detector
- every new UI surface must be prototyped in Ladle with mock/local state before production wiring
- do not treat a UI-bearing phase as complete until Ladle stories are reviewed and approved
- run `bun run ladle:build` for UI phases
- run `bun run test` for relevant Vitest coverage

Required validation coverage includes:

- parser/validation tests for `matchFilters`
- language catalog/search/order/count behavior
- save contract ownership/normalization/all-or-nothing/invalidation behavior
- matching predicate behavior and degraded paths
- UTC liked-date boundary behavior
- exact vocals matching
- detector dismissal/no-readd behavior
- backfill preservation/skip/invalidation behavior

## 11. Clarifications resolved during decisions review

These decisions were not explicit enough in the plan and are now locked:

- Outside edit mode, filter chips are display-only; user must enter edit mode before changing/removing filters
- If any saved or draft filters exist, Advanced filters starts open in edit mode
- Active-filter count includes every visible active chip, including unsaved detector-filled vocals chips
- Language chips are one-per-selected-language
- Active-filter count counts chips, not filter families
- `languages.codes` preserves first-selected order after normalization
- Language picker order is: selected, then detected by count desc, then catalog-only alphabetically
- Language search matches code, English label, and curated aliases/endonyms
- Manual Vocals control exists and shares the same saved field as detector/backfill
- Vocals clearing uses the remove `X` on the selected `Female` or `Male` value rather than a separate inline Clear button
- `matchIntent` normalization means trim leading/trailing whitespace only; preserve internal whitespace/newlines
- Invalid stored `match_filters` are repaired only on explicit write paths such as save/backfill, not on read/load
- `match_filters` validation is strict on save but forgiving on read for unknown keys only: unknown stored keys are ignored, unknown write payload keys are rejected, but invalid known-field data invalidates the whole object
- Vocals backfill scans all playlists with non-empty intent; invalidation is only required for accounts whose target playlists changed
- Auto-filled vocals-chip dismissal is keyed to the exact current draft intent text, not to the detected gender alone
- Active filter chips use compact value-only labels rather than filter-name-prefixed labels
- Removing one selected language preserves the remaining language-chip order exactly
- Pure visual-treatment details that do not change behavior are settled in Ladle review rather than in this invariants doc
- Hard filters do not strip or rewrite `matchIntent`; the existing soft intent-text path remains unchanged in v1
- `getPlaylistMatchFilterOptions` is a no-input account-scoped read; it does not take `playlistId`
- There is no max language selection cap in v1
- Once Advanced filters is open in an edit session, it stays open for that session even if the last filter is cleared
- Active chips render in fixed type order matching control order: languages, then release year, then liked date, then vocals
- The whole match-config editor remains gated behind `playlist.isTarget`; non-target playlists do not expose the editor
- When filter options are loading or failed, expanded controls are fully disabled; removing an existing filter still works via chips only
- Saved active release-year and liked-date filters are preserved even when outside current option bounds; they remain inspectable and editable rather than being clamped or hidden
- Chip removal applies to the draft immediately; no secondary confirmation is shown inside edit mode
- After save success, collapsed display reconciles immediately to normalized server response values rather than preserving stale pre-save draft formatting/order
