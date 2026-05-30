# Session 1 — Resolve Deferred Decisions

## Start here

Open a fresh Claude Code session in this repo and paste:

```
I'm continuing the Hearted song-analysis concept redesign.
Master: claudedocs/concept-redesign-handoff-2026-05-28.md
This session: claudedocs/session-1-resolve-deferred-decisions.md

Read both files. Execute this brief — present 3-4 options for each
of the three deferred decisions using the five required skills, let
me pick, then run the master's §11 closing protocol.
```

---

## Goal

Resolve three deferred decisions that govern Step 1 (lens vocabulary) and shape the rest of the redesign. For each decision, **present 3-4 options with worked examples and tradeoffs; let the user pick**. Do not pick for them.

## What to read before drafting

1. Master sections 1-5 (TL;DR, glossary, skills, session map, the proposed concept)
2. Master section 8 (working assumptions — resolved decisions get promoted into 8.1 or 8.2)
3. Master section 11 (closing protocol — must execute at session end)
4. `src/features/liked-songs/components/concept-panel/concept-data.ts` (the four hand-written reads)
5. `scripts/voice-audit/exemplars/not-like-us.json` (user-rewritten exemplar — evidence pushing back on noun-as-noun)
6. `src/lib/domains/enrichment/content-analysis/prompts/lyrical-v13.ts` (the active prompt; already encodes ranges and most voice rules)

## What to produce

