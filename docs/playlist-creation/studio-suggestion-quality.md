# Studio suggestion quality: diagnosis + improvement plan

Date: 2026-08-01
Status: analysis complete; external research reconciled (see §Reconciliation); ranking-layer fixes decided and headed to an openspec change; first slice (event logging + confidence fix + embeddings un-gating) in implementation.

## The complaint

The studio preview serves the same songs every session, and soft steering barely moves it: on the reference account (`fabiogaliano`, 780 liked songs), toggling the "hip hop" pill kept 12 of the top 15 identical — including "O Mar que Sobra" (Vasco Vilhena), which is nowhere near hip hop.

## How a song merits its place today

Pipeline (`src/lib/domains/playlists/draft-engine.ts`, orchestrated by `src/lib/workflows/playlist-studio/preview.ts`):

1. Load all Phase-1 liked songs (`candidate-loader.ts`), apply hard match filters.
2. Build a draft profile from the **whole eligible set**: mean audio centroid + library-wide genre histogram (pills blend in at 50% share, genre weight 0.2→0.4).
3. Score each candidate = weighted fusion of z-scored signals: audio proximity to centroid, genre overlap, and (premium intent only) embedding cosine.
4. Missing signals get their weight redistributed onto present ones (`computeAdaptiveWeights`, `song-matching/config.ts`).
5. Sort descending, slice top-N. Fully deterministic.

## Root causes, with account evidence

1. **Centroid attraction.** Profile = library average, so "most average" songs win permanently. Library centroid: energy .595 / valence .513 / dance .641 / acoustic .333 / tempo 118. "O Mar que Sobra": .525 / .569 / .682 / .334 / 112 — statistically the most average liked song; it tops every list.
2. **Genreless songs are immune to genre steering.** 25/780 songs have empty `genres` (Last.fm has no tags for niche artists). Weight redistribution hands their genre weight (0.4 with pills) to audio proximity — the pill actively *helps* the genreless centroid-huggers.
3. **Pills nudge an already-pill-shaped profile.** `hip-hop` is the library's #1 tag (158×); a 50% blend barely reorders after z-normalization re-centers.
4. **Confidence is computed and ignored.** The scorer emits `confidence = availableCount/3` per song and never uses it — the ranking rewards ignorance instead of discounting it.
5. **Determinism.** Pure function of (library, config); zero variation source across sessions.

## The knowledge asymmetry underneath (data layer)

Enrichment chain: LRCLIB lyrics → LLM analysis → 512-dim embedding (pgvector, HNSW index built). Last.fm for genres; ReccoBeats for audio features.

Coverage on the reference account: 768/780 audio features, 683/780 analysis + embedding, 25 genreless, 189 missing language. Obscure/non-English songs fall out at the lyrics step and become permanently "unknowable" — and per root cause 2/4, the ranking then *rewards* that.

Two idle assets:

- **Embeddings are only consulted when a premium intent is typed** (`preview.ts` gates `songEmbeddingsMap` on `effectiveIntent`). 88% of the library has them.
- **Studio actions are discarded.** Only publish-time "added" rows reach `match_decision`; remove/dismiss/pin — explicit preference signals — die with the session.

## Decided: ranking-layer fixes (research round 1)

Pure in-memory transforms between `rankCandidates` and `composePlaylistPreview`; no IO, no schema:

