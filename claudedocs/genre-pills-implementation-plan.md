# Genre Pills — Implementation Plan

**Date:** 2026-06-11
**Status:** Phase 1 (backend/matching/ML) **implemented 2026-06-11** — execution record + deviation logs in `claudedocs/genre-pills-phase1/`. The §1.2 similarity table was built as planned, failed post-implementation review, and was replaced the same day by the curated **genresgraph** repo (see the correction in §1.2). Phase 2 (UI) not started — read **"Phase 2 revisions"** below before implementing. Implements roadmap item #5 (+ the genre-substring half of #7) from `docs/architecture/matching-system-roadmap.md`.
**Estimate:** Phase 1 ~1.5–2 days, Phase 2 ~1–1.5 days.

## Product decisions (confirmed with Fábio, 2026-06-11)

1. **Strong steer.** When pills are set, genre becomes the largest fusion weight (~0.40, up from 0.20). The description carries vibe/mood/situation; pills declare "this playlist is mostly about these genres." Adjacent genres (R&B next to hip-hop) get partial credit; distant genres (metal vs hip-hop) sink to the bottom. Still a ranking, never a gate — protects against noisy/missing Last.fm tags.
2. **Quick-picks come from the user's own library** — top genres across their liked songs' enrichment data, static fallback while the library is still syncing. Every suggestion is guaranteed actionable.
3. **Persistent, not decaying.** Pills hold a fixed share of the genre signal regardless of song count, until the user edits/removes them. This deviates from the roadmap's original "pseudo-counts decaying like `computeIntentWeight`" design — pills are a standing declaration (Deezer Flow Tuner precedent: declared genres steer in real time and only stop when toggled off).

## Research deltas vs the roadmap draft

- **Don't naively embed bare genre names** for the similarity table. Short labels collapse on homonyms ("house" → buildings; MWE, arXiv 2404.13569 measured cosine ~0.196 for house/club on general-purpose embeddings vs 0.529 domain-adapted). ~~**Primary source: the frozen Every Noise at Once snapshot** (2D genre coordinates, MIT-licensed copies on Kaggle `nikitricky/every-noise-at-once` and GitHub `AyrtonB/EveryNoise-Watch`); Euclidean proximity in that space is Spotify's own genre topology.~~ **The EveryNoise premise failed in practice — see the §1.2 correction.** Fallback for unmatched names: embed with a `"music genre: {name}"` prefix using the existing Qwen3 provider.
- **Missing genre tags must be neutral, not zero.** With genre at weight 0.40, a song whose Last.fm lookup failed would be systematically buried if "no tags" scores 0. Imputation literature (arXiv 1805.00121) and noisy-tag studies (arXiv 1706.02361: 6–64% label error depending on tag) both say treat absence as no-information. Songs without genres should have the genre signal marked *unavailable* so `computeAdaptiveWeights` redistributes — same mechanism as missing audio.
- **Production soft-boost consensus** (Qdrant formula rescoring, Algolia optionalFilters, Elastic function_score): boost, never filter; declared-category boosts land in the +0.25–0.35 additive / ×1.3–2.0 multiplicative range — our 2× weight bump (0.20 → 0.40) inside z-normalized fusion is in family.
- **UX consensus** (eBay MIND chips-combobox, Material 3, React Aria, Tripaneer A/B): always-visible search input + suggestion chips beats a hidden "+more" affordance on desktop; keep the dropdown open during multi-select; never disable chips at the cap; visible × on every selected chip plus Backspace-removes-last.

---

## How it works end to end (target state)

A playlist row gains `genre_pills` (≤5 canonical whitelist genres, app-local — Spotify has no genre field). Pills feed matching through four channels:

1. **Intent text** — the embedded/reranked query becomes `"{name} — {description}. Genres: hip-hop, pop"`. Pills alone (no description) are enough to make intent live, including enabling the HyDE path.
2. **Genre distribution** — when pills are set, the profile's distribution is a fixed blend: pills hold `PILL_SHARE = 0.5` of the mass (split equally), real members' genres share the rest proportionally. Empty playlist → pills are 100% and replace the HyDE `expected_genres` guess. Persistent: the share does not decay with song count.
3. **Fusion weight** — pills present → weights switch from `{embedding 0.50, audio 0.30, genre 0.20}` to `{embedding 0.35, audio 0.25, genre 0.40}` for that playlist (provisional values; replay-tunable).
4. **HyDE prompt** — declared genres are passed to the cold-start prompt so the imagined prototype song is on-genre.

