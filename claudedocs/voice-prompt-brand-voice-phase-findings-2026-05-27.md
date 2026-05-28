# Handoff: Song-Analysis Prompt Exploration (Voice + Brand)

Paste this whole file into a fresh conversation to continue the work. It is self-contained.

---

## Mission

Find the best **song-analysis prompt for `gemini-2.5-flash`** that does three things at once:

1. **Eliminates the phrase-level AI-writing tells we encode** (measured by the voice-audit Tier-1 rules). The rules catch surface constructions (specific words and shapes), not the statistical tells the literature reports as most reliable (low lexical diversity, repetition, nominalization, POS skew). So a clean Tier-1 score is necessary, not sufficient — read the prose too.
2. **Sounds like Hearted's brand voice** (see `v1_hearted_brand/brand/VOICE-AND-TONE.md`).
3. **Avoids hyphens and dashes** entirely (a new hard constraint this phase).

We iterate empirically: write a prompt version, generate real analyses, score them, compare means, repeat. The previous phase took the participial-closure problem from ~15 hits/analysis down to ~2-3. This phase layers brand voice on top without losing that discipline.

---

## How to run (do this first — it is already wired up)

Generation runs through **Vertex AI** (`google-vertex` provider), which bills the GCP project and has **no free-tier 20/min quota**. It uses `gemini-2.5-flash` by default, the same model as the earlier runs, so scores stay comparable.

Prerequisite (one time per machine):

```bash
gcloud auth application-default login --project=hearted-492606
# GOOGLE_VERTEX_PROJECT / GOOGLE_VERTEX_LOCATION are already in .env
bun scripts/smoke-vertex.ts   # should print: response: hello
```

The exploration loop:

```bash
# Generate + audit one song with a prompt version, N times (records to experiments/)
bun scripts/voice-audit/regen.ts --version 8 --runs 3      # defaults to google-vertex:gemini-2.5-flash
bun scripts/voice-audit/regen.ts --version 9 --runs 3

# Aggregated comparison across all versions (lower mean-high = better)
bun scripts/voice-audit/report-experiments.ts

# Re-score every recorded run under the CURRENT Tier-1 rules — no API calls
bun scripts/voice-audit/rescore.ts

# The voice-audit unit tests (rules + content-analysis)
bun run test scripts/voice-audit
```

Currently the harness only tests one song (Kendrick Lamar — "Not Like Us", a worst-case dense rap). **Add more songs** (see Step 4) before trusting any winner.

---

## Repo map

Prompts (versioned, immutable files; production reads the active one):

- `src/lib/domains/enrichment/content-analysis/prompts/` — `lyrical-v2.ts` … `lyrical-v8.ts`, `instrumental-v{2,3}.ts`, `types.ts`, `registry.ts`
- `registry.ts` exposes `ACTIVE_LYRICAL_VERSION` (currently **"8"**), `getLyricalPrompt(version)`, `listLyricalVersions()`. Production (`song-analysis.ts`) derives the stored `prompt_version` from the active pointer — bump the pointer to ship a new prompt.

Audit + experiment harness (`scripts/voice-audit/`):

- `tier1/rules.ts` — 10 deterministic rules (the scorer). See "What the rules catch" below.
- `regen.ts` — generate one song with `--version`/`--model`/`--provider`/`--runs`, audit, record. No DB writes.
- `experiments.ts` + `experiments/` — append-only store: full `<runId>.json` per run + `runs.jsonl` index.
- `report-experiments.ts` — aggregates by version/model: mean/min/max high, top rules.
- `rescore.ts` — re-runs current rules over stored analyses (cheap retroactive re-scoring after a rule change).
- `__tests__/rules.test.ts` — unit tests for the rules.

LLM transport (committed separately, in `feat(llm): default analysis to Vertex AI`):

- `src/lib/integrations/llm/config.ts` — `resolveLlmConfig(provider)`, `DEFAULT_LLM_PROVIDER = "google-vertex"`.
- `src/lib/integrations/llm/service.ts` — `LlmService`; Vertex default model is `gemini-2.5-flash`.

Brand (READ THESE before writing v9):

- `v1_hearted_brand/brand/VOICE-AND-TONE.md` — primary. Voice traits, tone-by-context, core patterns, Use/Avoid lists, punctuation rules.
- `v1_hearted_brand/brand/COPY-GUIDE.md`, `POSITIONING.md`, `HANDOFF-ANALYSIS-REDESIGN.md` — supporting depth.

---

## What the Tier-1 rules catch (this is the scoreboard)

