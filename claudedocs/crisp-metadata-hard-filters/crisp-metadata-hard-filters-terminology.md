# Crisp metadata match filters terminology

Date: 2026-06-20
Status: Canonical naming decisions for the playlist match-filters feature

## Scope

These names are canonical across schema, JSON shape, RPCs, TypeScript types, modules, scripts, diagnostics, and user-facing copy.

## Core rules

- Internal umbrella term: **match filters**
- DB / SQL: **snake_case**
- TypeScript / JSON / RPC payloads: **camelCase**
- Domain modules: **kebab-case**
- UI section label: **Advanced filters**
- UI short noun elsewhere: **filters**
- Stored JSON is explicitly versioned, so persisted/root types keep the **`V1`** suffix
- No new env flag is introduced for this feature

## Canonical names by domain

### Product language

| Domain | Canonical label |
|---|---|
| Section label | **Advanced filters** |
| Short noun | **filters** |
| Language filter | **Language** |
| Release-year filter | **Release year** |
| Liked-date filter | **Liked date** |
| Vocal-gender filter | **Vocals** |
| Vocal value labels | **Female** / **Male** |

### Schema and saved JSON

| Domain | Canonical name |
|---|---|
| Playlist column | `match_filters` |
| TS root field | `matchFilters` |
| Root saved type | `PlaylistMatchFiltersV1` |
| Root default value | `{ version: 1 }` |
| Language field | `languages` |
| Language code array | `languages.codes` |
| Release-year field | `releaseYear` |
| Liked-date field | `likedAt` |
| Vocals field | `vocalGender` |
| Vocals stored shape | `vocalGender: "female" | "male"` |
| Range discriminants | `exact` / `before` / `after` / `range` |
| Dynamic liked-date end | `end: { kind: "date"; date: string } | { kind: "today" }` |

### RPCs and payloads

| Domain | Canonical name |
|---|---|
| Combined save RPC | `savePlaylistMatchConfig` |
| Combined save input field | `playlistId` |
| Combined save input field | `matchIntent` |
| Combined save input field | `genrePills` |
| Combined save input field | `matchFilters` |
| Combined save/read root type | `PlaylistMatchFiltersV1` |
| Options read RPC | `getPlaylistMatchFilterOptions` |
| Options payload type | `PlaylistMatchFilterOptions` |
| Options section | `languages` |
| Options section | `releaseYears` |
| Options section | `likedAt` |
| Liked-date bounds | `likedAt.oldest` / `likedAt.today` |
| Language option source | `"detected" | "catalog"` |

### TypeScript and modules

| Domain | Canonical name |
|---|---|
| Domain module namespace | `match-filters` |
| Release-year union type | `ReleaseYearFilterV1` |
| Liked-date union type | `LikedAtFilterV1` |
| Exclusion loader | `loadMatchFilterExclusions` |
| Exclusion summary type | `MatchFiltersExclusionSummary` |
| Diagnostic filter-type values | `"languages" | "releaseYear" | "likedAt" | "vocalGender"` |

### Scripts and operational naming

| Domain | Canonical name |
|---|---|
| One-time backfill script | `scripts/backfill-playlist-match-filter-vocals.ts` |
| Env flag policy | No new env flag |
| Offer IDs | No new offer IDs introduced by this plan |

## Notes

### `likedAt` vs “Liked date”

Use `likedAt` internally because it matches `liked_song.liked_at`. Use **Liked date** in product copy.

### `vocalGender` vs “Vocals”

Use `vocalGender` internally because it matches `song.vocal_gender`. Use **Vocals** in product copy, with values **Female** and **Male**.

### `languages` vs `language`

Use `languages` for the saved field because it stores a collection. Use **Language** as the UI label.