- For each of the three decisions: a 3-4 option comparison with examples and a recommendation (yours, not the user's call)
- The user's pick for each, documented back into the master per §11.1 (move from §8.4 stub → §8.2 or §8.1)
- `claudedocs/session-2-lens-vocabulary.md` with its own `## Start here` paste-prompt at the top

## 3. skills to apply (use these proactively)

This work is editorial + IA + creative concepting — not just engineering. Five skills inform it. Use them in this order:

1. **`how-to-make-sense-of-any-mess`** (`/Users/f/.claude/skills/how-to-make-sense-of-any-mess`) — Abby Covert's 7-step framework. The redesign is already past Step 2 (intent stated), Step 3 (reality faced), Step 4 (direction chosen). Step 1 deliverable below is essentially a Covert Step 6 (Play with Structure) artifact: a controlled vocabulary for the `lens` field, which is the new center of gravity. Reach for this skill when stuck on whether a decision is structural or surface.

2. **`information-architecture`** (`/Users/f/.claude/skills/information-architecture`) — Rosenfeld/Morville/Arango 4e. The matching layer is an IA problem: facets, controlled vocabularies, synonym rings → thesauri. The lens vocabulary IS an IA artifact. Use this skill for any controlled-vocabulary or facet-design decision.

These are at `/Users/f/.claude/skills/archive/`. Read each `SKILL.md` (or equivalent) before applying:

3. **`creative-conceptualist-specialist`** — The lens vocabulary is creative-concept work. The Nine-Step Creative Procedure and the "Analyze → Identify → Violate" framework apply directly. The violation in this work: rejecting category-typical music app tags ("sad," "happy," "melancholic") in favor of essayistic frames a critic would write.

4. **`narrative-strategy-specialist`** — Use for the eventual prompt redesign (Step 3). Each read should follow narrative arc (image = hook, lens = thesis, take = development, contradiction = Pratfall Effect, arc = structural beats). SUCCESs as a quality gate.

5. **`copywriting-ecosystem`** — Use as a sequencing check. Four-layer stack: Strategy → Ideas → Execution → Optimization. We are at the **Strategy → Ideas boundary**. The trap: jumping to Execution (writing the prompt) before the Ideas layer (the lens vocabulary) is locked. This skill tells you when to switch layers.

**Workflow expectation:** when you're about to commit to a structural decision (cardinality enforcement, vocabulary boundaries, prompt order), check which of the five skills should be informing it. Don't proceed if the decision is in a skill's zone and you haven't applied it..

## Out of scope for this session

- Drafting the lens vocabulary itself (Session 2)
- Designing the Zod schema (Session 3)
- Touching the prompt or voice-audit (Sessions 4-5)
- UI changes (Session 6)

If you find yourself doing any of these, stop. Note in master §8 and defer to the appropriate session.

## When this session ends

**Normal trigger:** All three decisions resolved (user picked an option for Decision 1, Decision 2, and Decision 3). The moment Decision 3's pick is received, run the closing protocol (master §11) immediately. Don't wait for the user to ask. Announce: "All three decisions resolved — running closing protocol."

**Early-stop trigger:** User signals they want to pause ("let's continue tomorrow", "stop here", etc.). Still run the closing protocol, but mark unresolved decisions as explicitly deferred in master §8.4 with a one-line reason and the date. Don't leave the work in an ambiguous half-state.

**Don't:** Keep working past the third pick on related-but-out-of-scope topics. The next session is the right surface for those.

**Do:** After running the closing protocol, end your final message to the user with: "Session 1 done. Paste-prompt for Session 2 is at the top of `claudedocs/session-2-lens-vocabulary.md`. We're clear to close this conversation." Then stop.

---

## Decision 1 — Lens grammar: which voice(s) does Hearted want?

**Underlying problem.** The current working assumption is noun-as-noun grammar ("license as eulogy"). User-authored editorial evidence pushes back: when rewriting Not Like Us, the user shifted to bare noun phrases ("community defense", "moral indictment", "West Coast claim") with only one of four themes keeping noun-as-noun form ("celebration as weapon"). This suggests Hearted's lens-grammar instinct is broader than noun-as-noun.

**Three observed grammars now in play:**

| Grammar                                     | Example                                                              | Voice it produces      |
| ------------------------------------------- | -------------------------------------------------------------------- | ---------------------- |
| Noun-as-noun (X as Y / X of Y / X with Y)   | `license as eulogy`, `hometown as armor`                             | Critical / essayistic  |
| Verb-as-noun (gerund-led action phrase)     | `outrunning the quiet`, `passing a test for someone who isn't there` | Narrative / cinematic  |
| Bare noun phrase (noun + noun, no relation) | `community defense`, `moral indictment`                              | Taxonomic / indictment |

**Options to present (starting set — expand or replace using Creative Conceptualist):**

- **A. Single grammar (noun-as-noun, current working assumption).** Clean, restrictive, easy to enforce in prompt. Cost: contradicted by NLU editorial direction. Best if Hearted wants one consistent register.
- **B. Three grammars, song-type-conditional.** Critical songs get noun-as-noun. Narrative/journey songs get verb-as-noun. Indictment/manifesto songs get bare noun phrases. Cost: requires the prompt to classify song type before picking grammar. Best if Hearted wants the lens to mirror what each song _does_.
- **C. Soft default (noun-as-noun preferred, others allowed).** Prompt picks noun-as-noun unless something else fits better. Cost: less predictable, harder to enforce in voice-audit. Best for a working compromise.
- **D. No grammar rule (lens is just a phrase, ≤5 words, semantic only).** Cost: loses the voice-encoding the grammar provides. Best if grammar is over-constraining.

Apply Creative Conceptualist's Analyze→Identify→Violate framework to _generate_ options — don't just list mine. Apply IA's controlled-vocabulary principles to assess each option's enforceability.

---

## Decision 2 — Translating the rewritten Not Like Us

**Underlying problem.** The user substantially rewrote `scripts/voice-audit/exemplars/not-like-us.json` (new headline: "Compton draws the line. The block party is on the right side of it." — 4 themes, 6 journey beats, 4 key lines). The dev route still shows the old version because `concept-data.ts` is decoupled. The new direction needs to land in the new schema for the user to see and react to it.

**Options to present:**

- **A. Single hand-authored translation.** You write one version: pick a lens (aligned with whatever grammar came from Decision 1), collapse interpretation + mood_description into `take`, map the 6 journey beats into the new `arc` (variable length now), translate 4 key_lines into new `lines`. User reads it, says yes/no.
- **B. Multiple lens candidates.** Write 3-4 lens variants (one per grammar from Decision 1) for NLU, hold everything else constant. User picks the lens that feels most "Hearted." Cheaper way to A/B grammar choices using real content.
- **C. Side-by-side comparison rendering.** Add a UI mode to the dev route showing the old-schema exemplar JSON next to the new-schema concept-data version. User can edit either and see the rendered difference. More tooling work; better for ongoing editorial iteration.

Apply Covert's "play with structure — try multiple before committing" to pick which option fits the user's current need.

---

## Decision 3 — Hooking concept-data.ts to exemplars

**Underlying problem.** Two separate sources of truth. Editing the exemplar JSONs doesn't propagate to the UI. The user noticed this when their NLU edits didn't appear at `/dev-song-detail-panel-v3`. Long-term untenable.

**Options to present:**

- **A. Manual sync (no automation).** Whenever exemplar JSONs change, hand-update `concept-data.ts`. Effort: low per edit, high over time. Best if editorial iteration on exemplars is rare.
- **B. One-way transformer (JSON → concept-data).** A script reads exemplar JSONs, maps old-schema fields to new-schema fields, stubs `lens` for hand-authoring. Effort: 1-2 hours. Best if exemplars stay in old schema during the migration window.
- **C. Migrate exemplars to the new schema entirely.** The four `concept-data.ts` reads become the new exemplars. Voice-audit gold gets re-pointed. Step 4 brought forward. Effort: half a day. Best when the new schema is locked enough to commit (likely after Step 2 Zod migration).
- **D. Editorial UI mode.** Add a panel-internal editor to the dev route — the user edits read fields inline and JSON regenerates. Effort: 3-4 hours. Best for ongoing editorial work, premature for now.

Apply IA's three-circle ecology (users + content + context) to frame which option best fits how the user actually wants to edit going forward.

---

## What "present options" means in practice

For each of the three decisions above:

1. State the underlying problem in your own words, drawing on context from master + this brief.
2. Use the named skills to _generate_ the option set — don't just repeat the starting set above. Add, remove, or restate.
3. For each option, write: what it is, when to pick it, what it costs, a worked example (use Not Like Us or another exemplar as test case).
4. End with a recommendation **with a clear note that the recommendation is yours, not the user's call.** The user picks.
5. After the user picks for any decision, document it back into the master per §11.1 (promote from §8.4 stub → §8.2 working assumption, or §8.1 if user explicitly calls it locked).

---

## Session-end checklist

Tick each item as it's done. Don't declare the session complete until every box is checked or explicitly noted otherwise.

- [ ] Decision 1 (lens grammar) resolved, or explicitly deferred with reason
- [ ] Decision 2 (NLU translation) resolved, or explicitly deferred with reason
- [ ] Decision 3 (architectural hookup) resolved, or explicitly deferred with reason
- [ ] Master doc §8.4 stub updated to reflect resolution (decisions promoted to §8.2 or §8.1, with date)
- [ ] Master doc §8.5 has new evidence entries if working assumptions were pushed back
- [ ] Master doc §6 (Current state) reflects any new files created
- [ ] Master doc §4 (Session map) — row for Session 1 marked done
- [ ] `claudedocs/session-2-lens-vocabulary.md` written with `## Start here` paste-prompt at top
- [ ] No half-finished work undocumented — anything incomplete is noted in master with reason
