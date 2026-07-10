# Orchestration decisions — Playlist Creation UX improvements (round 2)

Plan: `docs/playlist-creation/ux-improvements-plan.md`
Branch: `feat/playlist-creation-from-liked-songs`
Run start commit: `b07a12b8`

This log records decisions made during execution that were not fully spelled out in the plan,
one line of rationale each. Written by the orchestrator (subagents report deviations back to
avoid concurrent-write races).

---

## U2 — Let users hear the songs (in-row Spotify playback)

Status: implemented, reviewed (SHIP), patched (2 should-fix items), committed.

### Decisions

- **One `useSingleActivePlayback` instance** created in `CreatePlaylistScreen` and threaded via a
  `playback` prop to both `PreviewList` and `SuggestionsTray` (which forward it to each row),
  mirroring `TrackList`'s shared-instance pattern. `SongVM.id` (internal DB UUID, unique across the
  whole candidate list) is the `playbackId` id space, so preview-row and suggestion-row ids can't
  collide — the "only one preview plays screen-wide" contract holds across both lists.
- **`resetKey` = `flowResult?.status ?? null`.** Stops any in-flight preview the moment a create
  result lands (and on later status transitions, e.g. a created-unsynced retry). NOTE: the lists stay
  mounted after a result — only the footer swaps to Success/Partial/Unsynced; the resetKey stops
  stale audio, it does not unmount the lists. (The original comment overstated this and was corrected
  during the patch round.)
- **Deactivation before mutate:** `PreviewList` (remove) and `SuggestionsTray` (add/dismiss) check
  `playback?.activePlaybackId === song.id` and call `deactivatePlayback()` before the row leaves the
  array, so an actively-playing row that animates out (150ms AnimatePresence exit) doesn't orphan
  audio. `SpotifyEmbedIframe` also self-destructs (`controller.destroy()`) on unmount as
  belt-and-suspenders.
- **Missing-`spotifyId` (or absent `playback` prop) falls back to the original static artwork** — no
  dead/broken play affordance is ever rendered (e.g. empty-list stories).
