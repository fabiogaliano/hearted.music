# S5-03 · Playlist Profiling Trigger + Match Showcase Step

## Goal

Trigger target-playlist profiling during `flag-playlists` and implement the `match-showcase` step that shows a live match against the user's real playlists using the demo song.

## Why

The match showcase is the "aha moment" — the user sees their demo song matched to their actual playlists. Triggering playlist profiling early ensures profiles are ready by the time the user reaches this step.

## Depends on

- S5-01 (step enum)
- S5-02 (song showcase precedes this)

## Blocks

- S5-04 (plan selection follows)

## Scope

### Playlist profiling trigger
- During `flag-playlists` step (when user saves target playlists), start playlist profiling in the background
- This ensures profiles are ready for the match showcase ~2 steps later

### Match showcase step component
- New component: `MatchShowcaseStep`
- Runs a live match for the demo song against the user's real target playlists
- Uses `priority` queue band for the onboarding matching path
- Shows match results with playlist suggestions
- **Timeout fallback**: if live matching hasn't resolved within ~10–15s, fall back to a canned/pre-built demo match result
- Navigation: advances to `plan-selection`

## Out of scope

- Demo song seeding (setup task)
- Plan selection (S5-04)
- Full match UI design (can refine later)

## Likely touchpoints

| Area | Files |
|---|---|
| Match showcase | `src/features/onboarding/components/MatchShowcaseStep.tsx` *(new)* |
| Onboarding | `src/features/onboarding/Onboarding.tsx` |
| Playlist profiling | `src/lib/server/onboarding.functions.ts` or playlist-related server functions |

## Constraints / decisions to honor

- Demo song is outside monetization
- Matching path uses `priority` band
- Timeout fallback prevents blocking the monetization flow
- Target-playlist enrichment is ungated

## Acceptance criteria

- [ ] Playlist profiling triggered when user saves playlists
- [ ] Match showcase displays match results for demo song
- [ ] `priority` queue band used for onboarding match
- [ ] Falls back to canned result after ~10–15s timeout
- [ ] Navigates to `plan-selection`
- [ ] No credits or unlocks involved

## Verification

- Manual: flag playlists → progress to match showcase → results or fallback displayed
- `bun run test` passes

## Parallelization notes

- New component — minimal conflict risk
- Playlist profiling trigger touches onboarding server functions

## Suggested PR title

`feat(onboarding): playlist profiling trigger and match showcase step`
