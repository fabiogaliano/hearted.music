# Orchestration decisions — Playlist Creation UX improvements (round 2)

Plan: `docs/playlist-creation/ux-improvements-plan.md`
Branch: `feat/playlist-creation-from-liked-songs`
Run start commit: `b07a12b8`

This log records decisions made during execution that were not fully spelled out in the plan,
one line of rationale each. Written by the orchestrator (subagents report deviations back to
avoid concurrent-write races).

---

## U3 — Ladle-only prototypes: match-reason hints + starting presets

Status: implemented, reviewed (SHIP), committed. Ladle-only, zero prod wiring.

### Directions built

**Match-reason hints** (each rendered on both a PreviewSongRow-alike and a SuggestionRow-alike,
in a believable two-section list with an active-config legend):

- **Inline Hint** (`MatchReasonInlineHint`) — a muted third text line under the artist name,
  always visible (e.g. "Indie pop · 2014", "Matches your Pop pick · 2020", "From your top artist SZA").
- **Pill Echo** (`MatchReasonPillEcho`) — no new copy; the row's existing genre pill highlights in
  the accent color when it's the pill that matched; the exact reason surfaces as a hover tooltip.
- **Hover Detail** (`MatchReasonHoverDetail`) — reason hidden at rest, revealed under the artist
  line on row hover/focus-within via a CSS grid-rows transition (motion-reduce aware).

**Starting presets** (shown when config is empty):

- **Cards Row** (`PresetCardsRowStory`) — a "Quick start" row of bordered preset cards above a
  config stand-in ("Recent favorites", "All things indie", "Throwbacks: 2010s", "Late-night
  electronic"); self-dismisses once one is picked.
- **Chips In Config** (`PresetChipsStory`) — dashed low-commitment chips ("Or start from…") above
  the genre-picker stand-in, echoing GenrePillsPicker's own quick-pick chip styling.
- **Empty-State Takeover** (`PresetEmptyStateTakeoverStory`) — replaces the whole config surface
  with a full-bleed "Where should we start?" choice screen on first landing, with an explicit
  "Start from scratch" escape hatch.

### Recommendation (for human Ladle validation)

Adopt **Pill Echo** (match-reason) + **Cards Row** (presets): Pill Echo has zero layout cost and
reuses a chip users already recognize, degrading gracefully when there's no genre match; Cards Row
is visible without being modal/blocking and self-dismisses once used. **Hover Detail** is the
fallback if Pill Echo's tooltip-only reason reads as too hidden. The **Empty-State Takeover** is the
riskiest (it ambushes new users) — validate carefully before considering it.

### Decisions not in the plan

- Story names prefixed with `"Prototype — "` in the flat Ladle sidebar to distinguish them from
  prod stories — the plan specified export names but no display-name convention.
- Extracted a small shared `MatchedGenrePill` atom (kept local to `prototypes/`) because Pill Echo
  needed identical highlighted-pill rendering on both row variants ("extract at genuine seams").
- Each preset direction wraps a minimal inline "config stand-in" rather than mounting the real
  `ConfigSurface`, to keep prototypes fully decoupled from `useQuery`-backed config components and
  avoid drifting into prod wiring.
- Prototype fixtures kept local to `prototypes/fixtures.ts` (shapes copied from
  `src/lib/domains/playlists/fixtures.ts`, extended with fictional `matchReason`/`matchedGenre`/
  `releaseYear`/preset data); the shared fixtures file was intentionally left untouched.
