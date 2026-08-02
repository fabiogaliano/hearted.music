# Studio suggestion quality: private-beta roadmap

Date: 2026-08-02  
Status: private-beta product behavior settled; delivery step 1 shipped; remaining implementation specifications not started  
Related diagnosis: [`../studio-suggestion-quality.md`](../studio-suggestion-quality.md)

## Product context

This roadmap assumes:

- The near-term audience is the maintainer and a small private beta.
- The primary goal is the best automatic playlist, without requiring configuration.
- Pinning means both **include this song** and **softly steer toward compatible songs**.
- There is not enough usage volume to justify behavioral learning or experimentation infrastructure — but raw event collection is exempt, because events are the one asset that cannot be backfilled.

The Studio is a **rediscovery** tool, not a recommender: every candidate is already a liked song, so it can never fail on likability — only on **fit** (wrong song for this playlist), **freshness** (same songs every session), and **trust** (a pick so wrong it reads as "the system doesn't get me"). Its emotional job is resurfacing corners of the library the user forgot they loved. This is why taste-mode clustering outranks learned preference at this scale.

A typed matching intent does not change that: it turns curation into **retrieval over the same liked library**. The user declares the direction; the system finds the likes that match it. See "Decided intent-mode behavior" for how this flips the quality bar.

The selected private-beta features are:

- Studio action logging (collection only)
- Seeded variation and Shuffle
- Curated tracklist vacancies and an automatic-song budget
- Automatic artist-diversity balancing
- A why-this-song score trace (dev-only)
- Pin-based steering
- Taste-mode clustering (session vibes)

Genre-pill output calibration is explicitly deferred. First validate the existing pill profile/weight behavior after the missing-signal fix; add list-level calibration only if pills still fail to move the output clearly. Missing-genre backfill is likewise deferred unless private-beta validation shows niche songs remain unfairly excluded.

Design the selected features together so their state and ranking interactions are explicit, then implement and validate them separately in the delivery order below.

## Decided tracklist behavior

The song-count control is an **automatic-song budget**, not a hard total-playlist maximum. Label it **Automatic picks · 15** with the helper text **Songs you add don’t count toward this.**

- The initial draft fills up to the configured automatic-song budget.
- Dismissing an automatic song removes its slot intentionally; the engine does not silently refill it.
- Changing genres or filters reranks the same number of remaining unpinned automatic slots. It may replace their songs, but it does not restore dismissed slots.
- Pins remain fixed while unpinned automatic slots rerank.
- Explicitly adding an individual suggestion may grow the playlist beyond the automatic-song budget.
- Artist-derived selections consume the automatic-song budget; they do not sit on top of a full general-purpose automatic allocation.
- Increasing the budget adds ranked automatic slots; decreasing it removes the lowest-ranked automatic slots. Manual pins/additions remain untouched.
- Shuffle preserves pins, dismissals, and the current automatic-slot count while replacing the editable automatic portion.
- Keep one unified tracklist. Existing pin markers communicate explicit commitments; do not restore separate automatic/manual list sections.
- The visible track count is the source of truth for what will be published.

This differs from the current stateless composition behavior, where `maxSongs` is a hard total cap and every preview recomposition fills back to it. Implementation therefore needs explicit state for the current automatic-slot count; an exclusion list alone cannot distinguish an intentional vacancy from a slot that should be refilled.

The budget deliberately breaks the mental model other tools teach ("this number is the playlist length"); the helper text carries that divergence. Treat the first session where budget and visible count differ (dismissals + manual adds) as an explicit review scenario.

## Decided intent-mode behavior

A typed intent flips the Studio from "system proposes a direction" to "user declares one." Decisions:

- The intent supplies the session direction. The taste profile remains a secondary prior; once session vibes exist, a typed intent **overrides vibe selection** entirely.
- **Precision against the brief outranks freshness.** Serving the same strong matches for the same brief in a later session is correct, not stale. Session-to-session rotation mechanisms never apply in intent mode.
- **Shuffle varies songs within the brief; it never changes the direction.** "Take me somewhere else" semantics apply only to automatic sessions.
- An intent is the highest-specificity request. Songs missing embeddings cannot be assessed against the brief and must sink under the neutral-weight policy rather than ride their remaining signals; they stay reachable through the suggestions tray.

## Not now

Defer until real usage volume creates a concrete need:

- Interpreting the studio action log: feedback priors based on adds, pins, removes, or dismissals
- A/B testing, team-draft interleaving, and Bayesian evaluation infrastructure
- User-level behavioral personalization
- LLM genre classification
- Genre-pill output calibration, unless post-fix validation shows pills remain ineffective

These features add interpretation and operational complexity without enough observations to produce reliable decisions today. Collecting the raw actions is not deferred (delivery step 3): an append-only log nothing reads yet costs nothing to keep, and early noisy data is harmless precisely because no ranking consumes it.

