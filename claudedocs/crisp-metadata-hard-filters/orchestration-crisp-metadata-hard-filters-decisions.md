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
