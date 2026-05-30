# Song Analysis Concept Redesign — Handoff

**Date locked:** 2026-05-28
**Branch:** `voice-audit/harness-and-eval-layer`
**Status:** UI direction locked. Schema concept proposed and validated against 4 hand-written exemplars; not yet migrated. Step 1 (lens vocabulary) is the next concrete deliverable.

---

## Quick start

This master holds strategic context. **The paste-prompts live in the session brief files**, not in this file. To start or resume work:

1. Find the next session in the session map (§4).
2. Open that session's brief file.
3. Copy the `## Start here` block from the top of the brief.
4. Paste into a fresh Claude Code session in this repo.

| Session | Brief file | Status |
|---|---|---|
| 0 (UI proof) | — | done |
| 1 (deferred decisions) | `claudedocs/session-1-resolve-deferred-decisions.md` | done |
| 2 (lens vocabulary) | `claudedocs/session-2-lens-vocabulary.md` | done |
| 3 (Zod migration) | `claudedocs/session-3-zod-migration.md` | done |
| 4 (prompt v14) | `claudedocs/session-4-prompt-v14.md` | done |
| 5 (voice-audit migration) | `claudedocs/session-5-voice-audit-migration.md` | done |
| **5.5 (next — v14 calibration)** | `claudedocs/session-5.5-v14-calibration.md` | ready |
| 6 (prod panel swap) | `claudedocs/session-6-prod-panel-swap.md` | pending (after 5.5) |

The rule that holds across all sessions: **the paste-prompt is always at the top of the brief file you're about to use, never in this master.** This file points at the brief; the brief contains the prompt.

---

## 1. TL;DR for the next agent

A new content model for song analyses has been designed and validated on a dev route. The **UI direction is locked** — do not redraw the panel layout. The schema, field names, and lens grammar are **working assumptions** (see section 8.2) — they hold up against 4 hand-written exemplars, but they have not been pressure-tested against generated outputs at scale. Stay alert to evidence that pushes back on any of them. Your job is to take the proposed concept forward through the next five steps, starting with Step 1.

**The proposed concept in one line:** Replace the existing 8-field song analysis schema (which renders as a flat pile of fields) with a three-layer "read" — `image / lens / tension / take / contradiction? / arc / lines / texture` (arc 4-6 beats, lines 3-5; both follow song structure and match the active prompt v13's ranges) — where a single named **lens** ("license as eulogy", "diss as block party") gives the panel one organizing perspective instead of eight parallel ones. Matching gets its own separate substrate (structured `theme_tags[]`, `scenes[]`, `address`, `register[]`, etc.) so the presentation can stay lean while matching gets richer.

---

## 2. Glossary — what the terms mean

The redesign introduces new vocabulary. Read this before anything else if you're new to the project — the rest of the doc assumes you know what these terms are.

### `lens`

The new field at the heart of the redesign. A named interpretive frame — a one-line claim about what the song is *really* doing underneath the surface. Not a tag, not a mood, not a genre. A *reading*.

| Song | Lens | Claim it makes |
|---|---|---|
| drivers license | `license as eulogy` | This song treats getting a driver's license as a funeral for a relationship |
| Not Like Us | `diss as block party` | This song turns an insult into a celebration anthem |
| Motion Sickness | `anger with receipts` | This song's anger isn't vague — it itemizes the specific damage |
| Blinding Lights | `speed as avoidance` | This song uses fast motion to outrun being alone |

The lens is the **thesis** of an essay. Everything else (take, arc, lines, texture) becomes evidence for the lens. Without it, the eight existing fields each make their own little claim and nothing organizes them. With it, you have one claim plus seven supporting pieces.

**Why this is the most important new field:** it's what gives the panel a center of gravity. The redesign's whole bet rides on whether `lens` can carry that weight.

### "noun-as-noun" grammar

A pattern for how lenses are *phrased*. Specifically the form **"X as Y"** (or "X of Y", "X with Y") where X and Y are both nouns.

```
license  as  eulogy        ← noun as noun
diss     as  block party   ← noun as noun
hometown as  armor         ← noun as noun
speed    as  avoidance     ← noun as noun (avoidance is a gerund, functions as a noun)
```

The alternative (**verb-as-noun**) would describe what the song *does* rather than what it *is*:

```
"outrunning the quiet"                          vs  "speed as avoidance"
"passing a test for someone who isn't there"    vs  "license as eulogy"
"keeping the receipts"                          vs  "anger with receipts"
"turning a verdict into a chant"                vs  "diss as block party"
```

**Why grammar matters at all:** the grammar of a lens encodes a *voice*.

- **Noun-as-noun** reads like a critic saying "this is *really* that" — critical voice, declarative, essayistic. The Pitchfork-review register.
- **Verb-as-noun** reads like a narrator saying "watch what the song *does*" — narrative voice, observational, cinematic. The Genius-annotation register.

Neither is objectively better — they sit on a register dial. The pick shapes how every read sounds. The current choice (noun-as-noun) is a *taste call*, not a derived truth. See section 8 for its status.

### The other schema terms

| Term | What it is | Example |
|---|---|---|
| `image` | The concrete sensory phrase that captures the song in ≤8 words. The "felt-image." Replaces `headline`. | "the long way home, alone this time" |
| `tension` | Two-word **qualified emotion** (modifier + core) naming the song's dominant feeling. **Not required to be a paradox** — the paradox burden lives in optional `contradiction`. Replaces `compound_mood`. *(Recast Session 3; was "paradox", which borrowed `contradiction`'s job.)* | "Aching Disbelief", "Hollow Brightness" |
| `take` | The actual reading — one paragraph (~3 sentences), voice-first, written through the lens. Replaces `interpretation` + `mood_description` merged. | "She passed the test she swore she would pass for him…" |
| `contradiction` | One sentence naming what the song *refuses to resolve*. Optional. Applies the **Pratfall Effect** — admitting tension makes a read more credible than a clean verdict. | "She got everything she wanted. She got it alone." |
| `arc` | The 3-beat structural read (intro → middle → end), each beat with a mood word and a one-line scene. Replaces `journey`. | `Hushed → Overwhelmed → Cathartic` |
| `lines` | Exactly 2 lyric quotes with one-line insights. The receipts. Replaces `key_lines`. | "I got my driver's license like I told you I would" → "A win that only counts as a loss." |
| `texture` | One contrast-ending sentence about how the song sounds. Replaces `sonic_texture`. | "A ballad that grows a spine — sparse piano swells into stacked harmonies and a pounding bridge." |

### The three layers

- **The Read** = Layer 1 of the panel (image + lens + tension)
- **The Take** = Layer 2 (take + contradiction)
- **The Trace** = Layer 3 (arc + lines + texture) — called "trace" because it's the *evidence trail* for the claims made in the read and the take

### What we are actually trying to achieve

The deepest goal in one sentence: **turn a database row into an essay.**

Today's panel renders eight fields as parallel sections. The fields are individually well-written (voice-audit makes sure of that). But together, they read as a database query result — no center of gravity, no organizing perspective, no thesis. That's why it feels robotic even when each sentence is fine.

The redesign attacks that on two fronts:

1. **Strip redundancy from presentation.** Five of the eight existing fields all answer "what's this song about?" at different lengths. Merge them into one `take`, give the panel a thesis (the `lens`), let everything else become evidence. Fewer fields, more coherence.
2. **Move structured signals out of presentation, into a separate matching layer.** `themes`, `theme_tags`, `scenes`, `register`, `address` — these are great for playlist matching but terrible for reading. Keep them on the analysis row, hide them from the panel.

The lens is the load-bearing piece. If the lens concept doesn't carry, neither does anything else.

---

## 3. Required skills (use these proactively)

This work is editorial + IA + creative concepting — not just engineering. Five skills inform it. Use them in this order:

### Active (auto-invokable)

