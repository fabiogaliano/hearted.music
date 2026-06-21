# CMHF-05 — Release-year and liked-date prototype controls

## Goal

Prototype mode-aware Release year and Liked date controls with local state and mock bounds.

## Depends on / blocks

- Depends on: CMHF-03.
- Blocks: CMHF-06 and production UI work in CMHF-13/CMHF-14.

## Scope

In scope:

- Add Release year controls for decade preset, exact year, before/through, after/from, and custom range.
- Add Liked date controls for year preset, before/through date, after/from date, custom range, and explicit through-today.
- Use domain normalization/display helpers from CMHF-01.
- Respect mock option bounds for add/edit affordance visibility.
- Preserve and allow inspecting/editing saved active values that are outside current option bounds.
- Add disabled loading/error state behavior for expanded controls.
- Add Ladle states for sparse bounds, unavailable bounds, out-of-bounds saved filters, and narrow drawer widths.

Out of scope:

- Production options RPC calls.
- Matching predicate implementation beyond using CMHF-01 helpers.
- Server persistence.
- Histogram/rich timeline visuals beyond what is required for v1 controls.

## Likely touchpoints

- `src/features/playlists/components/explorations/WritingSurface.tsx`
- `src/features/playlists/components/explorations/WritingSurface.stories.tsx`
- New release-year and liked-date control component files.
- `src/lib/domains/taste/match-filters/` display/normalization helpers.

## Constraints and decisions to honor

Reference `crisp-metadata-hard-filters-decisions.md` sections 3, 5, 6, and 7.

- UI labels are **Release year** and **Liked date**.
- Saved unions use `exact`, `before`, `after`, and `range`; no stored labels or sentinel bounds.
- Release-year option bounds guide controls only; save validation uses app year bounds.
- Liked-date presets persist fixed UTC year boundaries.
- Explicit custom through-today persists `{ end: { kind: "today" } }` only for that explicit mode.
- If bounds are unavailable, hide add/edit controls but keep existing active chips visible and removable.
- Out-of-bounds saved active values are preserved, inspectable, and editable; do not clamp.

## Acceptance criteria

- Each release-year mode normalizes to the correct `ReleaseYearFilterV1` shape.
- Each liked-date mode normalizes to the correct `LikedAtFilterV1` shape.
- Year/date range validation prevents impossible local drafts from being saved in the prototype harness.
- Unavailable release-year bounds hide add/edit affordances while active chips remain visible.
- Unavailable liked-date oldest bound hides add/edit affordances while active chips remain visible.
- Out-of-bounds saved filters remain visible and editable in stories.
- Keyboard interaction is verified for mode changes and fields.

## Notes on risks or ambiguity

- Keep visual polish flexible for Ladle review; do not defer semantic behavior.
- Use date-only UTC strings consistently in stories to avoid local timezone drift.
