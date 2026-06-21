# CMHF-02 — Persistence migration and generated DB types

## Goal

Add durable database storage for playlist match filters and update DB documentation for exact-only vocals semantics.

## Depends on / blocks

- Depends on: CMHF-01.
- Blocks: CMHF-07, CMHF-08, CMHF-09, CMHF-10, CMHF-18, and production UI persistence.

## Scope

In scope:

- Add a Supabase migration for `playlist.match_filters jsonb NOT NULL DEFAULT '{"version":1}'::jsonb`.
- Add a light object check constraint for `match_filters`.
- Add or update the `song.vocal_gender` column comment to document exact-only filter semantics.
- Regenerate `src/lib/data/database.types.ts`.
- Fix compile/test fallout from the new non-null playlist column in fixtures or typed inserts.

Out of scope:

- Full JSON schema constraints in SQL.
- Server save/read functions.
- UI rendering.
- Matching enforcement.

## Likely touchpoints

- `supabase/migrations/*`
- `src/lib/data/database.types.ts`
- Existing playlist fixture builders or typed insert helpers.
- Existing vocal-gender migrations, especially `20260619140000_add_song_vocal_gender.sql` and follow-ups.

## Constraints and decisions to honor

Reference `crisp-metadata-hard-filters-decisions.md` sections 1, 3, 5, and 10.

- DB column name is `match_filters`.
- Root default value is `{ version: 1 }`.
- Use light DB constraints; strict schema validation belongs in app code.
- Vocal comment must say `female` filters pass only `female`, `male` filters pass only `male`, and `mixed` does not pass either.
- No feature flag.

## Acceptance criteria

- Migration adds `playlist.match_filters` with the exact default object and `NOT NULL`.
- Migration adds a check that the JSONB value is an object.
- Migration/comment update documents exact-only `song.vocal_gender` filter semantics.
- Generated DB types include `playlist.match_filters` on row/insert/update types.
- Existing tests/fixtures compile after type regeneration.
- Relevant migration/typecheck/test command passes or any failure is documented with the exact blocker.

## Notes on risks or ambiguity

- Generated type changes may force updates in broad playlist fixtures.
- Do not encode the full `PlaylistMatchFiltersV1` JSON schema in SQL; that would duplicate app validation and make future versions harder.