1. **`how-to-make-sense-of-any-mess`** (`/Users/f/.claude/skills/how-to-make-sense-of-any-mess`) — Abby Covert's 7-step framework. The redesign is already past Step 2 (intent stated), Step 3 (reality faced), Step 4 (direction chosen). Step 1 deliverable below is essentially a Covert Step 6 (Play with Structure) artifact: a controlled vocabulary for the `lens` field, which is the new center of gravity. Reach for this skill when stuck on whether a decision is structural or surface.

2. **`information-architecture`** (`/Users/f/.claude/skills/information-architecture`) — Rosenfeld/Morville/Arango 4e. The matching layer is an IA problem: facets, controlled vocabularies, synonym rings → thesauri. The lens vocabulary IS an IA artifact. Use this skill for any controlled-vocabulary or facet-design decision.

### Archived (must be read explicitly — they don't auto-load)

These are at `/Users/f/.claude/skills/archive/`. Read each `SKILL.md` (or equivalent) before applying:

3. **`creative-conceptualist-specialist`** — The lens vocabulary is creative-concept work. The Nine-Step Creative Procedure and the "Analyze → Identify → Violate" framework apply directly. The violation in this work: rejecting category-typical music app tags ("sad," "happy," "melancholic") in favor of essayistic frames a critic would write.

4. **`narrative-strategy-specialist`** — Use for the eventual prompt redesign (Step 3). Each read should follow narrative arc (image = hook, lens = thesis, take = development, contradiction = Pratfall Effect, arc = structural beats). SUCCESs as a quality gate.

5. **`copywriting-ecosystem`** — Use as a sequencing check. Four-layer stack: Strategy → Ideas → Execution → Optimization. We are at the **Strategy → Ideas boundary**. The trap: jumping to Execution (writing the prompt) before the Ideas layer (the lens vocabulary) is locked. This skill tells you when to switch layers.

**Workflow expectation:** when you're about to commit to a structural decision (cardinality enforcement, vocabulary boundaries, prompt order), check which of the five skills should be informing it. Don't proceed if the decision is in a skill's zone and you haven't applied it.

---

## 4. Session map — six conversations, not one

This work is too big for a single session. It decomposes into six focused conversations, each with a clear input, output, and mode. Trying to do more than one mode per session degrades both — engineering mode is bad at editorial, editorial mode is bad at prompt iteration.

| # | Goal | Mode | Reads | Produces |
|---|------|------|-------|----------|
| 0 | UI proof on a dev route (done) | Editorial + UI | — | `src/features/liked-songs/components/concept-panel/*`, `src/routes/dev-song-detail-panel-v3.tsx` |
| 1 (done) | Resolve section 8.4 — lens grammar, Not Like Us translation, architectural hookup | Exploration / present options | Sections 1-6, 8 of this doc | DONE 2026-05-29: lens grammar = closed form-set + free tags (§8.2); NLU translated into new schema (`concept-data.ts`); transformer chosen + deferred (§8.5); `concept-types.ts` tuples widened (§6); session 2 brief written |
| 2 (done) | Draft lens vocabulary (Step 1) | Editorial | Master (with session 1 outcomes), session 2 brief | DONE 2026-05-29: `claudedocs/concept-lens-vocabulary.md` — 77 lenses across 11 families (added SURFACE + journey-capable ARRIVAL per the lyric diagnostic); grammar held across all families (positive evidence for §8.2 item 2, see §8.5); session 3 brief written |
| 3 (done) | Design Zod schema migration (Step 2); resolve arc cardinality shape | Engineering design | Master + lens vocabulary + `concept-types.ts` + `song-analysis.ts` | DONE 2026-05-29: `concept-schema.ts` (`ConceptReadSchema` arc[2,6]/lines[1,5], `SignalsSchema`, `ConceptAnalysisSchema`), `concept-migration.ts` transformer + drafts, `concept-types.ts` now derives from Zod, 14 new tests; migration notes (`session-3-zod-migration-notes.md`); arc shape = Option A + tension recast promoted to §8.2; session 4 brief written |
| 4 (done) | Draft `lyrical-v14.ts` prompt (Step 3) | Prompt iteration | Master + lens vocabulary + new schemas + `lyrical-v13.ts` | DONE 2026-05-29: `prompts/lyrical-v14.ts` (emits the `read` model; lens-first order; all 8 diagnostic recs encoded), registered in `registry.ts` as a **selectable draft** (v13 stays active — `analyzeSong` parse-schema is hardcoded old-shape, cutover is a coordinated Session 5 change); `session-4-prompt-v14-comparison.md` (v13→v14 diff + 4 gold + 3 stress songs reasoned through + 2 enforcement notes); session 5 brief written |
| 5 (done) | Migrate voice-audit (Step 4) | Engineering | Master + new schema + existing voice-audit | DONE 2026-05-29: gold reads promoted to `{ read }` shape + loader re-pointed at `ConceptReadSchema`; Tier-1 rules/stats/report and Tier-2 judges re-pointed to the read model; `journey-narrative`→`arc-narrative`; new `lens-coherence` judge (+ runnable `check-lens-coherence.ts`); generation cutover mechanism added to `analyzeSong` but **left dormant** (v13 still active — the flip ships with Session 6); fixtures+tests migrated (70 voice-audit tests, full suite 1142 green, typecheck clean); session 6 brief written |
| **5.5 (next)** | Calibrate v14 with the eval layer (first empirical contact) | Measurement / prompt iteration | Master + `lyrical-v14.ts` + migrated voice-audit | Generate v14 for real, score vs gold, iterate the prompt to clear quality bars; findings note. Inserted 2026-05-30 — the eval loop was *blocked* until Session 5 re-pointed the jury at the read shape (§8.5); preprod makes pre-launch calibration cheap. |
| 6 | Swap prod panel to ConceptPanel (Step 5) | Engineering / UI | Master + ConceptPanel + prod SongDetailPanel | Production behavior change + the v14 generation flip — after 5.5 proves v14 holds |

**Where we are now.** Session 0 is done. The dev route at `/dev-song-detail-panel-v3` exists. Section 8.4 is staged as Session 1's brief — that question set is the explicit next move.

**Each session ends with the closing protocol** — see section 11. The protocol records decisions back into this master doc and authors the brief for the next session. Skipping it breaks the multi-session chain.

**Why this decomposition is load-bearing.** Each session's output is input to the next: lens vocabulary feeds prompt revision, which feeds voice-audit migration. Trying to do them together would force decisions before their evidence is in hand. The boundary between sessions is also where working assumptions get pressure-tested — every session ends with "did anything I learned push back on the master doc?"

**Per-session briefs are authored at the end of the prior session**, not pre-written. Trying to spec Step 4's brief before Step 1 lands would create work that needs revision. Plan the boxes (this table); let the contents be written when their context exists.

---

## 5. The proposed concept

### 5.1 Why this exists

The prod song detail panel (`src/features/liked-songs/components/SongDetailPanel.tsx` + `detail/PanelContent.tsx`) renders eight analysis fields as parallel sections. The result reads as "piled-up info" — the same content described five times at different abstractions (headline, themes, compound_mood, mood_description, interpretation all answer "what's this song about?"), no organizing perspective, and a hidden mode toggle that buries the most scannable label (`compound_mood`) at the bottom of the deepest layer.

The diagnosis: **the schema is good source material for an essay, but it's being rendered as a dashboard.** The fix is a content-model redesign (presentation surface) plus a parallel matching substrate.

The existing `scripts/voice-audit/` pipeline can't fix this. Voice-audit makes each field well-written individually; it can't make eight redundant fields cohere as one read. That's a schema and IA problem, not a voice problem. **Voice-audit becomes the enforcement layer for the new schema after migration, not a competing solution.**

### 5.2 Schema — presentation layer ("the read")

The schema for what the user reads. Less is more here — redundancy was the original sin.

