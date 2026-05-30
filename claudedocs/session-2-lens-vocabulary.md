# Session 2 — Draft the Lens Vocabulary (Step 1)

## Start here

Open a fresh Claude Code session in this repo and paste:

```
I'm continuing the Hearted song-analysis concept redesign.
Master: claudedocs/concept-redesign-handoff-2026-05-28.md
This session: claudedocs/session-2-lens-vocabulary.md

Read both files, then execute this brief — draft the lens vocabulary
(master §7) using the five required skills. The grammar is already
decided (see Inherited decisions below); your job is the vocabulary
itself, not to relitigate the grammar.
```

---

## Goal

Produce `claudedocs/concept-lens-vocabulary.md` — the controlled vocabulary for the `lens` field (master §7). This is the Ideas-layer artifact that anchors the prompt at generation time and the matching layer at retrieval time. It must hold up to the master's four acceptance tests (§7).

## Inherited decisions (locked by Session 1, 2026-05-29 — do not relitigate)

1. **Lens grammar = closed form-set.** The lens uses exactly one of three forms, writer's choice per song:
   - `X as Y` (noun-as-noun — critical/essayistic)
   - `X into Y` (transformation)
   - `Verb-ing the X` (gerund-action — narrative/cinematic)
   Bare noun phrases (`community defense`) are **excluded from the lens** by design — they are the category-typical tag that the lens exists to violate. Every family in the vocabulary must confirm its lenses fit one of these three forms.

2. **Matching-layer tags are a separate facet with separate grammar.** `theme_tags[]` / `themes[]` are free bare-noun phrases, authored and displayed **lowercase with spaces, no hyphenation** (`community defense`, `moral indictment`). Canonical form has no hyphens; a join-key slug is derived under the hood only if matching needs it. The lens grammar (form-set above) does NOT apply to tags. This is the IA facet-independence call that dissolved the apparent "noun-as-noun pushback."

3. **The four `concept-data.ts` lenses are SEEDS for this vocabulary, not outputs of it.** `license as eulogy` (GRIEF), `diss as block party` (DEFIANCE), `anger with receipts` (AMBIVALENCE), `speed as avoidance` (ESCAPE) already exist and already fit the form-set. Build the families outward from these four; all four must land cleanly in a single family each (acceptance test, §7).

## New facts learned in Session 1 (carry forward)

- **Exemplars are the AI jury's answer key.** `scripts/voice-audit/exemplars/*.json` are loaded by `loadGoldExemplars()` and anchor the **pairwise judge** (`evaluate.ts` computes win-rate vs. gold) plus a human compare view (`build-compare.ts`). They are validated through `SongAnalysisLyricalSchema` — the **old 8-field Zod schema**. Consequence: new-schema gold cannot live in the exemplar JSONs until the Zod migration (Session 3). Keep this in mind — the lens vocabulary will eventually feed a new `lens-coherence` jury judge (master §6.2, Step 4), which does not exist yet.
- **`concept-types.ts` tuples were widened** (`arc`/`lines` are now `ConceptArcBeat[]` / `ConceptLineBeat[]`, no longer strict 3/2 tuples). This was a TS-only change ahead of the formal Zod migration. The Zod shape is still Session 3's job.
- **Surface-true songs break the essayistic assumption** (`claudedocs/schema-overprescription-lyric-diagnostic.md`, now extended to 10 songs). The lyric diagnostic surfaced two specific lens families the vocabulary must include, each with lyric evidence:
  - **A "descriptive/surface" register** — for content-thin songs (a dance-punk chant like No Sex For Ben has no interpretive frame). Without it the model fabricates depth.
  - **A "journey/arrival" family** — for two-act narrative songs (Pink Pony Club: Tennessee → West Hollywood). A single noun-as-noun thesis can't hold both acts; the `arc` thrives but the `lens` is under-specified. Needs frames like "leaving as homecoming" / "escape into belonging" that hold both directions.
  Also note a non-vocabulary item flagged by the diagnostic: **foreign-language songs** (DtMF, sung in Spanish) need a `lines` quoting convention (original + parenthetical gloss). That is a Session 4 prompt rule, not a vocabulary task — but the lens phrase itself should be written in English regardless of source language; confirm that in the vocabulary's grammar notes.