`high`: `antithesis` ("isn't X, it's Y", "not only X but Y", "no X, no Y, just Z"), `participial-closure` (", \<verb\>-ing …" tacked on), `self-reference` ("this song", "the track", "the listener", "the narrator"), `academic-register` ("juxtaposition", "explores themes of"), `book-report-opener` (field starts with "This is a/about…").
`medium`: `copula-avoidance` ("serves as", "represents", "frames"), `puffery-adjective` ("blistering", "relentless", "haunting", "definitive"…), `ai-vocabulary` (the "delve"/"tapestry"/"testament"/"leverage" cluster; fires only when ≥2 distinct words co-occur, per the Wikipedia "it's the clustering" point), `hedging` ("perhaps", "might be").
`low`: `burstiness` (all sentences same length → robotic), `rule-of-three` ("X, Y, and Z", now phrase-level), `lexical-repetition` (a content word repeated ≥3× across the pooled prose — the literature's most-replicated tell; best read as a _comparative_ signal since topical repetition is constant per song).

The rule for `participial-closure` was tuned to ignore false positives (pre-nominal `-ing` adjectives like "knocking drums", and subjects with their own finite verb like "thumping bassline drives…"). If you see a participial hit that is actually an adjective, extend `PARTICIPIAL_FINITE_VERBS` / `PARTICIPIAL_VERBAL_HEADWORDS` in `tier1/rules.ts`.

**There is no hyphen/dash rule yet — adding one is Step 1 (below).**

---

## What we learned (hard-won — do not relitigate)

Ranking from the last phase, mean `high` hits over 3 runs each on "Not Like Us" (lower better):

| Version         | Strategy                                                            | mean high |
| --------------- | ------------------------------------------------------------------- | --------- |
| **v8** (active) | structural core + rewrite-example bans for stubborn tells           | **2.7**   |
| v5              | hard structural form (short complete sentences, never comma+`-ing`) | 4.0       |
| v7              | v5 + restored self-reference/opener bans + burstiness fix           | 4.0       |
| v4              | few-shot (one clean worked example)                                 | 9.0       |
| v6              | positive-minimal (almost no ban list)                               | 11.3      |
| v2              | original production prompt                                          | 15.5      |
| v3              | long prohibition list                                               | 16.7      |

Principles that held up across samples:

1. **Constrain sentence SHAPE, not vocabulary.** "Write complete sentences; never write a comma followed by an `-ing` word" + a before/after rewrite killed participial closures, which every vocabulary ban failed to touch.
2. **Long ban-lists backfire.** v3 (most prohibitions) scored worst — naming bad patterns primes them.
3. **Rewrite examples beat prohibitions for stubborn tells.** When "the track" and "This is a…" survived bans, adding `Wrong: … / Right: …` pairs (v7→v8) reduced them.
4. **Variance is high.** Run each version ≥3 times and compare means. A single run proves nothing.
5. **Store the full analysis** so rule changes can re-score history for free (`rescore.ts`).

---

## Current best (v8) and its remaining weaknesses

v8 (`prompts/lyrical-v8.ts`) is the structural winner but reads a bit **flat and clinical** ("It condemns the opponent. A declaration of war."). Its residual `high` hits are scattered:

- `self-reference` "the track" / "this song" still leaks occasionally despite explicit bans + rewrite examples.
- `book-report-opener` "This is a …" — the model is fixated on this for some songs.
- Stray `copula-avoidance` ("serves as", "frames") and `puffery` ("definitive") leak.

So v8 is _clean_ but not yet _Hearted_. That is the gap this phase closes.

---

## The central tension to solve

v8's short, clipped sentences are what kill the participial habit — **keep that**. But Hearted's voice is _warm, curious, observant, playful_, with **songs that have agency** ("It found you. You kept it.") and **evocative fragments** ("Synths pulse like a racing heartbeat. The dam breaks."). The next prompt must inject that warmth and image-richness **without** reintroducing comma+`-ing` chaining, puffery, or "this song" framing.

Good news: brand "evocative fragments" are short and often comma-spliced _without_ `-ing`, so they are compatible with the structural rule. The brand's Direct-Interpretation rule ("state the insight, no 'This song is about…'") and "commas over em dashes" already match our findings.

---

## New constraints this phase

1. **No hyphens or dashes, at all.** No em dash (—), en dash (–), or hyphen (-). Per the brand ("commas preferred over em dashes") and the AI-writing signs page, dashes are a tell. Hyphenated compounds become two words or a rephrase: "late-night" → "late night"; "self-aware" → "aware of itself". Compound moods stay two space-separated words ("Anxious Nostalgia") — those were never hyphenated. (Caveat: the "dashes = AI tell" consensus is a 2024–2025 practitioner observation on newer models. The academic survey cited below — arXiv 2510.05136 — actually found GPT-3.5-era AI text used _fewer_ dashes than humans. This ban rests on brand preference plus recent practitioner consensus, not on that survey; do not attribute it to the literature.)
2. **Hearted brand voice** — read `VOICE-AND-TONE.md` and embody: curious / observant / warm / confident / playful; songs have agency; poetic minimalism; direct interpretation; the Use/Avoid word lists; one exclamation max.
3. **Wikipedia "Signs of AI writing"** (https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) — already largely encoded in Tier-1: participial tacking, copula avoidance, "not X but Y", rule of three, puffery/peacock words, em-dash overuse, significance inflation ("stands as a testament"), elegant variation. Keep these out.

---

## Plan for this phase

**Step 1 — Add a dash/hyphen Tier-1 rule** (so adherence is measured, not hoped).

- In `tier1/rules.ts`, add a rule that flags `—`, `–`, and prose hyphens. Suggest `medium` for em/en dashes (strong tell) and `low` for intra-word hyphens (sometimes legitimate, but the brand wants them gone). Register it in `ALL_RULES`. Add tests in `__tests__/rules.test.ts`. Run `bun run test scripts/voice-audit`.
- Then `bun scripts/voice-audit/rescore.ts` to see how existing versions fare on the new rule.

**Step 2 — Write `lyrical-v9.ts`** = v8's structural core + brand voice + no-dash rule.

- Start from `lyrical-v8.ts` (copy it). Keep the HOW-TO-WRITE block (short complete sentences; never comma+`-ing`; no "This is…" openers; no "this song"/"the track").
- Add brand voice: the friend-who-notices framing, songs-have-agency, evocative image fragments, warmth. Pull concrete exemplars from `VOICE-AND-TONE.md` (e.g. "Synths pulse like a racing heartbeat.", "It found you.").
- Add the no-dash rule explicitly with a rewrite example.
- Register v9 in `registry.ts` (add import + map entry; do NOT change the active pointer yet).

**Step 3 — Test and iterate.**

- `bun scripts/voice-audit/regen.ts --version 9 --runs 3`, then `report-experiments.ts`. Compare v9 mean-high against v8.
- Read the actual generated text (in `experiments/<runId>.json`) — the scoreboard catches tells, but only your eye catches whether it sounds _Hearted_ and warm vs flat. Both matter.
- Iterate to v10, v11… each a new file, each tested ≥3×. Use rewrite examples for any stubborn residual tell (proven technique).

**Step 4 — Validate across songs.** "Not Like Us" is one worst-case. In `regen.ts`, the `SONG` constant is hardcoded; parametrize it (or add a small song list) and test the leading candidate on this fixed 5-song set before declaring a winner. Brand fit and tell-rate both vary by song.

These five were chosen from the local DB (`song` + `song_audio_feature`) for maximum spread across genre, energy, valence, acousticness, instrumentalness, and lyrical cadence. All are mainstream vocal tracks, so lyrics resolve via `DataFetcher`'s external fetch (the DB stores no lyrics) — and none is a pure instrumental that would make the lyrical harness abort.

| Song                              | spotifyTrackId           | Profile (e/v/ac/inst)     | Why it's in the set                                                                                                                          |
| --------------------------------- | ------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Kendrick Lamar — Not Like Us      | `6AI3ezQ4o3HUoP6Dhudph3` | 0.45 / 0.21 / 0.01 / 0.00 | Dense aggressive rap. The worst-case for participial-closure + repetition; keep as the baseline.                                             |
| Olivia Rodrigo — drivers license  | `4ml4WlnHDEpOK8HRVYTCWf` | 0.43 / 0.14 / 0.74 / 0.00 | Slow sad pop-rock ballad. Tests warmth on low-energy, acoustic, emotionally direct material.                                                 |
| Lorde — Ribs                      | `2MvvoeRt8NcOXWESkxWn3g` | 0.47 / 0.04 / 0.53 / 0.61 | Instrumental-leaning (highest instrumentalness with real lyrics), atmospheric, melancholic — sparse-vocal stress test.                       |
| The Weeknd — Blinding Lights      | `0VjIjW4GlUZAMYd2vXMi3b` | 0.73 / 0.33 / 0.00 / 0.00 | Upbeat driving synthpop. A mainstream pop hit with a totally different mood and rhythm from the rest.                                        |
| Phoebe Bridgers — Motion Sickness | `5xo8RrjJ9CVNrtRg2S3B1R` | 0.55 / 0.62 / 0.77 / 0.04 | Indie-folk singer-songwriter, acoustic, literary confessional lyrics. The closest genre to Hearted's target voice — the real brand-fit test. |

Paste-ready for the `SONG`/song-list in `regen.ts` (`TestSong` shape):

```ts
const SONGS: TestSong[] = [
  {
    artist: 'Kendrick Lamar',
    title: 'Not Like Us',
    spotifyTrackId: '6AI3ezQ4o3HUoP6Dhudph3',
    album: 'Not Like Us',
  },
  {
    artist: 'Olivia Rodrigo',
    title: 'drivers license',
    spotifyTrackId: '4ml4WlnHDEpOK8HRVYTCWf',
    album: 'SOUR',
  },
  {
    artist: 'Lorde',
    title: 'Ribs',
    spotifyTrackId: '2MvvoeRt8NcOXWESkxWn3g',
    album: 'Pure Heroine',
  },
  {
    artist: 'The Weeknd',
    title: 'Blinding Lights',
    spotifyTrackId: '0VjIjW4GlUZAMYd2vXMi3b',
    album: 'After Hours',
  },
  {
    artist: 'Phoebe Bridgers',
    title: 'Motion Sickness',
    spotifyTrackId: '5xo8RrjJ9CVNrtRg2S3B1R',
    album: 'Stranger in the Alps',
  },
];
```

When parametrizing, loop the chosen version over all five (≥3 runs each) and compare per-song mean-high — a winner must hold across the set, not just on "Not Like Us". Read at least one full output per song: `lexical-repetition`'s topical-vs-filler split (see audit note above) shifts by song, so its absolute count is only meaningful within a song, not across them.

**Tiering (keep iteration cheap):** generation is the billed, slow step, and cost scales with `songs × runs`. Don't pay for breadth on every iteration:

- **Fast loop (iterate v9→v10→v11…):** just 2 songs — _Not Like Us_ (worst-case tell generator) + _Motion Sickness_ (brand-voice test).
- **Standard check:** the 5-song set above, before calling any version a candidate.
- **Final validation (promotion only, once):** the 5 plus these 3 gap-fillers, chosen to close the coverage holes the 5 leave open (no happy/high-valence song, no Latin / very-low-energy, no guitar-rock lead vocal). Past ~8 well-spread songs it's diminishing returns.

| Song                              | spotifyTrackId           | Profile (e/v/ac/inst)     | Fills                                                                                                                              |
| --------------------------------- | ------------------------ | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Hozier — Too Sweet                | `3HMY0r2BAdpasXMY8rseR0` | 0.62 / 0.93 / 0.03 / 0.00 | Happy/high-valence (the set otherwise tops out at 0.62); folk-blues.                                                               |
| Bad Bunny — DtMF                  | `3sK8wGT43QFpWrvNQsrQya` | 0.13 / 0.03 / 0.18 / 0.22 | Energy floor + Latin/reggaeton. Also **Spanish-language lyrics** — tests English analysis of non-English source, a real edge case. |
| Arctic Monkeys — Do I Wanna Know? | `5FVd6KXrgO9B3JPmC8OPst` | 0.53 / 0.41 / 0.19 / 0.00 | Guitar-rock lead vocal — a texture/cadence absent from the 5.                                                                      |

Paste-ready extension (append to the `SONGS` array for the final tier):

```ts
	{ artist: "Hozier", title: "Too Sweet", spotifyTrackId: "3HMY0r2BAdpasXMY8rseR0", album: "Unheard" },
	{ artist: "Bad Bunny", title: "DtMF", spotifyTrackId: "3sK8wGT43QFpWrvNQsrQya", album: "DeBÍ TiRAR MáS FOToS" },
	{ artist: "Arctic Monkeys", title: "Do I Wanna Know?", spotifyTrackId: "5FVd6KXrgO9B3JPmC8OPst", album: "AM" },
```

**Step 5 — Promote the winner.** Set `ACTIVE_LYRICAL_VERSION` in `registry.ts` to the winning version. Run `bun run test scripts/voice-audit src/lib/domains/enrichment/content-analysis`.

**Optional — deterministic rewrite second-pass.** If a couple of `high` hits prove unkillable by prompt alone, Tier-1 already locates the exact offending sentences; feed only those to a narrow "rewrite without the trailing `-ing` clause / drop the framing" call. Narrow tasks get near-total compliance.

---

## Gotchas

- **Closing backtick when authoring prompt files.** The `template` is a backtick string. Field names inside use escaped backticks (`` \`name\` ``), but the CLOSING backtick before `,` must be plain. Writing `\`,` instead of `` `, `` makes an "Unterminated template literal". Check after creating each file.
- **Vertex needs ADC.** If generations fail with auth errors, run the `gcloud auth application-default login` command above.
- **`--provider google`** uses the AI-Studio key and has a 20/min free-tier cap — avoid it for batch runs; use the default `google-vertex`.
- **Run records are written to `scripts/voice-audit/experiments/`** and accumulate. They are part of the experiment history.
- **Don't relitigate v3-style long ban lists** — the data says they make things worse.

## Definition of done

A prompt version that, over ≥3 runs on ≥3 varied songs, holds **0 `high` hits and ≤1 `medium`**, contains **no dashes/hyphens**, and _reads like Hearted_ (warm, observant, image-rich) rather than flat — confirmed by reading the actual output, not just the score.