| Field | Was | Constraint | Purpose |
|---|---|---|---|
| `image` | `headline` | ≤8 words, lowercase first word, no terminal punctuation, concrete sensory phrase | The felt-image of the song |
| `lens` | NEW (extracted from one of `themes[]`) | 2-5 words, noun-as-noun grammar ("X as Y", "X of Y", "X with Y") | The interpretive frame — the new center of gravity |
| `tension` | `compound_mood` | Two-word A+N **qualified emotion** (modifier + core), Title Case ("Tender Resentment", "Hollow Brightness"). Not required to be a paradox — that moved to `contradiction`. *(Recast Session 3.)* | The song's dominant feeling, named precisely |
| `take` | `interpretation` + `mood_description` merged | ~3 sentences, voice-first, second-person reach OK | The actual reading, written through the lens |
| `contradiction` | NEW, optional | One sentence | The Pratfall — what the song refuses to resolve |
| `arc` | `journey` | **4-6 beats typical, follows song structure** (2 for an intro+chorus-only song; 6+ for verse/pre-chorus/chorus/bridge/outro structures). `{label, mood, scene}` | The structural read |
| `lines` | `key_lines` | **3-5 typical, varies per song** (the active prompt v13 already uses 3-5). `{line, insight}` | The lyrical receipts |
| `texture` | `sonic_texture` | One sentence, contrast-ending | The sonic read |

**Cardinality matches the active prompt's contract.** The current generation prompt (`src/lib/domains/enrichment/content-analysis/prompts/lyrical-v13.ts`) already produces 2-4 themes / 4-6 journey beats / 3-5 key_lines. The new schema's `arc` and `lines` should not be *tighter* than what the prompt already does, because that would silently reject coherent generated output. The earlier draft of this handoff specified `arc[3]` and `lines[2]` as strict tuples — that was wrong and has been corrected. **`concept-types.ts` still has the strict tuple types — the next agent should widen them as part of Step 2 (Zod migration), aligning with the v13 ranges.**

**Caveat — `arc[3]` isn't entirely arbitrary.** Three beats is the scannable spine ("Hushed → Overwhelmed → Cathartic" reads in one glance; eight moods don't). One option for Step 2 is to keep `arc[3]` as a *headline* arc rendered in the panel, with an optional `arc_extended[]` (4-6) for songs that need it. Another option is to let `arc` itself be 4-6 and design the panel rendering to gracefully scale (overflow scroll, smaller chips for longer arcs). Decide during Step 2 — note this in section 9 (Open questions).

### 5.3 Schema — matching layer ("signals", separate from presentation)

For computing playlist fit and library cross-references. Hidden from the panel, used by matching.

| Field | Shape | Enables |
|---|---|---|
| `theme_tags[]` | Controlled vocab, 1-3 tags from ~60-100 archetypal themes | "All my breakup songs," "all my hometown songs" |
| `themes[]` | Legacy free-form `{name, description}[]`, kept for human-readable backup | Reading-only fallback |
| `scenes[]` | Controlled vocab, 0-3: `driving`, `late-night`, `gym`, `dinner`, `dancefloor`, `solo-walk` | Situational playlists |
| `address` | Enum: `first-person` \| `second-person-direct` \| `narrator-distant` \| `chorus-we` | "Songs that talk to you" |
| `register[]` | Enum set: `confessional` \| `swaggering` \| `ironic` \| `sincere` \| `playful` \| `liturgical` | "Songs that mean it" vs "songs that wink" |
| `cultural_anchors[]` | Proper nouns (people, places, brands, eras) | Era / geo / scene playlists |
| `eligibility` | Flags: `explicit`, `sleep-safe`, `kid-safe`, `workout-ok`, `dinner-ok` | Hard constraints |
| `tempo_emotion_gap` | Derived float (sonic energy − lyrical valence) | The "sad banger" axis — the highest-value matching signal not in the current schema |
| `intensity_curve` | Derived from `arc[].mood` + `audio_features` | "Songs that build" vs "songs that stay" |

**Key principle:** presentation gets *less* (less redundancy, less clutter). Matching gets *more* (more structured signals). The current schema conflates them, which is why the panel is cluttered AND matching has weak signals.

### 5.4 Presentation direction (UI locked)

Implemented in `src/features/liked-songs/components/concept-panel/ConceptPanel.tsx`. **The UI direction is locked — refine, don't redesign.**

- Three layers, scroll-only, no mode toggle
- Layer 1 (THE READ): hero with album art + artist image + SonicNumbers, then `lens · tension` line, then `image` in 36-40px display serif
- Layer 2 (THE TAKE): `take` paragraph in body font at comfortable reading size, optional `contradiction` set off with accent left-border + italic
- Layer 3 (THE TRACE): `arc` as a clickable mood spine (`Hushed → Overwhelmed → Cathartic`, click to expand each scene), `lines` as click-to-expand italic serif quotes (insight on tap), `texture` as always-visible single line
- Per-song palette via project's existing `getThemedDarkColors(themes[song.theme])` system
- Dev route at `/dev-song-detail-panel-v3` (dev-only, 404 in prod)

The hero in the current version carries chrome (artwork + audio numbers). That's a deliberate balance choice — the read still has to win attention when you scroll past the hero. If you find yourself wanting to make the hero smaller or larger, the question is whether it competes with the read for attention, not whether it's "right" in isolation.

---

## 6. Current state of the codebase

### 6.1 What's in the tree

```
src/features/liked-songs/components/concept-panel/
├── ConceptPanel.tsx              ← the panel UI; locked direction; refine only
├── concept-types.ts              ← UI types; ConceptRead/ArcBeat/LineBeat now re-exported from the Zod schema; ConceptSong local
├── concept-data.ts               ← four hand-written reads (the new gold)
└── concept-artwork.functions.ts  ← server fn for album/artist artwork

src/lib/domains/enrichment/content-analysis/
├── concept-schema.ts             ← NEW (S3): canonical Zod — ConceptReadSchema, SignalsSchema, ConceptAnalysisSchema
├── song-analysis.ts              ← OLD schema (SongAnalysisLyricalSchema); still live for v13 + jury (parse-schema hardcoded, not version-selected)
├── prompts/lyrical-v14.ts        ← NEW (S4): emits the new `read` model; registered as a draft, v13 still active
├── prompts/registry.ts           ← MOD (S4): v14 added to LYRICAL_PROMPTS; ACTIVE_LYRICAL_VERSION still "13"
└── __tests__/concept-schema.test.ts  ← NEW (S3): 14 tests

src/routes/dev-song-detail-panel-v3.tsx
                                  ← dev route with picker + explainer
```

The four hand-written reads in `concept-data.ts` are the **new gold standard** for the schema. They are this project's equivalent of `scripts/voice-audit/exemplars/*.json` for the new shape. Migration of voice-audit (Step 4) will promote them into the audit pipeline.

**Session 1 changes (2026-05-29):**
- `concept-types.ts` — `arc` and `lines` widened from strict tuples (`[Beat,Beat,Beat]` / `[Beat,Beat]`) to variable-length arrays (`ConceptArcBeat[]` / `ConceptLineBeat[]`). TS-only change ahead of the formal Zod migration (Session 3); the doc comment records why. Typecheck passes.
- `concept-data.ts` — the Not Like Us `read` was replaced with the new-schema translation of the user's richer exemplar rewrite: new `image` ("the block party draws the line"), 6 arc beats (was 3), 4 lines (was 2), `lens` = `diss as block party`. Renders at `/dev-song-detail-panel-v3`.
- New: `claudedocs/session-1-resolve-deferred-decisions.md` (this session's brief, now resolved) and `claudedocs/session-2-lens-vocabulary.md` (next session's brief).

