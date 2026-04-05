# S5-02 · Song Showcase Step Component

## Goal

Implement the `song-showcase` onboarding step that displays analysis of a pre-seeded demo song.

## Why

The song showcase demonstrates the product's core value (song analysis) before the user sees pricing. It uses a pre-seeded demo song to guarantee a fast, consistent experience.

## Depends on

- S5-01 (step enum includes `song-showcase`)
- Pre-seeded demo song available in dev/test environments

## Blocks

- S5-03 (match showcase follows this step)

## Scope

- New component: `SongShowcaseStep`
- Displays pre-seeded demo song analysis (song name, analysis content, visual highlights)
- Demo song is completely outside monetization: no unlock row, no credit use, no replacement credit
- Reads demo song analysis from the database (pre-seeded)
- Navigation: advances to `match-showcase` on user action

## Out of scope

- Match showcase (S5-03)
- Plan selection (S5-04)
- Demo song seeding (setup task)
- Full design/polish (can be refined later)

## Likely touchpoints

| Area | Files |
|---|---|
| Component | `src/features/onboarding/components/SongShowcaseStep.tsx` *(new)* |
| Onboarding | `src/features/onboarding/Onboarding.tsx` (wire component) |
| Server function | May need a loader/function to fetch demo analysis |

## Constraints / decisions to honor

- Demo song is outside monetization — no billing interaction
- Guided showcase uses pre-seeded data, not the user's pipeline
- Must not block if demo data is missing (graceful fallback)

## Acceptance criteria

- [ ] Displays demo song analysis content
- [ ] No unlock rows or credits involved
- [ ] Navigates to `match-showcase` on user action
- [ ] Graceful handling if demo song is not found
- [ ] Project compiles

## Verification

- Manual: navigate to step → analysis displayed → advance
- `bun run test` passes

## Parallelization notes

- New component — no merge conflicts
- Can run in parallel with S5-03 (different components)

## Suggested PR title

`feat(onboarding): song showcase step with demo song analysis`
