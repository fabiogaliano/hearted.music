# Playlist Creation — UX Improvements Plan (round 2)

> Run with `/orchestrate docs/playlist-creation/ux-improvements-plan.md`.
> Context: `conceptualization.md` + `implementation-plan.md` in this directory describe the
> shipped feature. This plan layers four agreed UX improvements on top. Branch:
> `feat/playlist-creation-from-liked-songs` (stay on it; commit per task, never push).

## 0. Conventions every sub-agent MUST follow

- **No nested sub-agents.** Do all work yourself.
- **bun** for everything; tests via `bun run test` (Vitest); typecheck via `bun run typecheck`.
  Tests in `__tests__/`. Never skip/disable tests — fix root causes.
- **No barrel exports.** Comments explain WHY only. Read before edit; absolute paths.
- **Design:** `cn()` from `@/lib/utils`, sonner toasts, existing theme utility classes
  (`.theme-*`), fonts via `style={{ fontFamily: fonts.* }}`, house easings from
  `src/styles.css`, `prefers-reduced-motion` honored (framer-motion `useReducedMotion`),
  flat/bordered materiality, no `transition: all`, no `hover:scale` on rows. Follow the
  `hearted-design` and `make-interfaces-feel-better` skills on disk
  (`.claude/skills/…/SKILL.md`), and `ui-prototyping` for the Ladle task.
- **Match the existing feature's a11y bar:** 40px+ touch targets, `aria-live` where counts
  change, sr-only labels, keyboard operability. The current code in
  `src/features/playlists/create/` is the reference — read neighboring components first.
- **Before returning:** `bun run typecheck` + `bun run test` (and `bun run ladle:build` for
  any task touching stories). Report exact files touched.

## 1. Ground truth (verify before coding)

- **Draft state:** `src/features/playlists/create/useCreatePlaylistDraft.ts` — owns
  `selection` (`pinnedSongIds`, `excludedSongIds`); selection changes bypass the 600ms
  config debounce and refetch immediately. Exposes handlers consumed by
  `CreatePlaylistScreen.tsx`. Exclusion already survives config re-runs server-side
  (`previewPlaylistDraft` drops excluded ids in `assembleDraft`,
  `src/lib/domains/playlists/draft-engine.ts:273-327`).
- **Suggestions:** `src/features/playlists/create/suggestions/SuggestionRow.tsx` (add-only,
  `onAdd(id)`), `SuggestionsTray.tsx` (soft-refresh fade keyed on a joined-ids fingerprint,
  `MAX_VISIBLE = 10`).
- **Rows:** `src/features/playlists/create/preview/PreviewSongRow.tsx` renders artwork via
  plain img/placeholder. `SongVM` (`src/lib/domains/playlists/types.ts`) already carries
  `spotifyId` (Spotify **track** id) — no engine/server changes needed for playback.
- **Playback system (reuse, do not reinvent):** `src/features/playback/` —
  `SpotifyPlaybackCover` (cover that flips into a Spotify embed iframe; takes `playbackId`,
  `spotifyTrackId`, `isPlaybackActive`, `onActivate`/`onDeactivate`, `size`, `playLabel`),
  `useSingleActivePlayback(resetKey?)` (list-scoped "one preview at a time" coordinator),
  `SpotifyEmbedIframe`. Reference consumer: `src/features/playlists/components/TrackList.tsx`
  (`enableTrackPlayback` + optional shared `playback` prop pattern).
- **Success state:** `src/features/playlists/create/create-flow/SuccessState.tsx` — currently
  links to `https://open.spotify.com/playlist/{spotifyId}` and navigates to `/playlists`.
  Detail route is `/playlists/$playlistRef`
  (`src/routes/_authenticated/playlists.$playlistRef.tsx`; rendering lives on the parent
  `playlists.tsx`). **Verify what `$playlistRef` actually is** (Spotify playlist id vs
  internal id) by reading how the playlists list builds detail links, and pass the right
  value from the create-flow result (`src/lib/extension/create-playlist-from-draft.ts`
  returns the created playlist's identifiers).
- **Ladle:** stories in `src/features/playlists/create/PlaylistCreation.atoms.stories.tsx`
  and `PlaylistCreation.composable.stories.tsx`; fixtures in
  `src/lib/domains/playlists/fixtures.ts`; server-fn stubs aliased in
  `ladle-vite.config.ts` → `src/__mocks__/`. Run locally with `bun run ladle`.

## 2. Tasks

### U1 — Reject suggestions + refresh the tray (prod)

A tray you can only accept from forces users to scroll past songs they've already mentally
rejected, and the engine never learns.

- Add a dismiss affordance ("×") to `SuggestionRow` that excludes the song — wire it to the
  existing exclusion mechanism in `useCreatePlaylistDraft` (`excludedSongIds`). No new
  server/engine work: exclusion already refetches immediately and survives config re-runs.
  Dismissed suggestions should animate out consistently with the tray's existing motion
  language; the backfill suggestion arrives via the normal refetch.
- Visual/interaction parity with `PreviewSongRow`'s remove button (size, hit target,
  sr-only label like `Dismiss {song.name}`); keep add as the primary affordance.
- Decide with taste whether dismiss deserves an undo toast like preview-removal has; if yes,
  reuse the existing restore path (un-exclude; see the documented undo semantics in
  `useCreatePlaylistDraft.ts:50-56`).
- Add a small "Refresh suggestions" affordance on the tray header that pulls a new batch
  without changing config. Simplest honest mechanism: since the preview query returns the
  next-ranked 12 and the tray shows 10, a refresh needs the engine to rotate — check
  `SUGGESTIONS_COUNT` in `draft-engine.ts` and either (a) add a `suggestionsOffset`/seed to
  the `previewPlaylistDraft` input that skips already-shown non-dismissed suggestions, or
  (b) treat refresh as "exclude nothing, just page deeper" — pick the smallest server change
  that yields genuinely new songs, document the choice in the deviation log.