Genre scoring itself is rebuilt: canonical exact match (1.0) + similarity-table expansion (adjacent genres at their table similarity, capped at `ADJACENT_MAX = 0.6`; below `ADJACENT_FLOOR = 0.3` counts as 0). This replaces the buggy bidirectional substring matching for *all* playlists, pills or not — closing roadmap #7's genre item. As shipped, the expansion table is **directed** — `table[playlistGenre][songGenre]`, so a hard-rock song in a rock playlist (0.6) scores higher than a rock song in a hard-rock playlist (0.45) — see the §1.2 correction for the table's actual source.

"Happy hip-hop songs" worked example: the description/intent embedding finds *happy*; the genre channel at 0.40 enforces *hip-hop*; an R&B track gets ~0.5–0.6 genre credit via adjacency; a metal track gets ~0 and, post z-score, a heavy fused-score deficit no embedding similarity realistically overcomes.

---

## Phase 1 — Backend / matching / ML (~1.5–2 days)

### 1.1 Storage + validation

- Migration `supabase/migrations/<ts>_playlist_genre_pills.sql`: `ALTER TABLE playlist ADD COLUMN genre_pills TEXT[] NOT NULL DEFAULT '{}';` plus a `CHECK (cardinality(genre_pills) <= 5)`.
- `src/lib/integrations/lastfm/whitelist.ts`: export the genre list (`export const GENRE_LIST: readonly string[]` — today only `isGenre`/`canonicalizeGenre` are exported; the Set at line 8 is private). Pure data, safe for client import (verified: no server-only deps).
- New `sanitizeGenrePills(input: string[]): string[]` (canonicalize → `isGenre` filter → dedupe → slice 5). Used by the server fn and anywhere pills enter the pipeline.

### 1.2 Genre similarity table (one-off build, checked-in artifact)

- `scripts/genre-similarity/build.ts`: download/ingest the EveryNoise snapshot CSV → name-match against the ~430-entry whitelist (lowercase + `canonicalizeGenre`; report unmatched) → `sim(A,B) = exp(-dist(A,B)/scale)` with `scale` = 25th percentile of pairwise whitelist distances → keep per-genre neighbors with sim ≥ 0.3, cap ~10 neighbors → emit sparse JSON artifact.
- Unmatched whitelist genres: fall back to Qwen3 `embedBatch` with `"music genre: {name}"` prefix (`role: "passage"`, auto-chunks at 96 — `src/lib/integrations/deepinfra/service.ts:43`), same exp-decay similarity, flagged in the artifact for eyeballing.
- Artifact lives at `src/lib/domains/taste/genre-similarity/table.json` + a thin loader module (no barrel exports). Test: every whitelist genre has an entry; spot-check pairs (hip-hop↔r&b high, hip-hop↔black metal ~0; "rock"↔"post-rock" partial *not* full credit).