## Delivery order

### 1. Stop rewarding missing evidence — shipped

The missing-signal neutral-weight policy from the diagnosis, plus the always-load-embeddings plumbing.

**Product outcome:** Declared preferences are trustworthy: a song missing genre or embedding evidence no longer receives extra audio weight merely because the evidence is absent, so genreless centroid-huggers lose their artificial advantage.

**Follow-up:** Re-check the hip-hop-pill scenario on the reference account to confirm pills now visibly move the output before deciding anything about calibration (step 10).

### 2. Probe whether the library actually forms vibes

Before any session-vibes design work, test the assumption it stands on: that the library partitions into taste areas the user would recognize.

- Throwaway script in `scripts/`, run against the reference account in local Supabase; findings noted in `docs/tmp/`.
- Cluster semantic embeddings and audio features separately with the parameters already decided in the diagnosis (k-means, smallest near-optimal k by silhouette, minimum cluster sizes).
- Print each cluster's medoid plus its five nearest songs and review manually.

**Success criteria:** at least 3 clusters in at least one modality, with roughly 70% of clusters recognizable as a genuine taste area. Below that, the single-profile fallback is the main path and step 9 must be re-shaped before it is specified.

**Why first:** Session vibes is the roadmap's largest and most experimental item, and this is an hour of scripting that either de-risks it or resizes it.

**Scope:** Tiny; no product code.

### 3. Log studio actions (collection only)

Add the append-only `studio_action` table and fire-and-forget recording of add, pin, remove, and dismiss with session id, position, and config context, per the diagnosis handoff spec. Nothing reads the log yet.

**Why now:** Every "Not now" item can be built later without loss except this one — history cannot be backfilled. The revisit triggers below require historical actions to exist on the day they fire.

**Product outcome:** None visible today; optionality preserved for free.

**Scope:** Small — one migration and one server fn, already specified.

### 4. Add seeded variation and Shuffle

Keep one seed stable for the Studio session. It provides modest variation among similarly meritorious songs; protect the strongest three to five positions from most sampling noise.

Decided behavior:

- A fresh Studio visit receives a fresh seed and therefore a fresh selection.
- The action is labeled **Shuffle playlist**. It rerolls the seed, intentionally choosing new songs.
- Genre/filter edits do not reroll the seed.
- Existing Refresh suggestions remains the way to explore deeper candidates without rerolling.
- Shuffle preserves explicit pins and dismissed-song exclusions. Until the automatic-song budget (step 5) lands it refills to the cap as today; afterwards it also preserves the current automatic-slot count. Once session vibes (step 9) land, the seed additionally selects the session vibe, making Shuffle a "take me somewhere else" action — in automatic sessions only; under a typed intent, Shuffle varies songs within the brief.
- **Shuffle must feel instant** (sub-~400ms perceived). Ranking is a pure function of (library, config, seed), so the next seed's draft can be prefetched before the button is pressed. A slow Shuffle breaks the exploratory loop regardless of ranking quality.

**Why here:** This is the cheap fix for the "same songs every session" half of the original complaint, and it works over the current centroid ranking — the sampling design was already decided in diagnosis round 1. Shipping it early also answers a sizing question for step 9: how much of the felt problem is staleness rather than centroid-averageness.

**Product outcome:** Fresh, coherent sessions now, without waiting on the clustering bet.

**Tradeoff:** The result is no longer the strict top-N by score; top-slot protection and modest temperature keep it curated.

**Escalation dial:** If sampling alone doesn't dissolve the same-songs feeling, the next step is a deterministic **served-recently discount** — exposure bookkeeping, not preference learning, so it doesn't reopen the "Not now" boundary. It requires retaining recent session seeds/configs (tiny), since served lists are otherwise only reconstructable by replay. Automatic sessions only; never under a typed intent.

**Scope:** Small to medium — seed plumbing through `DraftConfig`, the sampling seam, and a Shuffle affordance.

### 5. Make automatic slots respect curation

Replace the current continuously refilled hard total cap with the decided automatic-song budget and explicit automatic-slot state.

**Why now:** Today, dismissing a song immediately promotes another ranked candidate, contradicting the intended curation model and making the user's removal feel ineffective.

**Product outcome:** The initial generation provides a useful starting draft; dismissals create intentional vacancies, manual additions can grow beyond the generation budget, and later ranking changes affect only the editable automatic portion.

**Tradeoff:** The draft is no longer a pure function of configuration, exclusions, and ranking. The client/server contract must carry enough session state to distinguish automatic slots, manual additions, artist-derived commitments, and intentional vacancies. Decide explicitly where that session state lives and whether it survives a reload — losing curation state on an accidental refresh is a worse failure in a personal app than a stale draft.

