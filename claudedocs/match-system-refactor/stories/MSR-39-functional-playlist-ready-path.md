# MSR-39 — Functional playlist ready-path (orchestrator-added, plan-gap closure)

## Goal

Produce the user-facing playlist review experience end-to-end. The plan's stated
deliverable (playlist-mode launch) is not produced by any single MSR-01–38 story:
the schema, ranking, queue, capture, route, and UI-shell stories each build a
piece, but nothing wires a playlist queue item all the way to a rendered card
with working add/dismiss/finish handlers. MSR-39 closes that gap.

## Depends on / blocks

Depends on:

- MSR-34 (PLAN-GAP — the song/playlist UI shell and orientation-aware session
  composition must exist before the playlist render path can be wired in)

Blocks:

- MSR-38 (docs/regression hardening must reflect the functional playlist path)

Phase: 7.5 (between the Route/UI launch wave and docs/regression hardening).

## Scope and out of scope

In scope:

- Add a playlist arm to the `presentMatchReviewItem` render builder: fetch the
  review playlist's metadata (→ `MatchingPlaylistForReview`) and the captured
  suggestion songs' metadata (→ `MatchingSongSuggestion[]` with `fitScore` from
  captured pairs), mirroring the song arm's `Promise.all` shape.
- Make `MatchReviewItemRead.ready` a discriminated union keyed on
  `mode: "song" | "playlist"` so song-only and playlist-only fields never leak
  across orientations.
- Co-locate the new server render types (`MatchingPlaylistForReview`,
  `MatchingSongSuggestion`) in `matching.functions.ts` next to `MatchingSong` /
  `MatchingPlaylistMatch`.
- Wire `QueueCardContent`'s `currentReviewItem` mapping plus the
  add/dismiss/finish/skip handlers for playlist mode (orientation-neutral guards
  keyed on `currentReviewItem`, not `currentSong`).
- Extend the `song_added_to_playlist` analytics event with an `orientation`
  property for both modes (existing taxonomy preserved — no new event invented).

Out of scope:

- New product features beyond making the planned playlist mode functional.
- Changing song-mode behavior or visual equivalence.
- Snapshot/ranking/queue semantics (owned by MSR-05–28).

## Likely touchpoints

- `src/lib/server/match-review-queue.functions.ts` (`presentMatchReviewItem`,
  `MatchReviewItemRead`)
- `src/lib/server/matching.functions.ts` (render types)
- `src/features/matching/**` (`QueueCardContent`, mode handlers, sections)
- Relevant tests under `src/**/__tests__/`

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` — discriminated `ready` variant by
  mode; no optional-field leakage across orientations.
- `getMatchReviewItem` (non-authoritative warming) remains song-only; returning
  `unavailable` for playlist items is the accepted prefetch-only limitation —
  a playlist render path in the warming function adds complexity with no
  user-visible benefit (the authoritative `presentMatchReviewItem` path renders
  the card).
- `recordCurrentItem` for playlist mode sets `artist: ""` because
  `ReviewedItem.artist` is required and a playlist has no artist; the completion
  screen treats it as an optional display field.

## Acceptance criteria

- A playlist queue item renders a functional review card with its suggestion
  songs and match percentages.
- Add / dismiss / finish / skip work in playlist mode and record the correct
  decisions/events with `orientation` set.
- `completionStats.itemsMatched` is correct in both modes (the additions set is
  keyed on review-item id — song id in song mode, playlist id in playlist mode).
- No song-mode regression: the song arm and its captured-rank semantics are
  unchanged.

## Notes on risks or ambiguity

- This story was added by the implementation orchestrator to close a real
  plan gap; it is a peer of MSR-38 in the dependency graph and is reflected in
  the stories README index, story-dependency map, and the decisions log
  (`claudedocs/orchestration-match-system-refactor-decisions.md`).
