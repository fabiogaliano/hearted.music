# MSR-18 — Orientation-aware active sessions and queue subjects

## Goal

Create/resume match review sessions and queue items independently for song and playlist orientations.

## Depends on / blocks

Depends on:

- MSR-06
- MSR-17

Blocks:

- MSR-19
- MSR-20
- MSR-22

## Scope and out of scope

In scope:

- Update session repository APIs to take `MatchOrientation` explicitly.
- Update insert/fetch active session behavior to use one-active-per-orientation.
- Map nullable DB subject columns into `MatchReviewSubject` in exported DTOs.
- Update create/resume/append queue flows to write queue item orientation and correct subject column.
- Preserve existing song-mode behavior through defaults and adapters.

Out of scope:

- Visible suggestion capture.
- Dashboard/sidebar preference summaries.
- Playlist-mode UI.

## Likely touchpoints

- `src/lib/domains/taste/match-review-queue/queries.ts`
- `src/lib/domains/taste/match-review-queue/service.ts`
- `src/lib/server/match-review-queue.functions.ts`

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` A2, B3, C5, C6, E8.
- Every queue boundary takes orientation explicitly.
- Repository mappers may read nullable DB fields; exported types must use discriminated unions.

## Acceptance criteria

- A user can have one active song session and one active playlist session.
- Song-mode session creation remains compatible with existing callers after adapter updates.
- Invalid mixed/missing subject DB rows are handled as errors rather than exposed as optional fields.

## Notes on risks or ambiguity

- This story is a hot spot for server compile errors; keep UI changes out until server contracts are stable.