**Scope:** Medium and prerequisite to pin steering and full Shuffle preservation semantics.

### 6. Balance automatic artist repetition

Use diminishing returns during automatic selection rather than a hard per-artist cap. Repeated songs from the same primary displayed artist become progressively less competitive, but can still be selected when they are clearly the best fit. Manual and artist-derived pins are not penalized.

Decided artist-scoped behavior:

- The artist control supports both **Around** and **Only** modes through one compact mode switch that appears only when at least one artist is selected.
- Only mode is a true hard artist scope for the tracklist and automatically places at most the configured automatic-song budget. If fewer liked songs qualify, return a shorter playlist.
- Additional songs by the selected artists and compatible songs outside the hard scope may still appear in the suggestions tray, where the user can add them explicitly.
- Ordinary artist-diversity accounting uses the primary displayed artist, not every featured credit.
- Use moderate diminishing returns: a second and third song remain plausible, while every additional repetition requires increasingly stronger relevance.

**Why now:** This improves breadth without rejecting musically appropriate repetition or preventing intentional artist-focused playlists.

**Product outcome:** Automatic playlists are less likely to be dominated accidentally, while a strong fit can still justify another song from the same artist.

**Tradeoff:** A soft penalty is less predictable than a hard cap and needs a fixed, inspectable curve that implements the decided moderate strength.

**Alternative:** A max-two hard cap is simpler, but it can reject a clearly fitting third song. The product decision is to prefer soft balancing.

**Scope:** Medium; specify the numeric diminishing-return curve before implementation.

### 7. Add a why-this-song trace (dev-only)

Surface each tracklist song's score breakdown in the Studio behind a dev flag: taste-profile proximity, pill contribution, pin similarity, artist penalty, sampling noise, and missing-signal effects, as the inspectable addends they already are in the fused score.

**Why here:** From pin steering onward, up to four steering forces act on one list (vibe, pills, pins, artist scope). When a surprising song appears, attribution must be a glance, not a debugging session. At this scale, explainability is the evaluation tooling — the maintainer is the reviewer.

**Product outcome:** Every "this list feels off" moment during private-beta review resolves to a named cause; ranking regressions become visible the day they land.

**Scope:** Small; the fused score is already a sum of inspectable addends — this is presentation, not new computation.

### 8. Let pins steer the remaining playlist

A pinned song remains guaranteed in the tracklist and also acts as a bounded similarity anchor for unpinned candidates.

Decided behavior:

- Pin steering applies to both the remaining automatic tracklist slots and the suggestions tray.
- Steering never changes the number of automatic slots and never restores a dismissed vacancy.
- Pin similarity is noticeable but secondary to the automatic taste profile and declared configuration.
- Compare candidates with each pin independently.
- When pins differ, a candidate may fit any one pin; combine per-pin similarities with a soft maximum rather than forcing candidates toward a blended middle.
- Never average heterogeneous pin embeddings into one query vector.

**Why before vibes:** Pins are direct session evidence, and pin steering is a medium-cost probe of the same asset session vibes bets on at large cost — whether the semantic embeddings encode musical compatibility rather than lyric-topic overlap. If pin steering feels wrong, that is decisive information about step 9 before its spec is written.

**Product outcome:** Users can communicate “include this and build compatibly around it” without writing an intent.

**Tradeoff:** A user may occasionally pin an exception without wanting similar songs. Keep the influence bounded; split out a future “more like this” control only if this becomes confusing in private-beta review.

**Scope:** Medium; embedding plumbing already shipped in step 1.

### 9. Replace the single library centroid with session vibes

Represent a varied library through several coherent taste areas rather than one global average, then select one coherent vibe for each fresh Studio visit. A vibe may arise from genre, sonic character, semantic mood/theme, or agreement across those signals; it does not need a user-facing label. Shape this step with the results of the step 2 probe.

Decided behavior:

- One Studio session builds one coherent automatic playlist rather than mixing unrelated taste modes deliberately.
- A fresh Studio visit may select a different vibe from the same library.
- A typed intent overrides vibe selection for the session (see "Decided intent-mode behavior").
- Semantic meaning and audio sound are independent valid evidence. A song can fit a vibe through either, with bounded modality contributions so neither automatically wins every conflict.
- The selected vibe remains deterministic within the session and has no explicit user-facing label; the songs communicate the direction.
- Fresh visits favor larger taste areas while still giving meaningful smaller vibes a chance.
- Avoid only the immediately previous vibe by retaining its opaque id locally and rerolling once. This is local continuity, not behavioral analytics.
- Genre and hard-filter changes adapt the vibe deterministically. Preserve it where it remains valid; if it no longer fits the eligible set, choose the closest valid vibe rather than switching randomly.

Technical direction:

