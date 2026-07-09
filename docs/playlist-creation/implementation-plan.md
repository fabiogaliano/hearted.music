# Playlist Creation — Implementation Plan & Task Breakdown

> Read `conceptualization.md` first for the product decisions. This doc is the build
> blueprint and the source of truth for every implementation/review sub-agent.

## 0. Conventions every sub-agent MUST follow

- **No nested sub-agents.** Do NOT use the Agent/Task tool or spawn sub-agents. Do all work
  yourself. (Hard constraint — usage control.)
- **Package manager:** `bun` for everything. Tests run with `bun run test` (Vitest). Tests go
  in `tests/` or `__tests__/`. **Never skip/disable tests** — fix root causes.
- **No barrel exports.** Import from concrete module paths.
- **Comments explain WHY only.** No section dividers, no restate-the-code, no JSX labels.
- **Read before edit.** Absolute paths. Match surrounding code style.
- **Reuse over reinvent.** Prefer existing services/components/types (see §2). New code is a
  thin layer.
- **Design:** use `cn()` from `@/lib/utils`; `sonner` `toast()` for toasts; **lucide** icons;
  theme utility classes (`.theme-*`), the two fonts via `style={{ fontFamily }}`, house easings
  from `src/styles.css`. Honor `prefers-reduced-motion`. Flat/bordered materiality, no Radix/cva,
  no `transition: all`, no `hover:scale` on rows/cards. Follow these on disk:
  - `.claude/skills/hearted-design/SKILL.md`
  - `.claude/skills/make-interfaces-feel-better/SKILL.md`
  - `.claude/skills/ui-prototyping/SKILL.md` (Ladle workflow)
  - `/Users/f/.claude/skills/archive/web-interface-guidelines/SKILL.md`
  - `/Users/f/.claude/skills/archive/design-principles/skill.md`
  - `/Users/f/.claude/skills/archive/web-animation-design/SKILL.md`
- **TanStack Start/Router + React:** follow the `tanstack-start-react` and
  `react-best-practices` skills (server functions via `createServerFn`, typed loaders, query
  options factories, no unnecessary re-renders).
- **Before returning:** run `bun run typecheck` (and `bun run test` for logic tasks). Report
  exact files touched and how to verify.

## 1. Codebase ground truth (verify signatures before coding)

**Routes:** `src/routes/_authenticated/playlists.tsx` (list shell),
`src/routes/_authenticated/playlists.$playlistRef.tsx` (detail). New route lives alongside as
`src/routes/_authenticated/playlists.new.tsx` (TanStack file route `/playlists/new`).

**Matching / profiling (reuse):**
- `src/lib/domains/taste/playlist-profiling/` — `PlaylistProfilingService.computeProfile(...)`,
  `calculations.ts` (`buildIntentText`, `computeIntentWeight`, `blendGenreDistribution`,
  `blendEmbeddings`), `intent-expansion.ts` (`expandPlaylistIntent` HyDE).
- `src/lib/domains/taste/match-filters/` — `types.ts` (`PlaylistMatchFiltersV1`), `schemas.ts`
  (`parseSaveMatchFilters`, `parseStoredMatchFilters`), `normalizers.ts`
  (`normalizeMatchFilters`, `hasActiveMatchFilters`), `predicates.ts` (`passesAllMatchFilters`).
- Matching service: `src/lib/domains/taste/.../service.ts` (`matchBatch`, `scoreGenres`,
  scoring weights). **A new no-embedding scoring mode is added here in T2.**
- `src/lib/server/playlists.functions.ts` — `getPlaylistMatchFilterOptions`,
  `getAccountTopGenres`, `savePlaylistMatchConfig`, `acknowledgePlaylistCreate`,
  `upsertPlaylists`.
- `src/lib/server/matching.functions.ts` — `getSongSuggestions`, `addSongToPlaylist`.

**Entitlement / billing (reuse):**
- `src/lib/domains/billing/state.ts` — `hasUnlimitedAccess(state)`, `BillingState`.
- `src/lib/server/billing.functions.ts` — `getBillingState()`.
- SQL predicate `is_account_song_entitled`; `account_song_unlock` table (count non-revoked for
  the ≥1000 rule).

**Extension / Spotify (reuse):**
- `src/lib/extension/SpotifyReconnectLink.tsx`, `useSpotifyReconnectState.ts`,
  `spotify-action-outcome.ts` (`outcomeFromCommandResponse`, `outcomeFromAcknowledgedResult`).
- `src/lib/extension/spotify-client.ts` — `createPlaylist(name, userId)`, `addToPlaylist(...)`.
- `src/lib/extension/playlist-write-acknowledgement.ts` — `createPlaylistAcknowledged(...)`.
- `src/lib/extension/detect.ts` — `isExtensionInstalled`, `getSpotifyConnectionStatus`,
  `getExtensionStatus`. Confirm whether a batch add-tracks command exists; if not, add one or
  loop with care.

**Enrichment (T1 target):**
- The selection RPC `select_liked_song_ids_needing_enrichment_work` and the enrichment
  workflow/orchestrator gate Phase-1 by entitlement. Split so Phase-1 (audio/genre/language/
  gender) is selected for ALL liked songs; keep analysis + embeddings entitlement-gated.

**Design primitives:** `src/components/ui/Button.tsx`, design tokens in `src/styles.css`,
themes in `src/lib/theme/`, fonts in `src/lib/theme/fonts.ts` (or wherever `fonts` is defined).

**Ladle:** `.ladle/config.mjs` (storyOrder), `.ladle/components.tsx` (global providers),
`ladle-vite.config.ts` (server-function stub aliases → `src/__mocks__/`).