## What to read

- Master **§7** (the lens vocabulary spec — your acceptance tests and suggested process live here)
- Master **§2** (glossary — `lens`, the grammar entry) and **§8.2** (now-updated working assumptions)
- `src/features/liked-songs/components/concept-panel/concept-data.ts` (the four seed lenses, including the updated Not Like Us read)
- `src/lib/domains/enrichment/content-analysis/prompts/lyrical-v13.ts` (the active prompt's voice rules and cardinality ranges — the vocabulary must not fight these)
- `scripts/voice-audit/tier2/prompts/abstract-noun-trap.ts` and `essayistic-register.ts` (existing jury rules the vocabulary should reinforce, not contradict)

## What to produce

`claudedocs/concept-lens-vocabulary.md` containing (per master §7):

- ~60-100 archetypal lens shapes, each conforming to the three-form set
- Grouped into ~10 families (starting set: DEFIANCE, GRIEF, ESCAPE, ARRIVAL, CONFESSION, REVENGE, AMBIVALENCE, COMMUNITY, OBSESSION, DECAY)
- For each lens: the phrase + which of the three forms it uses + 1-sentence "what kind of song it fits" + 1-2 real example songs
- For each family: a **do-not-use** list of near-synonyms that would dilute (IA synonym-ring discipline — the don't-use list is usually more powerful than the use list)
- A short note confirming the grammar holds across each family

**Acceptance tests (from master §7):**
- A human editor can write a lens for a 5th song in <5 minutes by browsing the vocabulary
- Two editors writing lenses independently for the same song land in the same family >80% of the time
- All four seed lenses fit cleanly into a single family, no awkward overlaps
- Each family has ≥4 lenses; no family has >12

## Which skills apply most directly

1. **`creative-conceptualist-specialist`** (archived, read it) — the Nine-Step Procedure to generate the vocabulary, and Analyze→Identify→Violate to keep lenses essayistic rather than classificatory. This is the core engine for the session.
2. **`information-architecture`** (auto) — synonym-ring → thesaurus escalation for the do-not-use lists; the vocabulary IS a controlled-vocabulary artifact. Use for family boundaries and dilution control.
3. **`how-to-make-sense-of-any-mess`** (invoke explicitly) — Covert Step 6 (Play with Structure): try at least two groupings (emotional families vs. structural "moves toward/away/inside") and pressure-test each against the four seed lenses before committing.

## Out of scope for this session

- Designing the Zod schema or migrating `AnalysisContent` (Session 3)
- Building the one-way transformer (deferred from Session 1 — do it in Session 2 only if it unblocks vocabulary work; otherwise Session 3 alongside the Zod migration)
- Writing prompt v14 (Session 4)
- Migrating voice-audit / adding the `lens-coherence` judge (Session 5)
- Any UI change beyond the NLU read already in place (Session 6)

## Deferred from Session 1 (pick up when appropriate)

- **Build the one-way transformer** (Decision 3, Option B): reads old-schema exemplar JSONs, maps to the new shape (headline→image, compound_mood→tension, interpretation+mood_description→take, journey→arc, key_lines→lines, sonic_texture→texture), stubs `lens`/`contradiction` for hand-authoring. Deferred because the new Zod shape isn't locked and exemplars are Zod-bound to the old schema. Most naturally done in Session 3 with the Zod migration.

## When this session ends

Run the master's §11 closing protocol: promote any new decisions into §8, update §6/§4, write the Session 3 brief at `claudedocs/session-3-zod-migration.md` with its own `## Start here` paste-prompt at the top.