- Cluster semantic embeddings and audio features separately because their scales and missingness differ.
- Keep the number of candidate vibes small; local storage retains only the last selected opaque vibe id.
- Use the session seed to select a candidate vibe and score songs against its relevant centers rather than the global mean.
- Give meaningful smaller vibes a real chance of selection instead of choosing only the library's largest cluster.
- Recompute synchronously after a material change (approximately 5% of the library or usable feature coverage) or a model/clustering-config version change, with a simple cache keyed by library state and config version. At ≤1k songs clustering is milliseconds of in-memory work — no versioned vibe sets, no serve-while-rebuilding, no atomic replacement; earn that machinery only if recompute latency ever becomes noticeable.
- Fall back to one conventional profile when the library is too small or sparse for meaningful clustering.

**Why last among the ranking changes:** The global centroid is the fundamental default-path defect, but this is also the largest and most experimental item. By this point the probe (step 2) has validated the clusters, pin steering (step 8) has validated the embeddings, and seeded variation (step 4) has shown how much of the complaint staleness alone explains.

**Product outcome:** Better playlists with no pills, intent, or pins; each visit explores a coherent, genuine area of the user's taste — the rediscovery job served directly.

**Tradeoffs:** An automatically inferred vibe may occasionally feel surprising, and a stable session requires careful seed and configuration semantics.

**Alternatives:**

- Genre-only vibes are simpler and explainable but depend on incomplete metadata.
- A random liked-song anchor creates variety cheaply but is unstable and can overfit one song.
- Mixing several modes in every playlist represents the whole library but can sacrifice listening coherence.
- Keeping the centroid and adding randomness varies the output without fixing relevance.

**Scope:** Large; requires an OpenSpec change and fixture-based evaluation before implementation.

### 10. Fill genre gaps only when validation shows a remaining problem

After missing evidence becomes neutral, missing genres no longer create an unfair ranking advantage. Add deterministic cross-track artist fallback only if manual review shows that good niche songs are still systematically excluded.

**Product outcome:** Better coverage for obscure and non-English music when genre steering is used.

**Tradeoff:** Artist-level genres can mislabel stylistically varied artists. Inferred genres must remain weak ranking evidence and never power hard filters.

**Scope:** Medium. LLM classification remains out of scope until deterministic coverage proves insufficient.

## Private-beta evaluation

**The roadmap succeeds if:** fresh sessions stop feeling samey, more sessions end in a published playlist, and publishing needs fewer manual corrections. Judged by the maintainer's direct experience, not instrumented — but named so the review verifies the product, not just the spec.

**Review top-down:** trust concentrates in the top slots. One wrong song at #2 costs more than five mediocre songs at #10–15, because the top of the list reads as the system's confident thesis about the user's taste. Judge the top five before the list average, for every ranking change.

Do not build online experimentation infrastructure. Maintain a small set of reproducible scenarios against a realistic library:

1. No-input automatic playlist
2. Hip-hop pill
3. Two musically different pins
4. Genreless song with unusually strong audio proximity
5. Library dominated by one artist
6. Same configuration under two session seeds
7. A typed intent (theme brief), with and without pins
8. A session where budget and visible count diverge (dismissals plus manual adds)

Review both computed invariants and the actual tracklists:

- Repeated automatic selections from one primary artist face increasing competition without overriding explicit artist scope.
- Missing evidence never increases another signal's weight in preference-aware modes.
- Pills visibly change output composition.
- Pins pull compatible songs closer without collapsing the playlist around one anchor.
- Each session forms one coherent vibe without the global centroid dominating.
- A fresh seed can select another genuine vibe; the same seed replays the same choice.
- Genre/filter edits adapt deterministically without random vibe changes.
- Shuffle selects a new vibe and new songs in automatic sessions; under an intent it stays on the brief.
- Under a typed intent, songs missing embeddings never rank above verified matches.

Use fixed fixtures and local-account replay for regressions. Musical judgment remains a manual product review at this stage; the why-this-song trace (step 7) is the supporting tooling.

This plan assumes regular real Studio sessions. If usage — not quality — turns out to be the bottleneck, nothing in the product currently cues a visit; the lightest fix is a timing hook such as "new liked songs since your last session" as the Studio entry point. Do not build it preemptively.

## Revisit triggers

Only reconsider interpreting the action log — feedback priors, learned personalization — when at least one is true:

- There are enough recurring users that manual review no longer represents usage.
- Repeated resurfacing or rejection becomes a reported product problem.
- Ranking decisions cannot be resolved through deterministic scenarios and private-beta review.
- A concrete personalization feature requires historical actions as an input.

Until then, prefer transparent ranking rules, reproducible fixtures, and direct inspection over speculative learning infrastructure. The log itself (step 3) is already accumulating, so any of these triggers can be acted on with history in hand.
