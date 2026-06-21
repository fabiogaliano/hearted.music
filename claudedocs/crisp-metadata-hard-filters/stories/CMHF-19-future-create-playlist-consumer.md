# CMHF-19 — Future create-playlist consumer reuse

## Goal

Reserve the future create-playlist-from-liked-songs feature to reuse the same `matchFilters` object and predicate semantics.

## Depends on / blocks

- Depends on: CMHF-01 and future create-playlist feature design.
- Blocks: nothing in the current suggestions release; this story is deferred.

## Scope

In scope when scheduled:

- Consume soft matching text, genre pills, and `PlaylistMatchFiltersV1` in the future create-playlist flow.
- Reuse match-filter domain predicates instead of creating a second schema.
- Decide whether the future flow needs a different options source based on its candidate population.
- Add tests proving create-playlist filtering matches suggestion filtering for shared candidate metadata.

Out of scope now:

- Implementing the create-playlist feature.
- Adding a second filter schema.
- Changing suggestion matching semantics.

## Likely touchpoints

- Future create-playlist feature modules.
- `src/lib/domains/taste/match-filters/` predicates/display helpers.
- Potential future options RPC if candidate population differs from matching suggestions.

## Constraints and decisions to honor

Reference `crisp-metadata-hard-filters-decisions.md` sections 2, 3, 5, and 10.

- Hard filters remain shared playlist configuration.
- Future create-playlist consumer must not introduce a second filter schema.
- Predicate behavior must not diverge from suggestions.
- Option source may differ only if candidate population differs; saved semantics stay shared.

## Acceptance criteria

- Future feature uses `PlaylistMatchFiltersV1` or an intentional versioned successor.
- Predicate helpers are shared with matching enforcement.
- Tests cover language, release-year, liked-date, and vocals parity with suggestions.
- Any new options source documents its candidate population difference.

## Notes on risks or ambiguity

- This is intentionally deferred because the current plan ships suggestion filtering first.
- Revisit after the create-playlist product flow is defined.