## 2. Architecture — the draft-orchestration layer

Everything new is **ephemeral/stateless** until the user commits.

### Preview engine (T2) — `previewPlaylistDraft` server function
Input: `{ intent?: string, genrePills: string[], matchFilters: PlaylistMatchFiltersV1,
maxSongs: number, pinnedSongIds: string[], excludedSongIds: string[] }`.
Steps:
1. Resolve candidate set = the account's liked songs that have **Phase-1 enrichment**
   (genres/audio present). Reuse the entitled/enriched loader, relaxed to Phase-1.
2. Apply `passesAllMatchFilters` → eligible set.
3. Compute **intent eligibility** server-side (`hasUnlimitedAccess || unlockedCount >= 1000`).
   If ineligible, **ignore** any `intent` (defense in depth).
4. Build a transient profile:
   - eligible + intent → profiling service with intent (embedding path, premium).
   - else → genre distribution (`blendGenreDistribution` from pills) + audio centroid from
     eligible songs; **no embedding**.
5. Score eligible candidates via matching service. **No-embedding mode**: when there is no
   query embedding, redistribute the embedding weight onto genre + audio (document the exact
   weights). Pinned songs always rank first; excluded songs are dropped.
6. Return `{ preview: SongVM[] (≤ maxSongs), suggestions: SongVM[] (next N, e.g. 12),
   totalEligible: number, intentApplied: boolean }`.

Pure scoring/eligibility logic lives in `src/lib/domains/...` with unit tests; the server
function is a thin wrapper.

### Creation (T3) — commit the draft
Client orchestrator on "Create playlist":
1. Ensure extension reachable + Spotify connected (else reconnect/install affordance).
2. Resolve Spotify `userId` (cache from sync server-side, or extension command).
3. `createPlaylistAcknowledged(name, userId)` → new playlist `{ uri }` + DB row.
4. Batch-add the previewed track URIs to the playlist (batch command or careful loop).
5. Persist config onto the new row (`match_intent` only if eligible, `genre_pills`,
   `match_filters`) so it becomes a managed playlist; record `match_decision` `added` rows so
   those songs don't re-surface as suggestions.
6. Map any `reconnect-required` / `extension-unavailable` outcome to the right UI state;
   preserve the draft on failure.

## 3. Task breakdown (each task = build agent → review/fix agent → orchestrator commits)

- **T1 — Ungate Phase-1 enrichment + on-demand backfill.** Migration + workflow split so
  audio/genre/language/gender enrich for all users; analysis + embeddings stay gated. Lazy
  trigger when entering the feature. Tests. *Reviewer must confirm AI phases stay gated and
  cost surfaces are bounded.*
- **T2 — Preview engine.** `previewPlaylistDraft` + no-embedding scoring mode + intent
  eligibility helper (`getUnlockedSongCount` / predicate) + `SongVM` types + fixtures. Tests.
- **T3 — Spotify creation wiring.** `userId` resolution + commit orchestrator + batch add +
  persist config + `match_decision` writes + outcome→UI mapping. Tests (mock extension).
- **T4 — Route shell + entry + view-models + MaxSongsSlider.** `/playlists/new` route + loader
  (on-demand backfill + initial preview query) + "Create playlist" entry button on the
  playlists page + types/fixtures + `MaxSongsSlider` primitive (native range, `cn()`,
  `tabular-nums`, full keyboard a11y) + entry-level reconnect/install gate.
- **T5 — Config surface.** Reuse `MatchFiltersFieldList` + `GenrePillsPicker` + an intent
  editor (WritingSurface-style) with the **premium locked teaser**. Wire to a debounced live
  preview query.
- **T6 — Preview list + suggestions tray.** Removable preview rows (enter/exit anims, live
  count + duration, `sonner` undo), suggestions tray (add, soft-refresh on config change,
  optimistic UI), distinct visual treatment for suggestions vs. picks, reduced-motion.
- **T7 — Create flow + states.** Create CTA + reconnect button at the create touchpoint +
  success state + empty / warming-up / not-enough-songs / disconnected states.
- **T8 — Flattened Ladle story.** One story file per the user's **flattened** instruction:
  single `default.title` group, **every** new UI piece as a named export (atoms +
  composables), composables seeded with **rich, prod-like fixtures** so the reviewer feels the
  real thing. No bare "Default". Wire any new server-fn stubs in `ladle-vite.config.ts`.
- **T9 — Integration + verification.** `bun run typecheck`, `bun run test`, `bun run
  ladle:build`, a11y sweep, fix fallout. Then push branch + open PR for the CI bots.

## 4. Ladle story spec (T8)

- Title group: `Playlist Creation` (flat). Each export is a real, named piece, e.g.:
  `MaxSongsSlider`, `IntentEditorFree` (locked teaser), `IntentEditorPremium`,
  `GenreAndFilterConfig`, `PreviewSongRow`, `PreviewList`, `SuggestionRow`, `SuggestionsTray`,
  `CreateBar`, `WarmingUpState`, `NotEnoughSongsState`, `DisconnectedState`, and a full
  `CreatePlaylistScreen` composable wired with fixtures (config + preview + suggestions
  together, in a believable state). Provide controls (args) where it adds insight (e.g. slider
  value, premium on/off, song count). Prefer one story per component with controls over many
  near-duplicate exports.

## 5. Verification & exit

Definition of done for the night: branch has incremental commits per task, `typecheck` +
`test` + `ladle:build` green (or failures clearly documented), Ladle story covers every new
piece, and a PR is open so the CI bots can review. The live extension→Spotify create path is
implemented and wired but verified by the human in the morning.
