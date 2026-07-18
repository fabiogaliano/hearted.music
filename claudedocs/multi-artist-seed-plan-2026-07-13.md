# Multi-artist "Around [artist]" seed → studio — plan

Status: agreed design, ready to build in slices. Captured after discussion on
2026-07-13. We will still iterate during implementation.
Engine prerequisite shipped in `849745ea` (refactor(playlists): rewrite draft
engine around composePlaylistPreview) — see the DONE section below.

## Goal

Let the "Around [artist]" seed carry into the studio as a real, editable,
**multi-artist** selection: add artists (no hard upper bound), see them as
chips, toggle each on/off, remove with undo, and manage a large set via an
overflow dialog with search. The playlist stays balanced across the selected
artists and respects `maxSongs`.

## Decisions locked (from discussion)

- **Model = pins, not a scoring filter.** There is no artist-adjacency signal in
  the codebase (no artist graph / embeddings), and the candidate pool is the
  user's own liked songs, so an "artist filter" would resolve to the same set as
  pinning the artist's liked songs. So we pin — but with **balanced allocation**
  (see below), not raw "pin everything".
- **Interaction = toggle + remove-with-undo. No confirm dialog.**
  - Click a chip body → enable/disable (dim). Instant, non-destructive,
    reversible by clicking again. This is the "dim so I can reactivate" need.
  - Chip ✕ → remove the artist entirely, with a sonner Undo toast (reuse the
    existing `removeSong`/`dismissSuggestion` pattern in `CreatePlaylistScreen`).
  - Confirm dialogs are reserved for destructive/hard-to-reverse/saved-state
    actions; an unsaved draft you can re-add to via search is none of those.
- **Filter semantics = split (decided 2026-07-13).** Hand-added songs are
  commitments: match filters never evict them; exclusion still wins. Engine
  fill obeys filters as today. Artist-derived songs obey filters via
  **filter-aware resolution**: per-artist song ids are resolved WITH the
  current match filters applied (server-side, re-resolved when filters
  change), so allocation and chip counts are honest by construction.
  Pin provenance must survive the client/server boundary: the preview request
  carries the ordered effective `pinnedSongIds` plus
  `manualPinnedSongIds`, the filter-exempt subset. The server builds the draft
  profile from filter-eligible candidates only, then adds still-liked,
  Phase-1 manual-pin candidates to the set sent to `rankCandidates`. This
  scores manual commitments against the filtered profile without letting them
  reshape it. Under this split nothing the user chose ever silently vanishes,
  so no dropped-pins note is needed — `droppedPinnedSongIds` remains a rare
  safety net (unliked-since, exclusion, stale artist resolution, clamp).
- **Tracklist shows ownership via section eyebrows (decided 2026-07-13).**
  "Your picks · N" over the pinned block, a second label over the engine
  fill — the existing uppercase section-label idiom. Purely typographic; no
  per-row pin icons or badges. (Today a hand-added song is visually identical
  to an engine pick after its 1.5s entry pulse — this closes that gap and
  makes the stability contract visible.)

## Behavior: balanced allocation (the fairness half of the `maxSongs` story)

### Engine-side invariant — DONE (`849745ea`, shipped 2026-07-13 ahead of this plan)
`draft-engine.ts` was rewritten with new names: `assembleDraft` →
`composePlaylistPreview`, `DraftResult` → `PlaylistDraftPreview`, the `preview`
field → `tracklist`, `scoreCandidates` → `rankCandidates`, `filterCandidates` →
`selectEligibleCandidates`, `buildProfileFromPills`/`FromIntent` → one
`buildDraftProfile(eligible, genrePills, intentEmbedding?)`. Behavior changes:
- The tracklist is **clamped to `maxSongs`, pins included** — the old overflow
  (pins emitted in full, slider meaningless) is fixed at the engine level.
- Pins that can't be honored — excluded, filtered out / unliked, or cut by the
  clamp — are reported in `droppedPinnedSongIds` (exposed through
  `useCreatePlaylistDraft`) instead of silently vanishing. After slice 1,
  filter eviction applies only to artist pins (normally only during a stale
  resolution race); manual pins are filter-exempt. The `ArtistConfig` chips
  should use this so per-artist counts never lie.
