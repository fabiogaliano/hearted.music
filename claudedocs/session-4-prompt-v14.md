# Session 4 — Draft the v14 Generation Prompt (Step 3)

## Start here

Open a fresh Claude Code session in this repo and paste:

```
I'm continuing the Hearted song-analysis concept redesign.
Master: claudedocs/concept-redesign-handoff-2026-05-28.md
This session: claudedocs/session-4-prompt-v14.md

Read both files, then execute this brief — draft the v14 lyrical
generation prompt (master Step 3) that produces the new { read, signals }
content model. The schema, lens vocabulary, and lens grammar are locked
(Sessions 1-3). This is prompt-iteration mode: iterate from lyrical-v13,
do not rewrite the voice rules from scratch.
```

---

## Goal

Write `lyrical-v14.ts` — the generation prompt that produces the new `read` object (and, if you choose, the model-authored `signals` fields) — by iterating from `lyrical-v13.ts`. Most of v13's voice rules carry over verbatim; what's new is the **schema reshape**, the **lens constraint**, and the **diagnostic's "permission to be brief/flat"** rules.

## Inherited decisions (locked — do not relitigate)

1. **The schema is locked** (Session 3, `concept-schema.ts`). The prompt must emit a `read` matching `ConceptReadSchema`: `image`, `lens`, `tension`, `take`, `contradiction` (null when absent), `arc` (2–6, mood may repeat), `lines` (1–5), `texture`. Remember **Zod is the permissive envelope; the prompt is the narrower target** — the prompt should aim for arc 4–6 / lines 3–5 on rich songs but explicitly permit the floors (arc 2 / lines 1) on thin or monochrome ones.
2. **The lens grammar is locked** (Session 1): exactly one of `X as/of/with Y` · `X into Y` · `Verb-ing the X`. Bare-noun tags are excluded from the lens (they live in `theme_tags`).
3. **The lens vocabulary is locked** (Session 2, `concept-lens-vocabulary.md`): 77 lenses, 11 families. The prompt should point the model at this vocabulary as the place to borrow/bend a lens, and carry the global kill-checks (§7 of that file) so generated lenses can't decay into abstract slop.
4. **`tension` = qualified emotion, not paradox** (Session 3). The paradox lives in optional `contradiction`.
5. **No backwards compat needed** (Session 3): v14 is a clean new-shape generator. Old rows re-enrich through it; you do not need a transition/dual-shape mode.

## What to produce

1. **`src/lib/domains/enrichment/content-analysis/prompts/lyrical-v14.ts`** — same `PromptVersion` structure as v13 (`version: "14"`, `kind: "lyrical"`, `notes`, `template`). It must:
   - Carry v13's voice rules (no comma+gerund, no dashes, no "this is"/framing openers, no "this song"/"the narrator", warm second-person, present tense, no puffery) — these are proven and largely field-agnostic.
   - Replace the old field spec (`headline`/`compound_mood`/`mood_description`/`interpretation`/`themes`/`journey`/`key_lines`/`sonic_texture`) with the new `read` fields.
   - **Lens-first generation order** (master §6.2 Step 3): the lens is the thesis; generate it early so `take`/`arc`/`lines` become evidence for it, not parallel claims.
   - Encode the **prompt rules the schema implies** (from `session-3-zod-migration-notes.md` §6): lens form-set + vocabulary; `tension` qualified-emotion; `take` elastic 1–3 sentences matched to depth; arc floor 2 + mood-may-repeat + don't-manufacture-movement; lines floor 1 + don't-pad; foreign-language `lines` = original + parenthetical English gloss; `contradiction` null when none; permission to be brief/flat on surface-true songs (diagnostic recommendation 6).