- Tests: `SuggestionRow` dismiss fires the handler; tray refresh triggers a refetch;
  dismissed id lands in `excludedSongIds` (extend
  `__tests__/SuggestionRow.test.tsx`, `SuggestionsTray.test.tsx`, `draftState.test.ts`;
  server-side paging behavior in `src/lib/domains/playlists/__tests__/draft-engine.test.ts`).

### U2 — Let users hear the songs (prod)

Biggest trust gap in the flow: users are asked to commit songs they may not recognize.

- Replace the static artwork in `PreviewSongRow` and `SuggestionRow` with
  `SpotifyPlaybackCover` (from `src/features/playback/`), passing `SongVM.spotifyId` as
  `spotifyTrackId`. Follow `TrackList.tsx` as the reference integration.
- One shared `useSingleActivePlayback` instance must span **both** the preview list and the
  suggestions tray (only one preview plays at a time across the whole screen). Lift it to
  `CreatePlaylistScreen` and pass it down, mirroring `TrackList`'s optional `playback` prop
  pattern. Use a sensible `resetKey` so playback stops when the draft result region replaces
  the lists (success/partial).
- Rows animate in/out (AnimatePresence) — make sure an actively-playing row that gets
  removed/dismissed deactivates its playback rather than orphaning audio.
- Ladle: the existing atom/composable stories for rows and the full screen must still build;
  update fixtures if the cover needs extra props. Reduced-motion and keyboard behavior come
  from `SpotifyPlaybackCover` — verify, don't rebuild.
- Tests: row renders a play affordance when `spotifyId` present; activating one row
  deactivates the other list's active row (extend `PreviewSongRow.test.tsx`,
  `SuggestionRow.test.tsx`; screen-level coordination can be a focused test in
  `__tests__/` if cheap).

### U3 — Ladle-only prototypes: "why this song" hints + starting presets (NO prod wiring)

These two ideas need visual validation before committing to them. Build them as **loose
prototypes in Ladle only**, per the `ui-prototyping` skill (diverge/converge, small named
components, rich prod-like fixtures). **Do not** touch the engine, server functions, or the
prod screen; fixtures may fake any data the real system doesn't expose yet (e.g. a
`matchReason` string on a fixture SongVM-alike).

- **Match-reason hints:** 2–3 directions for showing *why* a song is in the
  preview/suggestions — e.g. a muted inline hint under the artist line ("Indie pop · 2014"),
  a genre-pill echo that highlights the matched pill, a hover/focus-revealed detail. Show
  each direction on both a `PreviewSongRow` and a `SuggestionRow` variant, in a believable
  list context.
- **Starting presets:** 2–3 directions for one-tap starting points shown when config is
  empty — e.g. a row of preset cards above the config surface ("Recent favorites", top-genre,
  "Throwbacks: 2010s"), chips inside the intent/genre area, an empty-state takeover. Seed
  with plausible per-user data in fixtures (top genres, decades).
- New story file `src/features/playlists/create/PlaylistCreation.prototypes.stories.tsx`
  under the same flat title group, clearly named exports per direction
  (`MatchReasonInlineHint`, `MatchReasonPillEcho`, `PresetCardsRow`, …). Keep prototype
  components in a `prototypes/` subfolder so they're obviously not prod.
- Exit criterion: `bun run ladle:build` green; a short section appended to this plan's
  deviation log describing each direction and any recommendation. No prod imports from
  `prototypes/`.

### U4 — Route success into the managed-playlist loop (prod)

The created playlist persists `match_intent`/filters and keeps surfacing suggestions on its
detail page — but `SuccessState` currently dead-ends to Spotify or the list.

- Make the **primary** action in `SuccessState` navigate to the new playlist's detail page
  (`/playlists/$playlistRef`), with retention-oriented copy along the lines of "We'll keep
  suggesting songs that fit — see them here." Keep "Open in Spotify" as a secondary action;
  drop or demote the bare "back to playlists" action.
- First verify what `$playlistRef` expects (see §1) and confirm the create-flow result
  (`create-playlist-from-draft.ts` / `CreatePlaylistScreen`'s `FlowResult`) already carries
  it; thread it through if not. Consider `PartialState` too: it links to Spotify — if the
  detail page is where a user could later finish curating, a secondary detail-page link there
  is in scope; use judgment and log the decision.
- Update the SuccessState story fixtures and extend the relevant tests
  (`CreateBar.test.tsx` covers the result states; add/adjust assertions for the new primary
  action and its navigation target).

## 3. Sequencing

- **U1 and U2 both touch `SuggestionRow`** — serialize them (U1 first, it's smaller), or
  give U2's agent explicit instruction to rebase on U1's committed result.
- **U3 and U4 are independent** of each other and of U1/U2 — parallelize freely (max 3
  concurrent).
- Commit per task with Conventional Commits subjects, e.g.
  `feat(playlists): allow dismissing suggestions from the tray`,
  `feat(playlists): add in-row Spotify playback to draft preview`,
  `feat(playlists): prototype match-reason hints and starting presets in ladle`,
  `feat(playlists): route create success to the managed playlist detail`.

## 4. Verification & exit

`bun run typecheck`, `bun run test`, `bun run ladle:build` all green. Deviation log at
`claudedocs/orchestration-ux-improvements-decisions.md`. Final report lists per-task commits,
the U3 direction recommendations, and anything unresolved after the bounded patch loops.
The human validates U3 prototypes in Ladle (`bun run ladle`) before any prod adoption.