- Clamped pins do not re-enter the suggestions pool.

### What this plan still has to build
The clamp is the *invariant*; the allocation below is the *policy* that keeps
the artist pin set within budget so the clamp rarely fires. Fairness is still
unbuilt: pins keep insertion order and we'd pin artist-by-artist, so a heavy
artist swamps a light one; no interleaving, no balancing.

### The allocation (client-side, before pinning)
Given the enabled artists and each artist's resolved liked-song IDs:
1. `slots` = the budget for the artist selection (default: all of `maxSongs`).
2. `perArtist = floor(slots / enabledCount)`.
3. Each artist contributes their **top `perArtist`** songs — most-recently-liked
   first, the order `getLikedSongIdsByArtist` already returns (see Resolved).
4. **Redistribute remainder:** artists with fewer songs than their quota return
   the unused slots to a pool, re-split among artists who still have more, until
   no slots remain or no artist has more to give. No empty slots, no
   heavy-artist over-representation.
5. **Interleave** round-robin (A1, B1, C1, A2, B2, C2…) so the top of the
   tracklist reads as breadth, not a block.
6. The resulting balanced, interleaved ID list is what we pin.

Re-run allocation whenever the enabled artist set, any toggle, or `maxSongs`
changes.

### Not in v1
- Per-artist "shrink" stepper. The even split already prevents dominance and is
  correct without it. Expose a per-artist cap in the overflow dialog later if
  wanted (v2).

## Data model (`useCreatePlaylistDraft`)

Add an ordered artist-selection list to draft state:
```
artistSelections: { name: string; songIds: string[]; enabled: boolean }[]
```
- Enabled artists' allocated songs (post-balance) union into the pin set.
- Disabled artists stay in the list but contribute no pins.
- Remove drops the entry (Undo re-inserts it at its prior position).
- Keep artist-owned pins separate from songs the user manually pins/adds, so
  toggling/removing an artist never disturbs manual pins.
- At query-key/request assembly time derive two values:
  - `pinnedSongIds`: the deduplicated, ordered effective union used by
    `composePlaylistPreview` for tracklist order.
  - `manualPinnedSongIds`: the manual subset, used only to grant the match-filter
    exemption. Never reconstruct this subset from the effective union.
- The preview input schema bounds both arrays to `maxSongs`/50 and intersects
  `manualPinnedSongIds` with `pinnedSongIds` before use. A manual id that is no
  longer an active Phase-1 liked-song candidate is still dropped and reported.

New actions (names indicative): `addArtist(name)`, `toggleArtist(name)`,
`removeArtist(name)`, and internal re-allocation that recomputes the artist pin
set. Existing manual-song actions mutate only `manualPinnedSongIds`.

## Server query (new)

Need a "search my liked artists by name" query to power type-to-search.
- `/liked-songs` search is a client-side text filter over loaded songs — not an
  artist autocomplete — so it can't be reused directly.
- `getLikedSongIdsByArtist` resolves one known name → IDs; we still use it (or a
  batched variant) to resolve each added artist's songs.
- Add a small server fn returning the account's liked artists (name + like-count,
  optional image) filtered by a query string, ranked by like-count. Source: same
  aggregate that feeds `topArtists` in the taste profile, without the top-5 cap.

## Seed card change (`SeedStage` / `TemplateCard`)

- On the "Around [artist]" card, once the first artist blank is filled, show a
  small `+` (add-artist) affordance next to the blank.
