# CMHF-17 — Vocals detector editor auto-fill

## Goal

Wire the vocals detector into the production editor so unambiguous intent text fills the visible removable Vocals filter control.

## Depends on / blocks

- Depends on: CMHF-15 and CMHF-16.
- Blocks: auto-fill UX completion.

## Scope

In scope:

- Run the detector on draft matching-intent changes while the editor is open.
- If detection is unambiguous and draft has no `vocalGender`, fill the visible Vocals chip/control.
- Do not overwrite existing draft or saved `vocalGender`.
- Track user dismissal keyed to the exact current draft intent text.
- If the draft intent changes after dismissal, allow detection to run again.
- After saving with no `vocalGender`, do not re-add solely from unchanged saved text on future editor open.
- Add tests/stories for auto-fill, visible chip removal, ambiguity, dismissal, and no re-add on open.

Out of scope:

- Detector keyword implementation.
- Backfill script.
- Matching enforcement for `vocalGender`, already covered by CMHF-11/CMHF-12.

## Likely touchpoints

- `src/features/playlists/components/explorations/SpotlightPanel.tsx`
- `src/features/playlists/components/explorations/WritingSurface.tsx`
- Vocals control/chip components from CMHF-04.
- `src/lib/domains/taste/match-filters/` detector module.
- Ladle stories for detector-filled state.

## Constraints and decisions to honor

Reference `crisp-metadata-hard-filters-decisions.md` sections 7 and 9.

- Auto-filled chip is visible and removable; no hidden filter behavior.
- Broad phrases auto-fill exact-only `vocalGender` when unambiguous.
- Do not overwrite an existing draft or saved `vocalGender`.
- Dismissal is keyed to exact current draft intent text.
- Detection on future editor opens requires a user change to intent text.
- Active-filter count includes unsaved detector-filled vocals chips.

## Acceptance criteria

- Typing `female vocals` into an empty filter draft fills visible Female Vocals chip/control.
- Typing an ambiguous male+female intent does not fill vocals.
- Removing an auto-filled chip prevents re-add while the draft text is unchanged.
- Changing draft text after dismissal allows re-detection.
- Reopening editor on unchanged saved text does not auto-add a dismissed/saved-absent vocals filter.
- Save/cancel behavior remains consistent with CMHF-15.
- Relevant tests and `bun run ladle:build` pass.

## Notes on risks or ambiguity

- Keep dismissal state local to the edit session and exact draft text; do not persist hidden dismissal metadata.
- Ensure guided/onboarding locked manual entry does not accidentally create hidden filter state unless the same visible control is present.
