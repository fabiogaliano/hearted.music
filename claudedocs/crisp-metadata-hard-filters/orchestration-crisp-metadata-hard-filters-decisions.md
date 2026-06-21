# Orchestration deviation log — crisp metadata hard filters

This log records decisions made during autonomous orchestration that were not
spelled out in the plan/decisions/stories. Each entry: what was decided + one-line
rationale.

## Run context

- Branch: `feat/crisp-metadata-hard-filters` (off `main`). Commits stay local; never pushed.
- Scope: CMHF-01..18 end-to-end (production-wired). CMHF-19 skipped (deferred; depends on
  a future create-playlist feature that does not exist yet).
- CMHF-18 backfill: built + tested, default dry-run, **not executed** against any data.
- UI: new dedicated Ladle group `Match Filters/*`. Diverge (2-3 directions) for high-variance
  controls (LanguagePicker, ReleaseYearControl, LikedDateTimeline); single best version for
  simple atoms; converge to one pick for production wiring.
- Ladle review gate (CMHF-06 blocks CMHF-13) is **overridden per user instruction**: production
  wiring proceeds on best design judgment; the component lab is left for the user to iterate.
- On blocker: log + skip the blocked story, continue the rest, sleep at end regardless (per user).
- Unrelated pre-existing working-tree changes (`control-panel/.../EmailSection.tsx`,
  `scripts/spotify-probe/`, `claudedocs/spotify-probe-output.json`, `claudedocs/archives/`) are
  left untouched; feature commits use explicit paths so these are never swept in.

## Decisions

- CMHF-01: Language catalog includes 82 entries covering all 60 ISO 639-1 codes emitted by `eld` (confirmed from `node_modules/eld/src/ngrams/large.js`) plus additional widely-filterable languages. `eld` emits only ISO 639-1 codes; no 639-3 codes found in the large model — the "occasionally 639-3" note in detector.ts is defensive wording in a comment, not an active code path.
- CMHF-01: `parseStoredMatchFilters` returns `ParseResult<PlaylistMatchFiltersV1>` always with `ok: true` (normalizing invalid to `{ version: 1 }`); `parseSaveMatchFilters` returns `ok: false` on rejection. Both use the same `ParseResult<T>` discriminated union type.
- CMHF-01: `SongFilterMetadata.likedAt` stored as `number | null` (ms since epoch) so predicate code stays pure without Date construction in callers; callers convert timestamp to ms before passing.
- CMHF-01: `orderLanguageOptions` sorts catalog-only entries alphabetically by label using `localeCompare`, matching the "alphabetically" requirement in the plan.
- CMHF-01: Labels use en-dash (–) for range separators and `≤`/`≥` for before/after, derived purely from normalized values.
- Review patch F1: introduced `StoredParseResult<T>` (= `StoredParseSuccess<T> | ParseFailure`) alongside the existing `ParseResult<T>` rather than extending `ParseSuccess` — avoids breaking the `parseSaveMatchFilters` return type while cleanly scoping `wasNormalized` to the forgiving read path only.
- CMHF-02: Migration timestamp `20260621120000` chosen (strictly after latest `20260619200000`); vocal_gender comment updated in same migration rather than a separate one since the story required both DDL and that comment update together.
- CMHF-02: `makePlaylist`/`createPlaylist` fixture builders in 4 test files updated to include `match_filters: { version: 1 }` — required because the `Row` type now mandates the field; Insert/Update remain optional (DB default covers them).
- CMHF-02: `bun run typecheck` (tsgo --noEmit) produced zero errors after fixture fixes — no pre-existing unrelated errors surfaced.
- CMHF-03: New top-level Ladle group `Match Filters/*` (not nested under `Playlists/Explorations/`) so the feature's components are first-class and individually browsable, per user request to glance/iterate.
- CMHF-03: Advanced-filters open-state implemented as a genuine toggle (opens AND closes on click) + auto-open-once when filters/detector appear + never auto-close; "stays open even if last filter cleared" is satisfied because clearing a filter never calls the toggle. (Interpretation of decisions §7; user can retune in Ladle.)
- CMHF-03: `WritingSurface` gained an optional `advancedFilters?: ReactNode` slot rendered below Genres / above Save/Cancel in editing mode only — the seam CMHF-13 builds real state onto. Fully optional/non-breaking.
- CMHF-03: `AdvancedFiltersTrigger` id/controlsId are required props (compile-time enforcement of aria-controls wiring); region uses module-level TRIGGER_ID/REGION_ID constants — CMHF-13 should switch to useId if multiple panels ever co-exist on one page.
- CMHF-03: FilterChip uses surface-dim fill + border (not GenreChip's accent fill) so active-filter chips read as informational indicators, not editor selections. Visual-only; deferred to Ladle iteration.
- CMHF-10: `loadFilterMetadata(accountId, songIds)` returns `Result<FilterMetadataMaps>` with `songMeta: Map` + `likedAtMs: Map`; uses compact inline selects (not full-row `getByIds`), Promise.all for the two queries, chunked IN (size 100). No new domain query exported (single consumer).
- CMHF-16: Detector returns `VocalsDetectionResult` discriminated union (`none|female|male|ambiguous`) so "ambiguous → don't auto-fill" is structurally enforced for CMHF-17/18. Hyphenated franchise phrases (X-Men, Spider-Man) intentionally match via word boundaries; pattern arrays must stay flag-`i`-only.
- CMHF-04: Three language-picker directions built for the user to compare/iterate — Combobox (inline always-visible list), CommandPalette (compact trigger → floating overlay), Inline (two-pane: detected quick-picks + full catalog). All share one `LanguagePickerProps` interface (swappable in the slot). CMHF-13 picks one for production.
- CMHF-04: Pickers use `div[role=listbox]`/`div[role=option]` (not `ul/li`) following the existing `GenrePillsPicker` APG combobox pattern (DOM focus stays on input via aria-activedescendant); passes biome without suppression. Selected-chip lists use semantic `ul/li`.
- CMHF-04: Chip remove "X" stays ENABLED even when the control's `disabled` prop is set (models §7 loading/error: expanded controls disabled but chip removal preserved). CommandPalette popover renders in normal document flow (not portal/absolute) for the prototype; promotion decides positioning.
- CMHF-09: parser+warn extracted into exported `parseSummaryMatchFilters(accountId, playlistId, raw)`; `accountId` threaded from the existing screen prop; warning is `console.warn` (the codebase's convention — no structured logger exists in this area). `parseStoredMatchFilters` union return kept as-is; the unreachable `ParseFailure` arm requires a narrowing guard, accepted for API uniformity (not rippled into a contract change overnight).
- CMHF-11: confirmed reuse of CMHF-01 atomic predicates (no predicate-body divergence); `candidatePairCount` = active-filter playlists × candidate songs; `excludedPairCount` = exclusion-set size (each pair once); `failedChecksByType` may increment multiple per pair.