- Clicking `+` does **not** try to add artist #2 inline. It **commits the seed
  into the studio** (artist #1 already selected + pinned) and lands with the
  studio's artist search focused, ready for #2.
- Rationale: the seed card is a compact starting point; past one artist the
  studio is the right home, so the user isn't cramming a list into the tiny card.

## Studio: new `ArtistConfig` panel (sidebar, next to Genre/Filters)

Layout, top to bottom:
- **Search/write input** at the top (type to find one of your liked artists).
- **Chips list** below.

Sorting / grouping:
- Default (no search): sort **active first, then inactive**; within each group
  sort by **like-count desc**.
- While searching: grouping **disappears** — a flat search-results list of
  matching artists, same chip style + toggle. Search unifies "add" and
  "activate": toggling a result on adds+enables it; an already-added result shows
  its current state.

Chip:
- Enabled = solid; disabled = dimmed.
- Click body = toggle enable/disable.
- ✕ = remove (with Undo toast).

## Overflow dialog

- Inline chips are capped (~N visible); beyond that show `+75 more`.
- `+75 more` opens a dialog listing the full set with:
  - search-within,
  - per-artist toggle + remove,
  - same active-then-inactive / like-count sorting and search-collapses-grouping
    behavior as the panel.
- The dialog manages toggles (non-destructive) primarily; remove still uses Undo.

## Build slices

1. **Engine: split filter semantics** — extend `DraftConfig`, the preview
   server-fn schema, and `PreviewPlaylistDraftInput` with
   `manualPinnedSongIds` while retaining ordered effective `pinnedSongIds`.
   In `runPreviewPlaylistDraft`, build the profile and `totalEligible` from the
   normally filter-eligible candidates; then union in still-liked Phase-1
   manual-pin candidates only for ranking/composition. Exclusion still wins in
   `composePlaylistPreview`. Unit-test that an out-of-filter manual pin is kept
   and scored, does not affect the profile population or `totalEligible`, and
   is still dropped when excluded/unliked. Artist pins stay filter-subject via
   filter-aware resolution (slice 4). The preview header must stop rendering
   “tracklist length of totalEligible eligible”; show the selected count and
   filter-eligible count as separate facts so a valid manual exception cannot
   produce “11 of 10 eligible.”
2. **Tracklist eyebrows** — "Your picks · N" over the pinned block + a label
   over the engine fill in `PreviewList` (uppercase section-label idiom).
   Copy per brand docs.
3. **Draft model + balanced allocation** — `artistSelections` state, actions,
   allocation (even split + redistribution + interleave), derived-union pins
   computed at query-key time. Allocator is a pure module in
   `src/lib/domains/playlists/`; unit-test it. Allocation keys off the
   DEBOUNCED `maxSongs`/filters, not live values.
4. **Server query** — "search my liked artists" + per-artist song resolution,
   filter-aware (takes current match filters, returns eligible ids;
   re-resolve on filter change). Replace the fire-and-forget `pinArtist`
   wiring with a chip-level pending state.
5. **`ArtistConfig` panel** — search input, chips, sorting, toggle, remove+undo;
   wire into `CreatePlaylistScreen` sidebar and `handleSeed`.
6. **Seed card `+`** — add-artist affordance + jump-to-studio-with-artist-#1.
7. **Overflow dialog** — capped chips + `+N more` + full-set management.

## Open questions / to nail down during build

None — everything below is resolved.

## Resolved (by the 2026-07-13 engine rewrite + review)

- **Per-artist ordering signal:** recency. `getLikedSongIdsByArtist` already
  returns most-recently-liked first (the RPC's order), and allocation runs
  client-side while match scores only exist server-side after ranking — so
  recency-N is the ordering by construction, not a choice to make.
- **Single-artist seed vs `maxSongs`:** moot. The clamp is engine-side and
  applies to all pins; a single-artist seed pinning more than `maxSongs` gets
  clamped and the cut ids reported in `droppedPinnedSongIds`.
- **Slot budget:** artists may fill everything. Budget =
  `maxSongs − manualPinnedCount`, split evenly among enabled artists; ranked
  fill appears only when artists can't fill their quota.
- **Pin model:** derived union with explicit provenance.
  `artistSelections` and manual pins stay separate state; effective ordered
  `pinnedSongIds` = dedupe(allocate(enabled artists) + manual pins), computed
  at query-key time and never stored merged. The request also carries
  `manualPinnedSongIds` unchanged as the filter-exempt subset. The server must
  not infer provenance from the union. Toggling/removing an artist can't touch
  manual pins by construction.
- **Commit persistence:** pins only for v1. `artistSelections` is ephemeral
  draft state; persist it later when a consumer (re-runs, managed playlists)
  exists.
- **Filter semantics + dropped-pins UI:** split semantics + section eyebrows
  (see Decisions locked). No dropped-pins note.
