# Song detail panel — old vs. new (parity audit)

What the **old** liked-songs detail panel had that the **new** concept panel does/doesn't,
with current status checked against the working tree and recent commits.

- **Old:** `components/SongDetailPanel.tsx` + `detail/PanelContent.tsx` + `detail/PanelHero.tsx` + `detail/usePanelAnimation.ts` + `detail/usePanelShortcuts.ts` (all deleted). Rendered v2 `AnalysisContent`.
- **New:** `components/concept-panel/SongDetailPanel.tsx` (chrome) + `SongDetailPanelSurface.tsx` (read surface). Renders v17 `ConceptRead` via `concept-adapter.ts`.

The bulk of the gap is the deliberate data-model switch (v2 `AnalysisContent` → v17 `ConceptRead`) plus a simplified shell. Items below are split into **done**, **still missing**, and **superseded**.

Relevant commits:

- `7e7b6ae` feat: render live v17 reads via the concept song-detail panel
- `c893cc9` refactor: promote concept panel, remove panel prototypes
- `e65af6f` feat: restore walkthrough CTA in concept detail panel
- `7f33b4c` feat: add locked & analyzing states to concept panel

Legend: ✅ done · ❌ still missing · 🔁 superseded by the v17 redesign

---

## ✅ Already re-added

- ✅ **Walkthrough mode** — `isWalkthrough` prop + sticky `WalkthroughCta` ("See where this song belongs →"). Wired in `LikedSongsPage` (passes `isWalkthrough`). _(commit `e65af6f`)_
- ✅ **Enrichment-in-progress state** — `isEnrichmentRunning` prop drives a "Listening" state with a pulse dot + "Getting a feel for this one…" copy (also fires on `displayState` `analyzing`/`pending`). _(commit `7f33b4c`)_
- ✅ **Distinct locked-song UI** — `LockedState`: lock icon, "This song is locked", and a `lockedCta` button. Page resolves the CTA to **"Unlock this song"** (credits) or **"See plans"** (paywall); hidden in walkthrough/Ladle. Adapter now sets `displayState`, so it actually fires. _(commit `7f33b4c`)_
- ✅ **No-analysis fallback copy** — old "We couldn't find enough information about this song" → new "Quiet one" / "We couldn't find enough about this one." _(commit `7f33b4c`)_
- ✅ **Genre pills** (primary + alternates). `genres` is carried in the adapter + `ConceptSong` type but never rendered.

- ✅ **Graceful partial audio features** — old `SonicNumbers` null-filtered and showed only the columns it had (e.g. bpm alone). New gates the whole block on `tempo > 0` and otherwise shows nothing.

- ✅ **Add-to-playlist.** `PlaylistsSection` (score %, sorted matches, "added" state), the suggestions query (`songSuggestionsQueryOptions`), Spotify `addToPlaylist` + reconnect handling (`SpotifyReconnectLink`), and the `addSongToPlaylist` server call. Verified: no playlist/suggestion code anywhere in `concept-panel/`. The adapter still carries `spotifyTrackId`, but nothing uses it.

---

## ❌ Still missing — probable regressions

- ❌ **Shared-element view-transition morph (card → panel).** Old `PanelHero` set `viewTransitionName: song-album / song-title / song-artist` when expanded, matching the tags `SongCard.tsx:195` still sets on click, driven by `useSongExpansion`'s `startViewTransition` with dedicated CSS (`styles.css:320`). The new surface sets **no** `viewTransitionName` (verified: none in `concept-panel/`), so the album/title/artist morph from the clicked row is silently broken — the card tags itself but has nothing to morph into.

---

## ❌ Still missing — likely intentional simplification (confirm desired)

- ❌ **On-screen prev/next nav buttons** (old hero `Nav`). New is keyboard-only (j/k, ↑/↓) with only a close button.

- ❌ **FLIP enter animation from the clicked row** (`startRect`) — removed here and from `LikedSongsPage`. Replaced by a plain slide-in.

---

## 🔁 Superseded by the v17 read model (intentionally gone)

- 🔁 **"Read deeper / ← back" headline↔interpretation toggle** → v17 shows `image` (display headline) + `take` (paragraph) directly, no toggle.
- 🔁 **`compound_mood` / `mood_description` block** → replaced by the `lens · tension` eyebrow.
- 🔁 **Two-level Escape + Enter analysis semantics** (Enter opens analysis; first Escape closes the analysis layer, second closes the panel) → no analysis layer now, so Escape always closes the panel and there's no Enter shortcut.
- 🔁 **Themes list** (`analysis.themes` names under the headline).
- 🔁 **Sonic texture in the hero** — old surfaced `sonic_texture` inline beside the title (with a `balancedLines()` two-line balancer) when analysis was open. New only shows texture as a separate "Texture" trace block.
- 🔁 **Collapse/expand scroll choreography** (`usePanelAnimation`) — scroll interception, snap states, sticky 108px hero that collapses, staggered reveal, crossfade, sonic-texture single-line collapse. New is a plain scroll surface.

## 🔁 Maybe Later

- 🔁 **Light mode + theme override** — old `isDark` (dual palettes), `theme` override prop, light-mode vignette. New is dark-only (`getThemedDarkColors` always).

---

## Carried over — NOT missing (for completeness)

- Hero, album art, title/artist/album meta, and sonic numbers (bpm/energy/valence) all remain.
- `journey → arc`, `key_lines → lines`, `sonic_texture → texture`, `headline/interpretation → image/take` map across.
- Keyboard nav (escape, j/k, ↑/↓) and the slide-in shell are preserved.

---

## Suggested next actions

1. **Decide on the view-transition morph** — either re-tag the new hero's album/title/artist with the matching `viewTransitionName`s, or remove the now-orphaned tags on `SongCard` to avoid a dead transition.
2. **Confirm add-to-playlist is intentionally dropped** from this surface (vs. relocated elsewhere). If it should stay, it's the largest functional gap.
3. **Confirm the simplifications** (nav buttons, genres, partial audio features) are desired, or restore selectively.
