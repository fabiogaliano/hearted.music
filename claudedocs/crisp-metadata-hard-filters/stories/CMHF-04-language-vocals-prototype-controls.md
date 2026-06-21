# CMHF-04 — Language and vocals prototype controls

## Goal

Prototype the Language multi-select and manual Vocals control inside the local Advanced filters UI.

## Depends on / blocks

- Depends on: CMHF-03.
- Blocks: CMHF-06 and production UI work in CMHF-13/CMHF-14.

## Scope

In scope:

- Add a searchable Language control backed by mock `PlaylistMatchFilterOptions.languages` data and the catalog helpers from CMHF-01.
- Show selected languages first, detected languages by count, then catalog-only languages alphabetically.
- Support selecting/removing multiple language chips while preserving selected order.
- Add a manual Vocals control with Female/Male values and removal via the selected chip `X`.
- Add local loading/error disabled states for these controls while preserving chip removal.
- Add Ladle states for many selected languages, long labels, undetected catalog search, and vocals selected.

Out of scope:

- Production options RPC calls.
- Vocal keyword detector behavior.
- Release-year and liked-date controls.
- Persistence.

## Likely touchpoints

- `src/features/playlists/components/explorations/WritingSurface.tsx`
- `src/features/playlists/components/explorations/WritingSurface.stories.tsx`
- New language/vocals control component files under playlist exploration components.
- Domain helpers from `src/lib/domains/taste/match-filters/`.

## Constraints and decisions to honor

Reference `crisp-metadata-hard-filters-decisions.md` sections 5, 6, 7, and 9.

- Search matches code, canonical English label, and curated aliases/endonyms.
- Any catalog language remains selectable even if undetected in the user library.
- Detected codes absent from the catalog are not selectable.
- `languages.codes` preserves first selection order after dedupe/normalization.
- Vocals UI copy is **Vocals**, values **Female** / **Male**.
- Vocals clearing uses the chip remove `X`; no separate inline Clear button for that control.
- Loading/error states disable expanded controls but keep existing chip removal enabled.

## Acceptance criteria

- Language control supports selecting catalog-only languages from search.
- Selected language chips render one chip per language in selected order.
- Removing one language preserves the relative order of the remaining languages.
- Language option ordering matches selected -> detected count desc -> catalog alphabetic.
- Vocals control can select Female or Male and clear through the selected chip remove action.
- In loading/error stories, existing language/vocals chips remain removable while controls are disabled.
- Keyboard interaction is verified in Ladle for picker opening, selection, and chip removal.

## Notes on risks or ambiguity

- Avoid custom combobox behavior unless it is ARIA-compliant; native controls are acceptable if they satisfy behavior.
- Do not introduce a hidden detector-only vocals state; this story is the manual visible control.