2. **Register `v14` as active** in `prompts/registry.ts` *only if* the schema is wired into the generation path (see Out of scope — you may instead leave v13 active and note the cutover for Session 5/6). Decide and document.
3. **Comparison notes** (`claudedocs/`) — what changed v13→v14 and why, with at least the 4 gold songs + 2–3 diagnostic stress songs (a surface-true one like Forever, a monochrome-deep one like Beautiful Things, a two-act one like Pink Pony Club) reasoned through to show the new rules fire correctly.
4. **The Session 5 brief** at `claudedocs/session-5-voice-audit-migration.md` with its own `## Start here` paste-prompt.

## What to read

- Master **§5.2** (the read fields + constraints), **§8.2 items 6–8** (the locked schema/cardinality/lens decisions), **§9 item 5** (over-prescription decisions queued for the prompt)
- `claudedocs/session-3-zod-migration-notes.md` **§6** (the prompt rules the schema implies — your checklist) and **§2** (cardinality philosophy)
- `claudedocs/concept-lens-vocabulary.md` (**§1** editor's procedure, **§3** grammar, **§6** families, **§7** global kill-checks) — the prompt should compress this into generation instructions
- `claudedocs/schema-overprescription-lyric-diagnostic.md` (**Recommendations** + **Where these land → Session 4**)
- `src/lib/domains/enrichment/content-analysis/prompts/lyrical-v13.ts` (iterate from this) and `prompts/registry.ts` (how active version is selected) and `prompts/types.ts` (`PromptVersion` shape)
- `src/lib/domains/enrichment/content-analysis/concept-schema.ts` (the contract you're generating to)

## Acceptance criteria

- `lyrical-v14.ts` exists, typechecks, and follows the `PromptVersion` structure (the registry can import it).
- Every field in `ConceptReadSchema` has a spec in the template, and every diagnostic recommendation (1–8 in the diagnostic) is encoded as a rule.
- The lens spec names the three forms, points at the vocabulary, and carries the abstract-noun kill-check.
- The "permission to be brief/flat" rule is present and unambiguous (a surface-true song must be allowed a 2-beat arc, 1 line, a 1-sentence take, and a null contradiction).
- Comparison notes reason at least one surface-true, one monochrome-deep, and one two-act song through the new rules.

## Which skills apply most directly

1. **`narrative-strategy-specialist`** (archived, read explicitly) — each read should follow narrative arc: `image` = hook, `lens` = thesis, `take` = development, `contradiction` = Pratfall, `arc` = structural beats. SUCCESs as a quality gate for the prompt's instructions.
2. **`creative-conceptualist-specialist`** (archived) — the lens instruction is where Analyze→Identify→Violate must survive into generation: the prompt has to actively steer the model away from category-typical mood/tag slop toward a defensible claim.
3. **`copywriting-ecosystem`** (archived) — sequencing check: this is the Execution layer. The Ideas layer (vocabulary) is locked; resist re-opening it. Use it to keep the prompt to *encoding* decisions, not *making* them.

## Out of scope for this session

- Wiring the new schema into `SongAnalysisService.analyzeSong` end-to-end and migrating the DB read path is a judgment call: at minimum draft the prompt; only flip the active version + generation schema if you can do it without breaking v13's live path and the jury (which is still old-schema until Session 5). If in doubt, leave v13 active, ship v14 as draft, and hand the cutover to Session 5/6.
- Voice-audit migration, the `lens-coherence` judge, promoting `exemplars-v14-draft/` to gold (Session 5).
- The `theme_tags[]` controlled vocabulary (still a separate unbuilt artifact).
- Any UI change (Session 6).
- Relitigating the schema, cardinality, lens grammar, or vocabulary (Sessions 1–3, locked).

## When this session ends

Run the master's §11 closing protocol: update §6 (new prompt file + registry state), §4 (mark Session 4 done, Session 5 next), promote any prompt decisions that became load-bearing into §8, and write the Session 5 brief with its `## Start here` paste-prompt at the top. If you discovered the schema needs a change (e.g. a field the prompt genuinely can't satisfy), do NOT silently edit it — document the evidence per §8.3 and surface it before changing `concept-schema.ts`.