- **Cover sized 36px** (matching the rows' prior `h-9 w-9`), with play glyph/button sizes scaled down
  from `TrackList`'s 40px reference. `SuggestionRow`'s dimmed-at-rest look preserved via a conditional
  `opacity-75` that lifts to full strength while that row is actively playing.
- **`SpotifyPlaybackCover` provides a11y + reduced-motion + keyboard** — reused as-is (verified via
  `playLabel` wiring), not rebuilt.

### Testing note

- Screen-level cross-list coordination is proven by a new `__tests__/PlaybackCoordination.test.tsx`
  that mounts real `PreviewList` + `SuggestionsTray` sharing one real `useSingleActivePlayback()`
  instance (rather than the full `CreatePlaylistScreen`, which would drag in router/query/extension
  dependencies with no existing harness) — faithfully covers the contract per the plan's "if cheap"
  allowance. No mock of `SpotifyEmbedIframe` needed: its `loadIFrameAPI()` promise never resolves in
  jsdom, so activation is inert/safe in tests.

### Patch round (post-review should-fix)

- Corrected the overstated `resetKey` comment (lists stay mounted; only footer swaps).
- Wired a real `useSingleActivePlayback()` into the Ladle stories (atoms row/list stories +
  composable full-screen harness sharing ONE instance across both lists), so the play cover and
  cross-list coordination are actually visible in Ladle — `ladle:build` alone only proved compile
  safety. `fixtures.ts` already carried real `spotifyId`s, so it was left untouched.

## U4 — Route success into the managed-playlist loop

Status: implemented, reviewed (SHIP), committed.

### Verified fact

- `$playlistRef` resolves to the **internal DB playlist id** (`playlist.id` UUID), NOT the Spotify
  id. Evidence: `buildPlaylistRouteRef(playlist)` builds the ref from `playlist.id` + `playlist.name`
  (`src/features/playlists/playlistRouteRef.ts`); the list keys detail links by internal `p.id`
  (`PlaylistsCoverFlowScreen.tsx`); the route parses it back via `resolvePlaylistIdFromRouteRef`,
  matching on the id-prefix. Reviewer independently confirmed the round-trip.

### Decisions

- **Threaded a new `playlistId` field** from `persistNewPlaylistConfig` (which already had the DB row
  in hand but discarded its id) through `finalizePlaylistCreate` → `CreatePlaylistFromDraftResult`
  → `FlowResult` → `SuccessState`/`PartialState`. Minimal honest change; no fabricated ids, no new
  lookups.
- **`CreatePlaylistFromDraftResult.partial.playlistId` is optional** (required on `success`), because
  the one branch where `persistNewPlaylistConfig` throws before returning genuinely lacks the id and
  recovering it was judged out of scope.
- **SuccessState primary action** → `/playlists/$playlistRef` with retention copy ("We'll keep
  suggesting songs that fit — see them here."); "Open in Spotify" demoted to secondary; the bare
  "Done" action dropped entirely (a second no-op exit alongside the primary "go see it" reads as
  clutter; sidebar nav remains the escape hatch).
- **PartialState** gained a low-emphasis secondary "View playlist" link, rendered only when
  `playlistId` is present. Spotify stays visually primary there because fixing the failed adds is the
  more urgent action.
- Used TanStack Router's `Link` (not `navigate()`) for both new links, matching the existing
  "Open in Spotify" `<a>` pattern and the codebase's convention of `Link` for navigational
  affordances.

### Known limitation (accepted, comment made honest post-review)

- PartialState's link uses a placeholder name slug (`"playlist"`) because the playlist name isn't
  threaded into that state. This resolves in the common case (id-prefix match); only if two of the
  account's playlists share a 12-hex id prefix does it fall back to slug-matching, miss, and safely
  **redirect** to `/playlists` (no crash). This is a pre-existing structural risk of the id-prefix
  routing scheme, not introduced here. Follow-up if it ever matters: thread the real name into the
  partial result. The in-code comment was reworded to state this caveat accurately.

## U1 — Reject suggestions + refresh the tray

Status: implemented, reviewed (SHIP), committed.

### Decisions

- **Refresh mechanism = option (a):** added a `suggestionsOffset` int (default 0) to the
  `previewPlaylistDraft` input, consumed by `assembleDraft` to page the suggestions slice deeper
  into the already-scored `rankedCandidates` array (after pinning/exclusion filtering). Chosen over
  "exclude nothing, page deeper" because it's the smallest honest server change — no extra scoring
  pass, no client dedup — and it guarantees genuinely new, never-excluded songs per refresh.
- **Undo toast on dismiss = yes**, reusing `restoreSong`. Dismiss and preview-remove are the same
  underlying exclusion mechanism; giving one undo but not the other would be an arbitrary
  inconsistency.
- **`suggestionsOffset` resets on config change, NOT on selection (add/dismiss) change** — resetting
  on every dismiss would snap the tray back to the top-ranked batch and discard the user's
  "page deeper" progress; only a real config change invalidates the ranking enough to justify it.
- **`ROTATION_THRESHOLD = 2` heuristic** added in `SuggestionsTray` to distinguish "one row changed"
  (let per-row `AnimatePresence` handle exit) from "whole batch rotated" (run the existing whole-tray
  fade). Needed once dismiss/refresh could both change the fingerprint; without it every single
  dismiss double-animates (row exit + tray fade).
- Server input caps `suggestionsOffset` at 1000 (generous ceiling), mirroring how other count fields
  in that schema are bounded.
- **`dismissSuggestion` collapsed to an alias of `removeSong`** (post-review dedup) — the transition
  is identical today, so a byte-for-byte copy was a silent-drift risk; aliasing keeps the distinct
  semantic name the plan asked for while guaranteeing the two can't diverge.

### Known nit (accepted, not fixed)

- The tray "Refresh" button has no disabled/exhausted state: after repeated refreshes exhaust the
  entire ranked pool, a further refresh clamps to the last window and visually no-ops. Not a
  correctness bug and out of the plan's scope; left as future polish.

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