> **Correction (2026-06-11, post-implementation review):** the EveryNoise build above shipped and was then proven wrong — its three spot-check pairs passed by luck, but ENAO 2D proximity encodes *sonic texture*, not genre relatedness: rock↔hard rock / pop↔indie pop / metal↔heavy metal all scored **0** (crowded out of the top-10 cap) while rock↔martial industrial / hip-hop↔latin / pop↔chiptune scored **0.6 credit**. The table is now compiled from the hand-curated typed genre graph at `/Users/f/Core/dev/clones/genresgraph-mit` (standalone MIT repo): curators author relations (`subgenres` / `related` / `fusion_of` / `isolated`), the compiler resolves them to a **directed** table — parent→child 0.6, child→parent & siblings 0.45, related/fusion 0.5, two-hop ×0.75, floor 0.3 — and `bun run compile && bun scripts/sync.ts --confirm` (in that repo) copies the artifact into hearted. The loader contract is unchanged. Guard rails added in hearted: a golden-pairs gate in `loader.test.ts` (~15 must-be-adjacent + 11 must-be-zero pairs, so a bad sync can't land) and `GENRE_TABLE_VERSION` wired into the model-bundle hash (every sync auto-invalidates profiles + snapshots; `MATCHING_ALGO_VERSION` bumped v3→v4). `scripts/genre-similarity/` (build script + CSV) was removed.

### 1.3 Genre scoring rewrite (`song-matching/service.ts:376-413`)

Replace `computeGenreScore`'s bidirectional substring loop:

- Per playlist genre `g` (mass `w_g`): credit = max over song genres `s` of `sim(g, s)` where `sim(g,g) = 1`, table neighbors ∈ [0.3, 0.6], else 0. Score = Σ `w_g`·credit / Σ `w_g` (unchanged ratio shape, so z-score fusion and the legacy fallback path are untouched).
- **Neutral missing tags:** `songGenres` empty → genre signal *unavailable* (feeds the existing availability → `computeAdaptiveWeights` redistribution at `config.ts:66-104`), not score 0. Verify current semantics first — if empty-genres already maps to unavailable, this is a no-op; if it maps to available-0, fix it here.

### 1.4 Profiling changes (`playlist-profiling/`)

- **Distribution blend** in `calculations.ts`: normalize observed counts to fractions; pills present → `0.5·declared + 0.5·observed` (declared split equally); no members → declared only; no pills → observed only (behavior unchanged). Storing fractions instead of raw counts also clears the "raw counts footgun" code finding — `computeGenreScore` only consumes ratios, so this is transparent to matching.
- **Intent text** (`service.ts:98-99`): keep `"{name} — {description}"` construction, then append `". Genres: {pills.join(", ")}"` when pills exist. One shared builder so the embedding query and the reranker query stay identical. `hasDescription` for `computeIntentWeight` stays keyed on the actual description — pills must not fake the ×1.5 boost.
- **HyDE path** (`service.ts:162`, `intent-expansion.ts`): condition already requires `intentText`, which pills now satisfy alone. Pass pills into the cold-start prompt ("the user declared genres: …"); when pills exist they replace `expected_genres` as the distribution seed (`service.ts:183-185`); the LLM's guess is only used pill-less.
- **Content hash** (`hashing.ts:72-114`): add `genrePills` (sorted) as an explicit input, bump `PLAYLIST_PROFILE_VERSION` 3 → 4. The blend + intent suffix would mostly invalidate anyway, but explicit-and-versioned is the contract.

### 1.5 Matching config + per-playlist weight switch

- `config.ts`: add `weightsWithDeclaredGenres: {embedding: 0.35, audio: 0.25, genre: 0.40}` (provisional). Matcher selects base weights per playlist by pills presence, *then* runs `computeAdaptiveWeights` as today. Z-score stats are per-signal across the batch matrix and weights apply after normalization, so per-playlist weight selection doesn't corrupt the stats.
- Thread pills onto whatever the matcher already loads per playlist (profile load in `profiles.ts` or the playlist row join) — smallest-diff option wins at implementation time.

### 1.6 Save path (server fn)

- `savePlaylistGenrePills` (`createServerFn`, POST) in `playlists.functions.ts`: ownership check → `sanitizeGenrePills` → update row. Pills are app-local, so unlike description saves there is **no extension/Spotify leg**.
- Profile invalidation: fire the same reconciler signal as metadata changes (`reconciler.ts:159-166` advances `matchSnapshotRefresh` on `targetMetadataChanged`) so the next snapshot refresh recomputes the profile (hash misses on the new pills). Note the onboarding description dialog currently has *no* immediate-invalidation path — the pills server fn must trigger it itself, not rely on session flush.

### 1.7 Tests + regression verification

- Unit: sanitization, similarity-table coverage, new `computeGenreScore` (exact/adjacent/distant/missing-tags-neutral), distribution blend (0 songs, N songs, no pills), intent-suffix formatting, hash v4 invalidation, weight switching.
- Replay runner regression (`scripts/matching-lab/replay/index.ts --a configs/prod.json --b configs/genre-adjacency.json`): historical decisions have no pills, so this can't measure the pills themselves — but it regression-tests the substring→adjacency scoring change and gives a directional read on the weight set against the existing decision log (n=10, directional-only, as the runner already warns).
- `bun run test` + `tsgo` clean.

---

## Phase 2 — UI (~1–1.5 days)

### Phase 2 revisions (post-Phase 1, 2026-06-11)

Phase 1 landed with deviations that change four Phase 2 details; everything else in this section stands.

1. **Dedupe the picker list.** `GENRE_LIST` exports ~430 raw entries *including variant duplicates* ("hip hop" & "hip-hop", "r&b" & "rnb"). Chips must render the ~370 canonical forms (dedupe via `canonicalizeGenre`), but keep the variants as **search aliases** so typing "r&b" still finds the chip (its canonical form is `rnb`).
2. **Display labels are a small open decision.** Canonical forms are sometimes the unpretty variant (`rnb`, `synthpop`). Either render them as-is or add a tiny canonical→display map in the picker; storage stays canonical either way.
3. **Adopt the server's response as saved state.** `savePlaylistGenrePills` exists (input `{ playlistId, genres: string[] }`), sanitizes (canonicalize → whitelist filter → dedupe → cap 5) and returns `{ success, pills }` — the UI should set its chips from the returned `pills`, since sanitization may rewrite what the user picked. Server-side profile/snapshot invalidation already fires *inside* the fn — the UI only does the `queryClient.invalidateQueries` leg from §2.3.
4. **Quick-picks need the same canonicalization.** The §2.1 SQL aggregates raw enrichment tags — canonicalize + dedupe client-side before excluding already-selected pills. Newly possible (optional): `genreNeighbors()` from `genre-similarity/loader.ts` can suggest genres adjacent to already-picked pills — the curated graph doubles as a suggestion source.

Stack reality (from the codebase sweep): Tailwind 4 with `--t-*` tokens, **no** Radix/shadcn/react-hook-form/useMutation — hand-rolled portals, controlled state, direct `createServerFn` calls, `queryClient.invalidateQueries`, sonner toasts. The picker is built from scratch following that idiom.

### 2.1 Quick-picks data

- `getAccountTopGenres` server fn: `SELECT unnest(s.genres) g, count(*) FROM liked_song ls JOIN song s ON ls.song_id = s.id WHERE ls.account_id = $1 GROUP BY 1 ORDER BY 2 DESC LIMIT 12` (no existing RPC does this; `get_liked_songs_page` only returns per-row genres). Static fallback list of ~10 broad genres while the library is empty/syncing. Exclude already-selected pills client-side.

### 2.2 `GenrePillsPicker` component (the chips-combobox)

Spec synthesized from eBay MIND / Material 3 / React Aria / Baymard / Tripaneer findings:

- **Selected chips row** (0–5): visible × per chip; Backspace in an empty input removes the last chip. Crib the Tailwind pill style from the onboarding example chips (`OnboardingDescriptionDialog.tsx:285` — `rounded-full border px-3 py-2 text-xs theme-border-color theme-text-muted …`), selected state using `--t-primary` like the inline-styled `GenrePill` accent treatment (`SongDetailPanelSurface.tsx:901-935`).
- **Always-visible search input** (not hidden behind a "+ more" pill — desktop-first, removes a click, clearest ARIA). Client-side filtering over the imported `GENRE_LIST`: ranked exact-prefix > word-boundary > substring (~30 lines, no dependency; 430 static entries don't need fuzzy — add uFuzzy later only if typo-tolerance proves wanted).
- **Suggestion pills** (6–8 quick-picks from 2.1) under the input; clicking adds without opening the dropdown.
- **Dropdown listbox**: opens on typing; stays open across picks (multi-select); ≤ ~12 visible with scroll; matched substring highlighted.
- **Cap UX**: persistent "N/5" helper counter; at cap nothing is disabled — clicking a 6th shows inline "Maximum 5 genres — remove one to add another."
- **A11y** (ARIA per APG + eBay MIND): input `role="combobox"` `aria-expanded` `aria-controls` `aria-autocomplete="list"` `aria-activedescendant` (DOM focus never leaves the input); list `role="listbox"` `aria-multiselectable="true"`, options `aria-selected`; `aria-live="polite"` region announcing add/remove/count. Keyboard: ↓ opens, ↑/↓ move active descendant, Enter toggles, Esc closes, Tab closes + moves on.
- Always optional — no minimum, no gating, skip affordance untouched on onboarding (Deezer's forced-15 is the canonical anti-pattern).

### 2.3 Surfaces

- **OnboardingDescriptionDialog** (`src/features/onboarding/components/OnboardingDescriptionDialog.tsx`): add the picker below the description textarea. Saves are independent legs: description → extension bridge (existing `prepare`/`commitPlaylistDescriptionSave`), pills → `savePlaylistGenrePills`. Pills save even when the description is skipped. Mind the dialog's fixed `grid-cols-[220px_1fr]` / `max-w-[700px]` layout.
- **PlaylistDetailView / PlaylistDescription** (`src/features/playlists/components/`): read-only pill display next to the description (reuse the pill style), picker in the existing edit mode. On save: `savePlaylistGenrePills` → `queryClient.invalidateQueries({queryKey: playlistKeys.management(accountId)})` (the established pattern at `PlaylistDetailView.tsx:110-126`) + the server-side profile invalidation from 1.6.
- Error/toast conventions: inline failure state for the save (like description's `editState`), `toast.success` on save, sonner imports.

### 2.4 Polish pass

Run the `web-interface-guidelines` / `rams` review on both surfaces; verify keyboard-only and VoiceOver flows; check the onboarding dialog on narrow widths (it already overflows <~500px — don't make it worse).

---

## Provisional constants (replay-tunable, revisit post-prod with the full harness)

| Constant | Value | Basis |
|---|---|---|
| `weightsWithDeclaredGenres` | embedding 0.35 / audio 0.25 / genre 0.40 | "strong steer" decision; in-family with production boost magnitudes |
| `PILL_SHARE` (distribution blend) | 0.5 | persistent-declaration decision; no published calibration — instrument it |
| `ADJACENT_MAX` / `ADJACENT_FLOOR` | 0.6 / 0.3 | roadmap 0.5–0.6× discount; now align with the genresgraph compiler's edge weights (subgenre 0.6 = cap, floor 0.3) — the cap stays in hearted as a safety net |
| ~~Similarity `scale`~~ | ~~p25 of pairwise whitelist distances~~ | obsolete — exp-decay similarity replaced by typed edge weights (see §1.2 correction) |
| Pill cap | 5 | Baymard/paradox-of-choice; DB CHECK + sanitize + UI counter |

## Risks / open items

1. ~~**EveryNoise name coverage** of our whitelist is unverified — the build script must report match rate; the embedding fallback covers gaps but is lower-trust (run it with the `"music genre:"` prefix only).~~ **Resolved 2026-06-11:** superseded by genresgraph — 370/370 canonical coverage by construction (4 genres explicitly `isolated`), enforced by its compiler and hearted's golden-pairs gate.
2. **Pills vs content drift**: persistent + strong steer means pills win over what's actually in the playlist. Accepted by design (user controls and sees the pills); revisit only if real usage shows confusion.
3. **No measurement yet**: all constants are evidence-informed guesses until decision volume unlocks the full harness (roadmap post-prod #1). The replay runner only regression-tests the no-pills scoring change.
4. **`genre_distribution` representation change** (counts → fractions) invalidates all profile hashes → one-time full reprofile on deploy (cheap at current scale, 1 profile).

## Key sources (beyond the roadmap's)

EveryNoise frozen snapshot (Kaggle nikitricky, GitHub AyrtonB/EveryNoise-Watch) · MWE arXiv 2404.13569 (short-label homonym collapse) · Deezer Text2Playlist arXiv 2501.05894 + Flow Tuner (Feb 2026, declared-genre steering) · Qdrant decay/rescoring blog, Algolia optionalFilters, Elastic function_score (soft-boost magnitudes) · arXiv 1805.00121 (missing = neutral), arXiv 1706.02361 / 2008.06273 (Last.fm tag noise) · eBay MIND chips-combobox, React Aria ComboBox+TagGroup, W3C APG combobox, Material 3 chips, Tripaneer multi-select A/B (grouped list +33% faster), Smashing/UXMovement (never disable at cap).