1. **Seeded Gumbel-top-k sampling** over z-scores (`score/T + gumbel(seededRng)`), rank-tiered temperature: T≈0 for top 3–5 slots, T≈1 below. Target 20–40% turnover between sessions, top slots stable.
2. **Seed generated client-side once per studio session**, carried in `DraftConfig`. Per-session (not per-config) so filter tweaks only move songs whose merit changed — keeps the smooth row-diff UX calm. A "shuffle" affordance = re-roll the seed.
3. **Steck-style calibration re-rank when pills declared**: greedy pick maximizing `(1−β)·relevance − β·KL(pill dist ‖ running tracklist dist)` — pills control the *output mix*, not just scores.
4. **Missing-signal fix + artist cap**: a song-side missing signal (no genres, no embedding) contributes 0 with its weight kept — never redistributed onto whatever the song happens to have. Mode-level absence (noEmbeddingMode: nobody has an embedding because there's no query vector) still redistributes; that's a property of the scoring mode, not an evidence gap. Max 2 per artist enforced during greedy selection. (Generalized from the original "genre only, with pills" wording after research — both external runs called redistribution the single worst bug, unconditionally.)

Accepted trade-off: with sampling, the preview is no longer "the objectively top-scored N" — that's the point. Top-slot protection and modest temperature keep it curated; the ±σ framing is the tuning dial.

Sources: Kool et al. 2019 (Gumbel-top-k), Steck RecSys 2018 (calibrated recommendations), MMR (λ≈0.8), Spotify's constrained-shuffle history.

## Deeper roadmap (research round 2, reconciled), by impact-per-effort

1. **Stop rewarding ignorance (the honest Vasco fix) — ships in the first slice.** Song-side missing signals contribute a neutral 0 with weight kept; no redistribution. Both external runs rank this the single highest-return change ("immediate/very high"). A further specificity-scaled additive penalty (GPT's `−(0.10 + 0.25q)(1−coverage)`) is available as a tuning dial later; the weight-kept fix alone already buries genreless centroid-huggers under any declared preference.
2. **Log studio actions; fold in as priors later.** Append-only event log: add/pin positive, remove/dismiss negative, with session id, served position, and the config context (pills/filters/intent presence) on each row. No separate exposure log: ranking is a pure function of (library, config, seed), so once the session seed lands in `DraftConfig`, any served list is reproducible from the context already on the action row. Prior shape when volume exists: decayed Beta-Binomial counts (pin 2.0 / add 1.0 / remove 1.5 / dismiss 1.0; prior strength m≈8 around the user's own positive rate), per-meaning half-lives (~60d removals, ~120d adds, ~365d pins). Folded in as a **fixed-scale bounded additive term (cap ≈ ±0.25 fused units) — never request-z-scored**: z-scoring a sparse prior turns one negative event into a many-σ outlier (corrects round-1's "±2σ z-scored term"). Guard-rails: one removed song never lowers its artist; artist negatives need ≥3 distinct songs across ≥2 sessions; a later pin overrides a decayed negative.
3. **Use embeddings on every path; pins are per-song anchors, not an average.** Always fetch/pass `songEmbeddingsMap` (first slice un-gates the plumbing). Without a typed intent, the query signal comes from pins — scored as a **soft-max over per-pin similarities (nearest pin), never the mean of pins**: both runs independently reject averaging (a metal + ambient + soul mean points at a region containing none of them). Exact cosine scan fine at ≤1k. Per-pin heads go in the openspec ranking change with sampling/calibration, since they touch the same fusion seam.
4. **Close genre gaps with a deterministic-first ladder; LLM last.** Taxonomy corrected: not "MusicBrainz top-level" (no compact top level exists) — use the **AcousticBrainz/Bogdanov 16 top-level categories** (both runs converged on the same list) with the published Last.fm-tag→category mapping. Ladder: deterministic tag mapping → shrunk artist-genre fallback (`(count + 5·libraryPrior)/(n + 5)`, ≥3 known tracks) → LLM only for the residue, enum-constrained with a mandatory abstain option, async + cached, and treated as weak evidence (ranking only — never proof for a hard filter). Most of the 25 genreless songs should resolve before any LLM call.
5. **Taste-mode clustering, lightly and cached.** Keep k-means (not Gemini's per-request Ward — O(n²) every preview buys nothing over a cached profile). Refinements from GPT worth keeping: cluster **semantic (512-d text) and sonic (9 audio features) separately** — different scales, different missingness; score candidates via soft-max over centers with sub-linear cluster weights (`π_j ∝ n_j^0.6`), not nearest-center-only and not the mean of centers; pick the smallest k within 0.02 silhouette of the best; fall back to one profile per modality when silhouette < ~0.1. Recompute on ≥5% library change.
6. **Evaluate with team-draft interleaving**, not A/B — confirmed by both runs, with one scope caveat (GPT): interleaving is only valid for **pointwise ranker changes**; list-level properties (calibration strength, artist cap, MMR) need within-user alternating periods instead. Decision rule: user-blocked Bayesian bootstrap over per-user mean credit, not Gemini's SPRT — SPRT assumes independent observations, which 30 correlated users (one power user = many events) violate. Health metrics from #2's log: pin-rate + remove-rate; edit distance logged but never an automated success criterion.

Explicitly rejected for now (unanimous or by our constraints): CLAP/MERT/neural multi-interest/graph walks (scale mismatch), Essentia audio-embedding pilot (revisit only if the action log shows "right meaning, wrong sound" failures — and we'd need lawful audio access first), an explicit exploration quota (Gumbel sampling already gives near-mean items probability mass), per-facet text embeddings, and an intent facet router (premium-only surface; revisit if intent steering feels sonic-deaf).

## External research reconciliation

The shared deep-research prompt was run through GPT and Gemini (deep research mode); raw outputs live at
`docs/playlist-creation/tmp/studio-suggestions-gpt-research.md` and `docs/playlist-creation/tmp/studio-suggestions-gemini-research.md`.

**Confirmed (both runs + this doc agree):** weight redistribution is the worst bug and the first fix; single centroid → multiple taste anchors, with neural multi-interest (MIND/ComiRec) and CLAP/MERT rejected at our scale; pins as session anchors that temporarily dominate the long-term profile; Beta-Binomial feedback priors with asymmetric negative weights and exponential decay; closed genre taxonomy with deterministic mapping first and enum+abstain LLM labeling last; team-draft interleaving over A/B at 30 users.

**Changed by the research (decisions, not options):**

- *Missing-signal fix generalized* from "genre with pills" to all song-side signals, weight kept (decided fix #4, roadmap #1). GPT's additive neutral-contribution form over Gemini's multiplicative shrink-to-`μ₀−δ` — equivalent effect, but the additive form drops straight into the existing weighted fusion with no new prior term to maintain.
- *Pins are never averaged* (roadmap #3). Round 1 said "mean of pinned songs"; both runs independently reject means over multimodal pins. Soft-max over per-pin similarity instead.
- *Feedback prior is fixed-scale, not request-z-scored* (roadmap #2). Round 1's "±2σ z-scored term" was wrong for a sparse prior; GPT's argument (one event becomes a many-σ outlier when almost all candidates are zero) is decisive.
- *Genre taxonomy corrected* to the AcousticBrainz/Bogdanov 16 categories with the published Last.fm mapping (roadmap #4); "MusicBrainz top-level" doesn't exist as a compact set.
- *Clustering refined but stays k-means and cached* (roadmap #5): separate semantic/sonic profiles, soft-max mixture scoring, sub-linear cluster weights. Gemini's per-request Ward rejected — request-time O(n²) work for a profile that changes when the library changes.
- *Roadmap reordered*: confidence fix jumped from #3 to #1 (both runs: "immediate").

**Divergences settled against our constraints:**

- *GPT's full exposure logging* → simplified: with the session seed in `DraftConfig`, ranking is pure and replayable; action rows carrying (session, position, config context) reconstruct exposure for free. No per-preview write amplification (the preview refires on every debounced config change).
- *Gemini's fold-feedback-into-Gumbel-noise* → rejected in favor of a bounded additive term before sampling: same suppression effect, and every surprising score stays traceable to inspectable addends.
- *Gemini's SPRT stopping rule* → rejected for the user-blocked Bayesian bootstrap; SPRT's independence assumption is exactly what 30 correlated users break.
- *Gemini's audio-dominant default weights (0.7 audio / 0.3 text without intent)* → moot until a default-path query vector exists (clustering, roadmap #5); GPT's balanced mode-dependent table is the starting point then.

## Next steps

- [x] Reconcile GPT/Gemini deep-research outputs against this plan (this section).
- [ ] Openspec change for the ranking layer (decided items above): sampling seam, seed plumbing through `DraftConfig`, calibration, missing-signal weight fix at the fusion seam, per-pin anchor scoring, artist cap.
- [ ] Small first slice, independently shippable: studio action logging (append-only `studio_action` table — `match_decision`'s `playlist_id NOT NULL` + unique-pair upsert can't represent pre-publish session events), missing-signal weight kept when preferences are declared, always-pass embeddings in `preview.ts`.
- [ ] Backfill genres for the 25 genreless songs: deterministic Last.fm mapping + artist fallback first, artist-level LLM labeling for the residue; re-check the hip-hop-pill list afterwards.

## Handoff: implementation start prompt

Paste this into a fresh session to start execution. The design calls below were already grounded in the code — don't re-litigate them, but do verify line-level details against the current tree.

> Read `docs/playlist-creation/studio-suggestion-quality.md` in full — it is the decision record (diagnosis, decided ranking fixes, reconciled roadmap). Raw research inputs, if needed: `docs/playlist-creation/tmp/studio-suggestions-{gpt,gemini}-research.md`. Then implement the **first slice** (three independently shippable parts), and spec — not implement — the ranking-layer change.
>
> **(b) Missing-signal fix** (do this first; it's what validation hinges on). Add `songMissingSignalPolicy?: "redistribute" | "neutral"` to `MatchingConfig` (`src/lib/domains/taste/song-matching/types.ts`). In `service.ts#fuse`, when the policy is `"neutral"`, feed `computeAdaptiveWeights` a **profile-side** availability (`hasEmbedding: !skipVectorScoring && profile.embedding !== null`, `hasAudioFeatures: centroid non-empty`, `hasGenres: distribution non-empty`) instead of the per-pair availability — mode-level absences (e.g. `noEmbeddingMode`) still redistribute, song-side gaps keep their weight, and `normalizeFactor` already returns 0 for song-unavailable signals so the contribution is neutral for free. In `draft-engine.ts#rankCandidates`, pass `"neutral"` when `profile.hasGenrePills || profile.embedding !== null`; leave the default `"redistribute"` so the worker's matching pipeline is untouched. Add a regression test naming the bug (genreless perfect-audio song vs genre-matching decent-audio song under a pill profile in noEmbeddingMode: redistribute → genreless wins, neutral → it loses); idiom exemplar: `__tests__/weight-switching.test.ts`.
>
> **(c) Un-gate embeddings in `preview.ts`** (`src/lib/workflows/playlist-studio/preview.ts`). Fetch `songEmbeddingsMap` for the rankable candidates on every path, not just when `effectiveIntent` is set; only the intent-embedding call stays intent-gated. `EmbeddingService.create()` is needed only for `getModel()` (no API call) — degrade to no map when the provider is unconfigured, exactly like today's failure path. This is deliberate plumbing with no behavior change yet: it keeps the upcoming ranking change pure-domain (no IO edits).
>
> **(a) Studio action logging.** `match_decision` cannot represent pre-publish session events (`playlist_id NOT NULL`, `UNIQUE(account_id, song_id, playlist_id)` + upsert overwrites history), so add an append-only `studio_action` table: `account_id`, `song_id`, `session_id uuid`, `action text` ('add' | 'pin' | 'remove' | 'dismiss'), `position int null`, `context jsonb` (genre pills, filters, intent presence — seed later), `created_at`; RLS enabled, no policies (service-role only, like `match_decision`). Timestamped migration in `supabase/migrations/`, then `bunx supabase db push` (local) + `bun run gen:types`. Queries in `src/lib/domains/taste/song-matching/` (the feedback log is taste knowledge); server fn `recordStudioActions` in `src/lib/server/playlist-draft.functions.ts` behind `authMiddleware`, ownership-checked via `selectOwnedSongIds`, fire-and-forget from the client. Client sites live in `src/features/playlists/create/useCreatePlaylistDraft.ts`: session id = lazy `crypto.randomUUID()` per mount; careful — `dismissSuggestion` is aliased to `removeSong` and `togglePin`'s pin branch calls `addSong`, so extract shared inner transitions and log the action type at each *public* callback ('dismiss' vs 'remove', 'pin' vs 'add') without letting the alias double-log.
>
> **Ranking layer goes through openspec** (`/opsx:ff` or `/opsx:new`), never freelanced: seeded Gumbel-top-k with rank-tiered temperature, session seed in `DraftConfig` (client-generated once per studio session, re-rolled by a shuffle affordance), Steck calibration re-rank under pills, max-2-per-artist cap, and per-pin soft-max anchor scoring (roadmap #3).
>
> **Validate** on the `fabiogaliano` account in local Supabase (`supabase-local` skill, container `supabase_db_v1_hearted`): with the "hip hop" genre pill, "O Mar que Sobra" (Vasco Vilhena — no genres, no embedding, dead-center audio) must leave the top 15 after (b). The 20–40%-turnover / stable-top-3–5 check applies only after the sampling change lands. Run tests per file (`bun run test <file>`), `bun run typecheck`, and keep structural vs behavior changes in separate commits.
