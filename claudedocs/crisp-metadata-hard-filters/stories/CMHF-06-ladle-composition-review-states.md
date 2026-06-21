# CMHF-06 — Ladle composition and review states

## Goal

Complete Ladle coverage for the approved Advanced filters UI before any production wiring.

## Depends on / blocks

- Depends on: CMHF-03, CMHF-04, and CMHF-05.
- Blocks: CMHF-13 production editor integration.

## Scope

In scope:

- Compose the full Advanced filters UI in `WritingSurface` stories with mock/local state.
- Update `SpotlightPanel` stories to show full drawer composition with filters.
- Add required stories for no filters, multiple chips, expanded all-controls state, detector-filled vocals chip state, option loading/error, dense language selections, long playlist names, narrow drawer widths, sparse option bounds, and composition with intent/genre pills.
- Verify keyboard behavior in Ladle.
- Run `bun run ladle:build`.
- Record any approved visual-treatment decisions in the story notes or source docs if they affect behavior.

Out of scope:

- Production server calls.
- Schema/server/matching work.
- Changing locked behavior from the decisions doc.

## Likely touchpoints

- `src/features/playlists/components/explorations/WritingSurface.stories.tsx`
- `src/features/playlists/components/explorations/SpotlightPanel.stories.tsx`
- `src/features/playlists/components/explorations/fixtures.ts`
- New mock option data fixtures.
- UI component CSS/classes as needed.

## Constraints and decisions to honor

Reference `crisp-metadata-hard-filters-decisions.md` sections 2, 7, and 10.

- Every new UI surface must be prototyped and reviewed in Ladle before production wiring.
- Visual treatment may be settled in Ladle, but saved data, matching semantics, accessibility, and interaction behavior cannot drift.
- Active chips remain visible source-of-truth.
- Loading/error options states keep intent/genre editing possible and chip removal enabled.

## Acceptance criteria

- Ladle stories cover every required state listed in the plan section 5 and decisions section 7.
- Full `SpotlightPanel` story demonstrates filters in the real drawer width context.
- Existing stories still cover current intent/genre behavior.
- Keyboard behavior for chips, picker, controls, and collapsible area is reviewed.
- `bun run ladle:build` succeeds.
- UI is explicitly approved before CMHF-13 starts.

## Notes on risks or ambiguity

- If review uncovers a behavioral gap, update the decisions/plan docs before production wiring.
- Keep mock state close to production prop shapes so CMHF-13 does not reinterpret behavior.