**Session 2 changes (2026-05-29):**
- New: `claudedocs/concept-lens-vocabulary.md` — the Step 1 deliverable (77 lenses, 11 families). This is now the controlled vocabulary the prompt v14 (Session 4) and the matching layer will both draw on. No code changed this session (editorial only).
- New: `claudedocs/session-3-zod-migration.md` (next session's brief, with its own `## Start here` paste-prompt).

**Session 3 changes (2026-05-29):**
- New: `src/lib/domains/enrichment/content-analysis/concept-schema.ts` — canonical Zod: `ConceptReadSchema` (arc `[2,6]`, lines `[1,5]`, `tension` plain string, `contradiction` required-nullable, `lens` free string), `SignalsSchema` (matching layer, all fields optional/staged), `ConceptAnalysisSchema = { read, signals }`. Inferred types exported.
- New: `src/lib/domains/enrichment/content-analysis/concept-migration.ts` — pure one-way transformer `transformLegacyToConceptDraft` (legacy 8-field → `{ read, signals }` draft, stubbing `lens`/`contradiction` null, `take` as concat scaffold).
- New: `scripts/voice-audit/transform-legacy-exemplars.ts` + `scripts/voice-audit/exemplars-v14-draft/*.json` — the 4 gold exemplars scaffolded into the new shape (separate dir; the live `exemplars/` stays Zod-bound to the old schema per §8.5).
- Changed: `concept-types.ts` now **derives** `ConceptRead`/`ConceptArcBeat`/`ConceptLineBeat` from `concept-schema.ts` via `z.infer` (single source of truth; UI can't drift from the validated/generated shape). `ConceptSong` stays local.
- New tests: `__tests__/concept-schema.test.ts` (14 tests — gold validation, cardinality envelope, transformer mapping). `bun run test content-analysis` → 57 passing; new files typecheck clean.
- New: `claudedocs/session-3-zod-migration-notes.md` (field-by-field old→new mapping, re-enrich-not-transform strategy, prompt rules the schema implies) and `claudedocs/session-4-prompt-v14.md` (next brief).
- Decision (user-confirmed): **backwards compatibility is NOT required** — old rows re-enrich wholesale via v14, no runtime legacy-read path. The transformer exists only to scaffold gold exemplars.

**Session 4 changes (2026-05-29):**
- New: `src/lib/domains/enrichment/content-analysis/prompts/lyrical-v14.ts` — the Step 3 deliverable. Emits the new `read` model (`ConceptReadSchema`). Iterates from v13: HOW TO WRITE voice block + puffery ban carried verbatim; the 8 old fields replaced by the read fields; **lens-first generation order**; all 8 lyric-diagnostic recommendations encoded as rules (tension=qualified-emotion, elastic take, arc floor 2 / mood-may-repeat, lines floor 1, contradiction-null-when-none, permission-to-be-brief, foreign-language gloss, SURFACE family). The lens spec compresses `concept-lens-vocabulary.md` (three forms, 11 families, abstract-noun kill-list).
- Changed: `prompts/registry.ts` — `lyricalV14` added to `LYRICAL_PROMPTS` so `getLyricalPrompt("14")` resolves. **`ACTIVE_LYRICAL_VERSION` stays `"13"`** because `song-analysis.ts:113-115` selects the parse schema by *modality, not version* — flipping to v14 would feed `read`-shaped JSON into the old `SongAnalysisLyricalSchema` and fail every analysis. The generation-path cutover is a coordinated Session 5 change. `bun run test content-analysis` → 57 passing; `bun run typecheck` clean on the new/changed files.
- New: `claudedocs/session-4-prompt-v14-comparison.md` (v13→v14 diff, all-fields-specced check, 4 gold + 3 stress songs (Forever/Beautiful Things/Pink Pony Club) + DtMF reasoned through the new rules, the activation decision, and 2 enforcement notes for Session 5) and `claudedocs/session-5-voice-audit-migration.md` (next brief).
- Two discoveries surfaced (neither a schema push-back, both Session 5 enforcement notes): (1) the gold `texture` strings use em-dashes that v14's no-dash rule forbids — normalize on promotion; (2) SURFACE is the model's likely abuse vector — the `lens-coherence` judge must check the *song* is thin, not the *read* lazy. Recorded in §8.5.

**Session 5 changes (2026-05-29):**
- **Gold exemplars promoted to the `{ read }` shape.** `scripts/voice-audit/exemplars/*.json` rewritten from `concept-data.ts` (lens/contradiction/take authored in; em-dashes normalized to the no-dash voice rule). `exemplars/index.json` description updated. The loader `exemplars.ts::loadGoldExemplars` now parses `.read` through `ConceptReadSchema` (was `SongAnalysisLyricalSchema`); `GoldExemplar.analysis` → `GoldExemplar.read`.
- **Tier-1 re-pointed to the read model.** `tier1/rules.ts` (`collectStringFields`/`prose`/`burstiness`/`dashes` + all rule signatures → `ConceptRead`), `tier1/report.ts` (`extractAnalysis` now unwraps `{ read }`/`{ analysis }`/bare and detects the read shape; `auditFile` parses `ConceptReadSchema`; legacy/instrumental rows are `skipped: "legacy"`), `stats.ts` (`analysisProse`/`voiceStats` → read prose fields), `types.ts` (`RuleFn` → `ConceptRead`; `isLyricalShape` replaced by `isConceptReadShape`), `experiments.ts` (`RunRecord.analysis` → `ConceptRead`). Field map: `headline→image`, `compound_mood→tension`, `interpretation→take`, `sonic_texture→texture`, `journey→arc`, `key_lines→lines`; the short label fields (`tension`/`lens`/`arc.label`/`arc.mood`) are excluded from `prose` exactly as `compound_mood`/`.section`/`.mood` were.
- **Tier-2 re-pointed + extended.** Four prompts re-pointed (`abstract-noun-trap`→`image`, `essayistic-register`→`take`, `register-specificity`→read prose, and `journey-narrative.ts` **renamed** to `arc-narrative.ts` grading `arc` with a "flat mood is not a failure" clause). New **`lens-coherence`** judge (`tier2/prompts/lens-coherence.ts` + `LensCoherenceSchema`): checks the `take` argues the `lens` (not decorative) **and** the SURFACE-abuse inverse (a thin lens is valid only when the song is thin). `tier2/schemas.ts`: `JourneyNarrativeSchema`→`ArcNarrativeSchema`, added `LensCoherenceSchema`. `tier2/judge.ts` JUDGES array updated; `tier2/pairwise.ts` `renderAnalysis`/`judgePair` render the read; `judge-persona.md` field references updated (headline→image, +lens-as-thesis).
- **Jury consumers re-pointed.** `evaluate.ts` (`g.read`; `loadRuns` guards old runs with `ConceptReadSchema.safeParse`), `build-compare.ts` (`flatten` over read fields; run loader guarded). `regen.ts` made version-aware (v14+ → `ConceptReadSchema`, audits+records the read) and `rescore.ts` guards legacy records. **Clean cut, no backwards compat:** the old `experiments/` corpus + the CLI golden set (`public/landing-songs/*.json`, still 8-field) no longer validate, so they are skipped — a documented audit-blindness window that closes when v14 generation lands (see §8.5).
- **Generation cutover — mechanism shipped, flip deferred.** `song-analysis.ts::analyzeSong` now selects `ConceptReadSchema` when `ACTIVE_LYRICAL_VERSION >= 14` (else `SongAnalysisLyricalSchema`); `buildAnalysisData` widened to accept the read. `ACTIVE_LYRICAL_VERSION` stays `"13"` so the branch is dormant — the actual flip is bundled into Session 6 because the prod panel + queries still read the old shape (comparison-notes §5). 
- **Tests:** fixtures (`clean.json`/`ai-slop.json`) rebuilt in the read shape; `rules.test.ts`/`stats.test.ts`/`tier2-schemas.test.ts` migrated; new `__tests__/exemplars.test.ts` (golds load+validate, no surviving dashes, lens-coherence prompt encodes its checks). New runnable `check-lens-coherence.ts` (LLM-backed acceptance check: 4 golds coherent + 2 broken reads flagged). **`bun run test` → 1142 passing / 8 skipped; `bun run typecheck` clean.**
- New: `claudedocs/session-6-prod-panel-swap.md` (next brief).

**Session 5.5 changes (2026-05-30) — pre-calibration dead-code cleanup (user-directed, ahead of the v14 measurement run):**
- **Removed the abandoned transform-in-place limb.** `concept-migration.ts` (`transformLegacyToConceptDraft`) + its scaffolder `scripts/voice-audit/transform-legacy-exemplars.ts` + the scaffolded `scripts/voice-audit/exemplars-v14-draft/*.json` were deleted. They formed a closed island: the transformer was only consumed by the dead scaffolder and its own tests, and never by any runtime path (confirmed by grep). The project chose hand-authored golds (S5) over mechanical transform, so this branch was built-but-abandoned. The transformer test block was removed from `__tests__/concept-schema.test.ts`; the schema/signals tests remain.
- **Purged the legacy tuning corpus.** All 89 pre-v14 (v2–v13) `experiments/*.json` + `experiments/runs.jsonl` deleted, plus the stale generated `claudedocs/voice-compare/compare.html`. These were the §8.5 "audit-blindness" corpus — already skipped by every loader via `ConceptReadSchema.safeParse`, so invisible to v14 eval; removed for a clean slate before the first v14 run. Safe: `recordRun` recreates the dir + `runs.jsonl` on the next `regen.ts`, and `readRunSummaries` guards with `existsSync`.
- **Kept (verified live):** v2–v12 prompts (registered in `LYRICAL_PROMPTS`, historical comparison points), `build-compare.ts`/`rescore.ts`/`report-experiments.ts`/`merge-annotations.ts` (the migrated compare+rescore toolchain), and `baseline.json` (stale but wired into `cli.ts` — to be *regenerated*, not deleted, once v14 produces new-shape data).
- Verification: `bun run typecheck` clean; `concept-schema` + full `voice-audit` suites 80/80 green. (Full-suite run showed 4 unrelated `PlaylistDetailView` 5s-timeout flakes; that file passes 7/7 in isolation.)

**Pipeline note (confirmed Session 1):** production analyses are generated by the prompt (`lyrical-v13` → future `v14`). The schema serves two consumers — the matching algorithm and the UI panel. The voice-audit exemplars are the gold answer key for the pairwise AI judge, not UI content (see §8.5).

### 6.2 What's NOT yet done

- ~~**Step 1 — Lens vocabulary.**~~ DONE 2026-05-29 (Session 2). `claudedocs/concept-lens-vocabulary.md` — 77 lenses across 11 emotional families, each conforming to the closed three-form set, each with a do-not-use list and a real example. Includes the two families the lyric diagnostic mandated (SURFACE for content-thin songs; a journey-capable ARRIVAL for two-act songs). The structural-move dimension was kept as an orthogonal secondary facet (Covert Step 6 outcome) rather than the primary grouping, because emotional families place the four seeds cleanly and structural moves do not.
- ~~**Step 2 — Zod schema migration.**~~ DONE 2026-05-29 (Session 3). `concept-schema.ts` (`ConceptReadSchema` + `SignalsSchema` + `ConceptAnalysisSchema`), `concept-migration.ts` transformer, `concept-types.ts` now derives from Zod, 14 tests pass. **Migration strategy revised:** backwards compat is *not* required (user-confirmed), so old rows **re-enrich wholesale via v14** rather than transform-in-place — no runtime legacy-read path, no `lens: null` lazy-stub needed at the row level. The transformer scaffolds gold exemplars only. Full field mapping + strategy in `claudedocs/session-3-zod-migration-notes.md`. The new schema is staged but **not yet wired into `SongAnalysisService` generation** — that happens when v14 exists (Session 4).
- ~~**Step 3 — Prompt revision.**~~ DONE 2026-05-29 (Session 4). `prompts/lyrical-v14.ts` emits the new `read` model with lens-first order, the locked three-form lens grammar, the cardinality contracts, and all 8 diagnostic recs. **Registered as a draft; v13 still active** — the parse schema in `song-analysis.ts` is hardcoded old-shape, so the generation cutover (select `ConceptReadSchema` when active version ≥14, flip `ACTIVE_LYRICAL_VERSION`) is a coordinated Session 5 change, bundled with the jury migration. Full diff + reasoning in `claudedocs/session-4-prompt-v14-comparison.md`.
- ~~**Step 4 — Voice-audit migration.**~~ DONE 2026-05-29 (Session 5). Gold exemplars promoted to `{ read }`; loader + both judge tiers + stats + experiment store re-pointed at `ConceptReadSchema`; `journey-narrative`→`arc-narrative`; new `lens-coherence` judge with the SURFACE-abuse backstop; fixtures/tests migrated (full suite 1142 green, typecheck clean). Clean cut — no backwards compat; legacy data is skipped via `safeParse`. The v14 generation flip is staged (dormant in `analyzeSong`) and handed to Session 6. Full detail in §6.1 Session 5 changes + §8.5.
- **Step 5 — Prod panel swap.** Replace `SongDetailPanel.tsx` content path with the concept panel, **and flip `ACTIVE_LYRICAL_VERSION` to `"14"`** (the parse-schema selection is already version-aware). Last step, only after schema + prompt + voice-audit are solid — they now are.

---

## 7. Step 1 — Lens vocabulary spec

**Goal.** A controlled vocabulary for the `lens` field that anchors the prompt at generation time and the matching layer at retrieval time.

**Deliverable.** `claudedocs/concept-lens-vocabulary.md` containing:

- ~60-100 archetypal lens shapes
- Grouped into ~10 families (suggested starting set: DEFIANCE, GRIEF, ESCAPE, ARRIVAL, CONFESSION, REVENGE, AMBIVALENCE, COMMUNITY, OBSESSION, DECAY — these are starting points, not gospel)
- For each lens: short phrase (the lens itself) + 1-sentence elaboration of what kind of song it fits + 1-2 example songs (real ones, not invented)
- Grammar standard: **noun-as-noun by default** ("X as Y", "X of Y", "X with Y"). Document the alternative verb-as-noun grammar ("outrunning the quiet", "passing a test for someone who isn't there") as a *rejected* path, with reasoning — it reads too narrative for Hearted's critical voice. Each family note should confirm the grammar holds.

Reference exemplars (already in `concept-data.ts`, all four families should be present in your vocabulary):

| Song | Lens | Family (proposed) |
|---|---|---|
| drivers license | `license as eulogy` | GRIEF |
| Not Like Us | `diss as block party` | DEFIANCE |
| Motion Sickness | `anger with receipts` | AMBIVALENCE |
| Blinding Lights | `speed as avoidance` | ESCAPE |

**Process suggested by the skills:**

1. **Creative Conceptualist Nine-Step Procedure** — write the problem in one sentence ("the lens vocabulary must let a critic place any song into one of ~60 frames without dilution into vague mood tags"). Then run Analyze → Identify → Violate: what would the category-typical music-app vocabulary look like (genres, moods, themes-as-keywords)? The violation is to make lenses essayistic, not classificatory.

2. **IA controlled-vocabulary discipline** — apply the synonym ring → thesaurus escalation. For each family, list the lenses, then list "do-not-use" near-synonyms that would dilute. The don't-use list is usually more powerful than the use list.

3. **Covert Step 6 (Play with Structure)** — try at least two groupings (emotional families like above vs structural families like "the song moves toward / away / inside"). Pressure-test each against the four exemplar lenses. Pick the grouping that places all four exemplars naturally.

**Acceptance tests for the deliverable:**

- A human editor can write a new lens for a 5th song in under 5 minutes by browsing the vocabulary.
- Two editors writing lenses independently for the same song would land in the same family >80% of the time (inter-rater reliability proxy).
- All four exemplar lenses fit cleanly into a single family, no awkward overlaps.
- Each family has at least 4 lenses; no family has more than 12 (signals over-broad family).

**When this is done, we are ready for Step 2 (Zod schema migration).**

---

## 8. Working assumptions and the truly locked direction

Two categories. Be careful not to conflate them.

### 8.1 Truly locked — sensory evidence, do not redesign

The user has seen and approved this. Refine within it; do not rebuild it.

1. **The UI direction.** The three-layer panel in `ConceptPanel.tsx` (Read → Take → Trace, scroll-only, no mode toggle, hero with artwork + SonicNumbers). The user described it as "directionally right." If something feels off, dial it (typography size, hero height, spacing); don't rebuild the layout or change the layer order.

### 8.2 Working assumptions — argumentative evidence, treat as starting points

These were proposed and debated in this conversation. They feel right at this stage, but they have *not* been pressure-tested against generated outputs at scale. Stay open. Revisit if Step 1 or later steps surface evidence against any of them.

1. **The schema redesign is the right move.** Working assumption: voice-audit can't fix the presentation problem alone because no Tier-2 judge can ask "do these eight fields cohere as one read?" Revisit if you find a way to express whole-panel coherence as a voice-audit rule that doesn't require a schema change.
2. **Lens grammar is a closed three-form set; tags are a separate free-grammar facet.** *(Resolved 2026-05-29, Session 1 — was "noun-as-noun, not verb-as-noun".)* The `lens` uses exactly one of three forms, writer's choice per song: `X as Y` (noun-as-noun, critical), `X into Y` (transformation), `Verb-ing the X` (gerund-action, narrative). Bare noun phrases are **excluded from the lens** — they are the category-typical tag the lens exists to violate (Creative Conceptualist's Analyze→Identify→Violate). Separately, matching-layer `theme_tags[]` / `themes[]` are free bare-noun phrases, lowercase with spaces, **no hyphenation** (`community defense`); the lens form-set does not govern them. This is an IA facet-independence call: the apparent "noun-as-noun pushback" from the NLU rewrite was *theme*-grammar evidence, not *lens*-grammar evidence (see §8.5). **Revisit if** the closed form-set proves too tight for a real song family in Session 2, or if generated lenses drift toward bare-noun slop at scale.
3. **Themes stay as `themes[]` (legacy) PLUS new structured `theme_tags[]`.** Working assumption: keep the free-form `themes[].name` for human reading, add a controlled-vocab `theme_tags[]` for matching joins. Revisit if `theme_tags[]` ends up duplicating the lens vocabulary's job (in which case drop themes from presentation entirely and let lens carry both surfaces).
4. **Option A: lock concept first, migrate voice-audit second.** Working assumption that sequential is cleaner than parallel. Revisit if voice-audit drift during the migration window becomes a real problem (track audit-blindness duration).
5. **Presentation and matching schemas split into separate sub-objects on the analysis row.** Working assumption that splitting them is clarifying. Revisit if the prompt naturally generates them together and the split adds friction without payoff. *(Session 3 encoded this as `ConceptAnalysisSchema = { read, signals }`; did nothing to push back on it.)*
6. **`arc` is a single variable-length array, Zod-bounded `[2, 6]`, `mood` may repeat.** *(Resolved 2026-05-29, Session 3 — user picked Option A over the headline-spine + `arc_extended` split.)* The scannability concern that motivated the split is a **rendering** refinement (smaller chips / scroll for long arcs, Session 6), not a schema concern. Floor of 2 + repeatable `mood` lets monochrome songs (Beautiful Things) avoid manufactured movement. Cardinality philosophy locked: **Zod is the permissive envelope, the prompt is the narrower target** — Zod floors are looser than the prompt, ceilings equal, so coherent output is never rejected. `lines` bounded `[1, 5]` by the same rule. **Revisit if** generated arcs routinely hit the ceiling (suggests the cap is wrong) or if the panel can't render 6 beats without crowding (a rendering fix, not a schema change).
7. **`tension` is a qualified emotion (modifier + core), not a paradox.** *(Resolved 2026-05-29, Session 3, per the lyric diagnostic.)* "Hollow Brightness" is a qualified emotion, not a contradiction; the paradox burden lives in optional `contradiction`. Zod types `tension` as a plain `string` (the two-word A+N shape is a prompt rule). §2 glossary and §5.2 table corrected. **Revisit if** generated tensions drift back toward restating the contradiction.
8. **`lens` is a free Zod `string`, never a regex/enum.** *(Confirmed Session 3, inherited from Session 1.)* The closed three-form grammar is enforced in the prompt and the future `lens-coherence` jury, not in Zod — a regex would reject valid lenses (vocabulary §3). The controlled vocabulary is the list the prompt draws from, not a closed type. Same for `contradiction` (required key, nullable value — forces explicit `null` over silent omission).

### 8.3 What "revisit" means

If you find evidence pushing back on any 8.2 item, do not silently override. Document the evidence in this file (add a new subsection "8.5 Evidence against working assumption N") and surface it to the user before changing direction. Working assumptions are cheap to revise *with new evidence*; they shouldn't be revised on a hunch.

### 8.4 Questions queued for the next session (active or recently resolved)

**Active questions live in the session brief**, not here. This subsection is the *index* of what's queued or what's recently been resolved.

**Resolved by Session 1 (2026-05-29)** — full option discussions remain in `claudedocs/session-1-resolve-deferred-decisions.md`:

1. **Lens grammar** — RESOLVED: closed three-form set for the lens (`X as Y` / `X into Y` / `Verb-ing the X`) **plus** free bare-noun-phrase tags as a separate facet, no hyphenation. Promoted to §8.2 item 2. (User picked "B + C, no hyphenation".)
2. **Translating the rewritten Not Like Us** — RESOLVED: Option D (hybrid), and *executed this session*. The richer NLU rewrite (6 arc beats, 4 lines, new image) was folded into the new schema and now renders in `concept-data.ts`. `lens` = `diss as block party` (alternates `insult into anthem`, `dancing on the verdict` noted for one-line swap). Required widening `concept-types.ts` tuples (see §6).
3. **Hooking concept-data.ts to exemplars** — RESOLVED: Option B (one-way transformer). **Build deferred** to Session 2/3 because the new Zod shape isn't locked and exemplars are Zod-bound to the old `SongAnalysisLyricalSchema` (see §8.5). Tracked as a deferred task in the Session 2 brief.

**Why the brief, not this section, holds the full decision specs:** keeping option-sets here would mean every future session's questions accumulate in the master and the master grows unbounded. The brief file is a per-session working surface; the master is the strategic source of truth.

<!-- Original 8.4 detailed content has moved to:
     claudedocs/session-1-resolve-deferred-decisions.md
     The decision specs (3-4 options each) live there. -->

#### Placeholder — content moved

The three decision specifications (formerly 8.4.1, 8.4.2, 8.4.3) live in the Session 1 brief at `claudedocs/session-1-resolve-deferred-decisions.md`. See sections "Decision 1", "Decision 2", "Decision 3" of that file.

### 8.5 Evidence that revised a working assumption

**(2026-05-29, Session 1) — the "noun-as-noun pushback" was a facet confusion.** The master originally treated the user's Not Like Us rewrite as evidence against noun-as-noun lenses, because the rewrite used bare noun phrases (`community defense`, `moral indictment`, `west coast claim`). On inspection, those phrases were `themes[]` entries — they feed the matching-layer `theme_tags[]`, a *different facet* from the `lens`. The lens in the same NLU read was still noun-as-noun (`diss as block party`). The user also confirmed the edit was casual ("the edit was simple, idk"), not a deliberate grammar mandate. IA facet-independence resolved it: lens and tags are separate controlled vocabularies that may legitimately use different grammars. Outcome: lens keeps an essayistic closed form-set; the bare-noun instinct lives in tags where taxonomic phrasing belongs. No verb-as-noun-only or bare-noun-only path was adopted.

**(2026-05-29, Session 2) — the closed three-form set held across all 11 lens families (confirms §8.2 item 2).** Drafting 77 lenses across 11 emotional families did not require a fourth grammatical form. Every lens fits Form 1 (`X as/of/with Y`, critical), Form 2 (`X into Y`, transformational), or Form 3 (`Verb-ing the X`, narrative). Form 3 carried the load in the new SURFACE family — naming what a content-thin song *does* is how the vocabulary avoids fabricating depth on it, which is the over-prescription failure §9 item 5 warned about. Two idiomatic implied-`as` cases surfaced (`the sad banger`, `the slow fade`); they are accepted Form-1 exceptions, not a new form, and the prompt should prefer fully-connected forms. This is positive evidence for the working assumption, not a push-back — the §8.2-item-2 "revisit if the closed form-set proves too tight" trigger did **not** fire. Separately, the master's §5.2 connector set (`as`/`of`/`with`) and Session 1's `X as Y` shorthand were reconciled in the vocabulary's grammar section: they name the *same* Form 1, with `of`/`with` as its associative connectors — so the seed `anger with receipts` is valid Form 1, not a fourth form.

**(2026-05-29, Session 1) — exemplars are Zod-bound to the old schema.** Discovered while resolving Decision 3: `scripts/voice-audit/exemplars.ts` (`loadGoldExemplars()`) parses every exemplar through `SongAnalysisLyricalSchema` — the current 8-field schema — and those golds anchor the pairwise AI judge (`evaluate.ts`) plus a human compare view (`build-compare.ts`). Consequence: new-schema fields (`lens`, `contradiction`, the reshaped `arc`) **cannot** live in the exemplar JSONs until the Zod migration (Session 3) without breaking the jury loader. This hard-confirms Decision 3 = Option B (transformer to a separate artifact) over Option C (migrate exemplars in place), and is why the transformer *build* is deferred to Session 2/3.

**(2026-05-29, Session 4) — two prompt-side findings, neither a schema push-back.** Drafting v14 surfaced two things, both recorded here per §8.3 and carried into the Session 5 brief as enforcement tasks (not schema/vocab/grammar changes — the §8.2 working assumptions all held):
1. *The gold `texture` strings violate the locked no-dash voice rule.* Three of the four hand-written reads in `concept-data.ts` punctuate the texture's contrast with an em-dash ("A ballad that grows a spine — …"). v13's no-dash rule is locked and proven, so v14 produces the contrast with a comma or a second sentence. When the golds are promoted to voice-audit exemplars (Session 5), their dashed strings must be normalized or they will fail the Tier-1 dash rule they are meant to anchor. This is gold-exemplar hygiene, not a schema or prompt defect.
2. *SURFACE is the model's likely abuse vector at scale.* The prompt routes to the SURFACE lens family only when no buried claim exists, but a prompt cannot fully enforce "did you actually look?". The inverse of the original problem — a *deep* song lazily tagged SURFACE (Beautiful Things is the canonical trap) — needs the `lens-coherence` judge (Session 5) to check the *song* is thin, not the *read* lazy. Already flagged in `concept-lens-vocabulary.md` §10; reaffirmed by the v14 reasoning.

**(2026-05-29, Session 4) — the activation cutover is coordinated, not a version bump.** `song-analysis.ts:113-115` selects the parse schema by *modality* (lyrical vs instrumental), **not by prompt version**, then validates LLM JSON against it. So promoting v14 cannot be done by flipping `ACTIVE_LYRICAL_VERSION` alone — the generation path must also learn to parse `ConceptReadSchema`, and the jury must move with it (it is still old-schema, §8.5 above). v14 therefore ships registered-but-inactive; the cutover is bundled into Session 5 alongside the voice-audit migration.

**(2026-05-29, Session 5) — the clean cut creates a bounded audit-blindness window (relates to §8.2 item 4).** Migrating the audit pipeline to `ConceptReadSchema` with no backwards-compat means the existing data that the pipeline used to consume — the ~100 stored `experiments/*.json` runs and the 20 production `public/landing-songs/*.json` files in `golden/index.json` — are all still the legacy 8-field shape and no longer validate. Rather than crash, every disk loader now guards with `ConceptReadSchema.safeParse` and skips non-conforming rows (`evaluate.ts`, `build-compare.ts`, `rescore.ts`, `tier1/report.ts`, `tier2/judge.ts`). Consequence: the deterministic CLI (`cli.ts` over the golden set), `evaluate.ts`, and `build-compare.ts` have **no data to operate on** until v14 generation produces new-shape rows — and `baseline.json` is now stale (it was computed over the old golden set; regenerate with `--baseline` once new-shape golden files exist). This is the §8.2-item-4 "audit-blindness during the migration window" cost, made explicit and time-boxed: it closes the moment the Session 6 generation flip re-enriches songs through v14. The §8.2-item-4 trigger ("track audit-blindness duration") therefore fires *informationally* — it is expected and accepted, not a push-back.

**(2026-05-29, Session 5) — gold-exemplar hygiene: a participial closure survives in a locked gold.** While migrating, the promoted `drivers-license` gold's `lines[1].insight` ("Heartbreak does its worst work in the imagination, casting the exact scene it dreads.") was found to trip the Tier-1 `participial-closure` rule (high severity) — the comma+gerund construction v13/v14 forbid. This string is verbatim from the locked `concept-data.ts` (Session 0) and predates the rule being applied to insight fields; it was never linted before because **golds anchor the pairwise judge, not the deterministic Tier-1 linter** (golds are the "good" reference, not linted candidates). Per §8.3 this is surfaced, **not silently rewritten** — the Session 4 dash-normalization was an explicit brief instruction, whereas this is a new discovery on a locked artifact. **Decision queued for the user / Session 6:** either (a) accept that golds are not Tier-1-gated (only the dash rule was required of them on promotion), or (b) normalize this insight to a non-participial form in both `concept-data.ts` and `exemplars/drivers-license.json`. The migration did NOT change the gold's wording. (The `lens-coherence` judge's SURFACE-abuse check, comparison-notes §6.2, became load-bearing and is now encoded — that was the planned outcome, not a push-back.)

---

## 9. Open questions to revisit (genuinely open)

These are not blockers for Step 1 but should be answered before Step 2 (Zod migration).

1. **`texture` placement.** Currently Layer 3. Alternative: a one-line wrapper *above* the image, setting the sonic scene before the lens lands. Worth A/B'ing in mockup form once the lens vocabulary exists.
2. ~~**Cardinality enforcement and shape.**~~ RESOLVED 2026-05-29 (Session 3). (a) `arc` is variable-length, Option A (no headline/extended split) — user-confirmed; promoted to §8.2 item 6. (b) Enforced in **both, by layer**: Zod as the permissive envelope (`arc [2,6]`, `lines [1,5]`), the prompt as the narrower target (4–6 / 3–5 on rich songs, floors permitted on thin ones). `concept-types.ts` now derives from the Zod schema, so the strict-tuple problem is gone.
3. **`theme_tags` generation strategy.** Free-form-then-classified (model writes a phrase, post-processor maps to controlled vocab) or pick-from-list (model picks 1-3 from the curated 60-100)? Recommendation pending: hybrid — free-form lens phrase plus auto-classification to one of N archetypes, store both.
4. **Playlist matching placement in the panel.** Stays as the bottom section, or moves closer to the read (e.g., "3 of your playlists want this lens →") to make the lens earn its keep? Lower-priority; revisit after Step 2.
5. **Schema over-prescription on surface-true songs.** *(Raised 2026-05-29, Session 1; extended same day to 10 songs; evidence in `claudedocs/schema-overprescription-lyric-diagnostic.md`.)* A lyric diagnostic on 10 songs (4 paradox-poor originals + 6 new spanning depth, archetype, language, and valence/energy quadrants) confirmed and refined the core finding. Schema fitness scales primarily with interpretive depth; two secondary moderators cause partial failures even on deep songs: (1) **structural movement** — `arc` fails on emotionally monochrome songs (Beautiful Things: real depth, single register, no movement) even when the song has genuine content; (2) **interpretive singularity** — `lens` fights narrative/journey songs (Pink Pony Club) where the two-act structure resists a single noun-as-noun thesis. Two new over-prescription patterns surfaced that the original 4 English songs couldn't expose: **Pattern A** — foreign-language `lines` gap (DtMF: schema has no quoting convention for non-English lyrics); **Pattern B** — narrative structure vs. single-thesis lens (Pink Pony Club: `arc` thrives, `lens` partial). Meta-finding **reaffirmed** with refinement: depth is the primary driver, but arc fails on monochrome-register songs regardless of depth, and lens needs a journey/arrival family for two-act songs. **Decisions queued:** (a) recast `tension` as qualified-emotion, not paradox (Session 3/4); (b) elastic `take` length 1-3 sentences (Session 4); (c) lens vocabulary needs TWO new families: "descriptive/surface" for content-thin songs AND "journey/arrival" for narrative songs (Session 2); (d) cardinality floors `arc` >= 2 / `lines` >= 1, `mood` may repeat (Session 3); (e) prompt rule granting explicit permission to be brief and flat (Session 4); (f) foreign-language `lines` quoting convention — quote original + parenthetical English gloss (Session 4 prompt rule, no schema change needed). Also: master §2 glossary calls `tension` a "paradox" — fix, since that borrows `contradiction`'s job. **Closed in Session 3:** (a) `tension` recast as qualified-emotion (§8.2 item 7); (d) cardinality floors `arc ≥ 2` / `lines ≥ 1`, `mood` may repeat (§8.2 item 6); §2 glossary + §5.2 table fixed. **Still queued for Session 4 (prompt):** (b) elastic `take`, (c) surface-family already exists in the vocabulary, (e) "permission to be brief/flat" rule, (f) foreign-language `lines` convention — all carried into the Session 4 brief.

---

## 10. How to engage (orientation steps)

Before drafting anything, read these in order:

1. **The proposed concept** — `src/features/liked-songs/components/concept-panel/` (all four files). This IS the concept; everything else is downstream of it.
2. **The dev route** — `src/routes/dev-song-detail-panel-v3.tsx`. Run `bun run dev` and open http://127.0.0.1:5173/dev-song-detail-panel-v3 to see the panel in motion.
3. **The source exemplars** — `scripts/voice-audit/exemplars/{drivers-license,not-like-us,motion-sickness,blinding-lights}.json`. The 8-field shape we're migrating *from*. Compare against `concept-data.ts` (the new shape) to see what changed and why.
4. **The audit pipeline** — `scripts/voice-audit/types.ts`, `tier1/rules.ts`, `tier2/schemas.ts`. The existing voice quality system. Step 4 migrates this. Read now so you understand what's already enforced and won't reinvent it.
5. **The active prompt** — `src/lib/domains/enrichment/content-analysis/prompts/lyrical-v13.ts` and `registry.ts` (which selects which version is active; currently v13). This is the source of truth for current generation rules: cardinality ranges (themes 2-4, journey 4-6, key_lines 3-5), voice constraints (no "this is" openers, no comma+gerund, no dashes), and field order. **Step 3 (prompt revision) iterates from here, not from scratch.** Most of the redesign's voice rules are already encoded in v13 — what's actually new is the schema reshape and the lens constraint.
6. **This handoff again**, now with codebase context loaded.

Then:

7. Load the **five skills** (the two active ones will auto-trigger; explicitly read the three archived ones at `/Users/f/.claude/skills/archive/`).
8. **Address section 8.4 first.** Three decisions are queued for the next conversation, framed as options-not-verdicts. Present 3-4 options per question to the user using the skills; let the user pick. Once they're resolved, then move to Step 1 (lens vocabulary).

---

## 11. How to end a session (closing protocol)

Every session ends with the same protocol. Skipping this breaks the multi-session chain: the master doc rots, the next session starts cold without context, and decisions get re-litigated.

**When to run this protocol** — two triggers:

- **Goal met.** The session's brief states a goal. When that goal is reached (all listed deliverables produced, or all listed decisions resolved), trigger the protocol *immediately*. Don't wait for the user to ask. Announce closure proactively.
- **User signals stop.** If the user says "pause", "continue later", or otherwise indicates they want to stop, still run the protocol. Mark any unfinished items as explicitly deferred (in master §8.4 or wherever the work was queued) with a one-line reason and the date.

Both triggers run the same checklist below. The difference is just whether the work is complete or partial — in either case, the master doc must end in a clean, navigable state.

### 11.1 Update the master handoff

Before declaring the session done, update *this file*:

- If any decision in section 8.4 was resolved, **move the question from 8.4 into either 8.2** (now a working assumption) or 8.1 (now truly locked, sensory evidence). Note the date and the conversation that decided it.
- If new evidence pushed back on a working assumption (per the 8.3 protocol), add or update subsection 8.5 documenting the evidence and what changed.
- Update section 6 (Current state of the codebase) to reflect what files now exist or have been modified.
- Update section 4 (Session map) — mark this session's row as done; note any deviation from the planned scope.
- Update section 12 (Project conventions) if the session learned something about how the project actually works that wasn't captured.

### 11.2 Write the next session's brief

Author a focused brief for the next planned session at `claudedocs/session-N-{topic}.md` (e.g., `session-2-lens-vocabulary.md`). The brief must contain:

- **Goal** — one sentence
- **Inherited decisions** — what the prior session(s) decided that this session relies on
- **What to read** — specific files plus specific sections of the master doc (don't say "read the whole master"; point at the few sections that matter)
- **What to produce** — the deliverable, with acceptance criteria
- **Which skills apply most directly** — name 1-3 of the five; explain briefly why each
- **Out of scope** — what this session is explicitly *not* doing, so the agent doesn't scope-creep

Do NOT pre-write briefs for sessions beyond the next one. They will need revision once your session's outcomes are known.

### 11.3 Save the file changes

Both the master doc and the new session brief are scratch context for future sessions. Save them. The user's commit preferences govern whether to commit immediately — at minimum, leave them staged so the next session sees them.

### 11.4 Hand off cleanly

End the session by writing the next session's paste-prompt at **the top of the next session's brief file** (the same pattern used by the "Start here" section at the top of this master). The paste-prompt references the master doc + the session brief, like:

```
I'm continuing the Hearted song-analysis redesign.
Master: claudedocs/concept-redesign-handoff-2026-05-28.md
This session: claudedocs/session-N-{topic}.md

Read both, then execute the brief.
```

Don't dump the whole master into the paste-prompt — point at it instead. The next session reads it cold and is fine.

**Pattern to maintain:** every session brief file starts with a `## Start here` section containing the paste-prompt. The user copies from there. This means they never have to invent or remember the prompt — it's always at the top of the next file.

### 11.5 The session-end checklist

Before declaring done, confirm:

- [ ] Decisions made in this session are reflected in the master doc (8.4 → 8.2 / 8.1, or new 8.5 entries)
- [ ] Master doc's section 6 (Current state) reflects new or modified files
- [ ] Master doc's section 4 (Session map) marks this session done
- [ ] Next session's brief is written, focused, and reads cleanly cold (would a fresh agent understand the goal in under 5 minutes?)
- [ ] Paste-prompt for next session is provided to the user
- [ ] No half-finished work is left undocumented — either the work is complete, or the master doc records what's incomplete and why (so the next session can pick up cleanly)

---

## 12. Project conventions (from CLAUDE.md)

- **Use bun, not npm.** Tests are `bun run test` (vitest).
- **No barrel exports.**
- **No emojis in code or files** unless explicitly requested.
- **Comments explain WHY only.** Never section dividers or restate-code.
- **Analysis notes → `claudedocs/`.** This file is an example. Step 1's deliverable goes there.
- **Read files before Edit/Write.**
- **Date check:** confirm current date via `<env>` before any temporal assessment.
- **The required skills `tanstack-start-react`, `react-best-practices`, `web-interface-guidelines`** apply for any UI work. Step 1 is mostly editorial, but Steps 3-5 touch UI.

---

## 13. Success criteria for the whole project (not just Step 1)

When this redesign is done, the following should be true:

- The song detail panel reads as one critic's voice on a song, not a pile of fields.
- A song's `lens` value tells you what kind of reading you're about to get, in under a second.
- A listener can browse their library by lens or tension as facets.
- Playlist matches can quote the lens as their justification ("this fits *Friday Night Solo Drive* because of its 'speed as avoidance' lens").
- Voice-audit catches drift in the new schema as effectively as it catches it in the old.
- A new song's analysis at scale (the 1,000th song, not the 10th) still reads as Hearted's voice — because the lens vocabulary, the schema constraints, and the audit rules together prevent regression.

**The kill-switch:** if at any point during Steps 1-5 the work reveals the concept doesn't hold at scale (e.g., lens values trend abstract within the first 100 generated songs even with vocabulary control), stop and revisit. The concept was validated on 4 hand-written reads — that's a useful proof but not a guarantee. Look for the failure signals (lens slop, take redundancy creeping back, matching axes that don't get used) and treat them as data, not noise.
