# Session 5 — Migrate Voice-Audit to the New Schema (Step 4)

## Start here

Open a fresh Claude Code session in this repo and paste:

```
I'm continuing the Hearted song-analysis concept redesign.
Master: claudedocs/concept-redesign-handoff-2026-05-28.md
This session: claudedocs/session-5-voice-audit-migration.md

Read both files, then execute this brief — migrate the voice-audit
pipeline to the new { read } schema (master Step 4): promote the four
gold reads, re-point the exemplar loader and jury at ConceptReadSchema,
re-point the field-specific Tier-1/Tier-2 rules, and add the
lens-coherence judge. The prompt (v14), schema, lens vocabulary, and
lens grammar are locked (Sessions 1-4). This is engineering mode.
```

---

## Goal

Make voice-audit enforce the new `read` schema as effectively as it enforces the old 8-field one — so that when v14 goes live, the jury can grade its output. This is the enforcement layer the whole redesign has been deferring to (master §5.1: "voice-audit becomes the enforcement layer for the new schema after migration").

## Inherited decisions (locked — do not relitigate)

1. **The schema is locked** (Session 3, `concept-schema.ts`): `ConceptReadSchema` / `SignalsSchema` / `ConceptAnalysisSchema`.
2. **The prompt is locked** (Session 4, `lyrical-v14.ts`): it emits the `read` fields. It is registered but **not active** — `song-analysis.ts` still parses old-schema (see the cutover note below; flipping it is partly this session's job).
3. **The lens grammar + vocabulary are locked** (Sessions 1–2): three forms, 11 families, the §7 kill-checks. The `lens-coherence` judge enforces them at grading time.
4. **No backwards compat** (Session 3): old rows re-enrich through v14. The transformer (`concept-migration.ts`) exists only to scaffold gold exemplars.

## What to read

- Master **§5.1** (voice-audit as the post-migration enforcement layer), **§6.2 Step 4** (the three sub-tasks: exemplars / Tier-1 / Tier-2), **§8.5** (why exemplars are Zod-bound to the old schema — the constraint you are now lifting).
- `claudedocs/session-4-prompt-v14-comparison.md` **§5** (the activation/cutover decision — what `analyzeSong` needs) and **§6** (two enforcement notes that land here: gold-texture dash normalization, and the SURFACE-abuse check the `lens-coherence` judge must carry).
- `claudedocs/concept-lens-vocabulary.md` **§7** (the kill-checks the `lens-coherence` judge encodes) and **§10** (the SURFACE-abuse warning).
- The pipeline itself: `scripts/voice-audit/exemplars.ts` (`loadGoldExemplars`), `evaluate.ts` (the pairwise judge), `build-compare.ts`, `types.ts`, `tier1/rules.ts`, `tier2/schemas.ts`. Read all before changing any — master §10 step 4 warns: understand what is already enforced so you do not reinvent it.
- `scripts/voice-audit/exemplars-v14-draft/*.json` (the scaffolded drafts with `lens`/`contradiction`/`take` stubbed) and `src/features/liked-songs/components/concept-panel/concept-data.ts` (the four authored gold reads — the source of truth for the stubs).

## What to produce

1. **Promoted gold exemplars** in the new shape. Hand-author the stubbed `lens` / `contradiction` / `take` in `exemplars-v14-draft/` using `concept-data.ts` as the source. **Normalize any dashes** in `texture` (and elsewhere) to the no-dash form before promotion — see comparison-notes §6 finding 1, or these golds will fail the Tier-1 dash rule they are meant to anchor.
2. **Re-pointed loader + jury.** `loadGoldExemplars` parses through `ConceptReadSchema` (or `ConceptAnalysisSchema`) instead of `SongAnalysisLyricalSchema`; `evaluate.ts` and `build-compare.ts` updated to the new field set. Decide whether to keep an old-schema path for historical runs or cut over cleanly (no backwards compat is required, so a clean cut is defensible).
3. **Re-pointed Tier-1 rules.** Most are field-agnostic and apply unchanged; re-point any that name old fields (`journey`, `key_lines`, `headline`, etc.) to the new ones (`arc`, `lines`, `image`).
4. **Re-pointed + new Tier-2 judges.** Re-point `journey-narrative` → `arc`. **Add the `lens-coherence` judge**: does the `take` actually read through the named `lens`, or is the lens decorative? It must also carry the **SURFACE-abuse check** (comparison-notes §6 finding 2): a SURFACE lens is valid only when the *song* is thin, not when the *read* was lazy.
5. **The generation cutover** (coordinate with this session — the jury can only grade new-shape output if generation produces it): teach `SongAnalysisService.analyzeSong` to select `ConceptReadSchema` when the active lyrical version is ≥14, and flip `ACTIVE_LYRICAL_VERSION` to `"14"`. If this proves too entangled to do safely in one session, leave v13 active, land the jury migration against the gold exemplars only, and hand the generation flip to its own session — document the call either way.
6. **The Session 6 brief** at `claudedocs/session-6-prod-panel-swap.md` with its own `## Start here` paste-prompt.

## Acceptance criteria

- `bun run test` stays green; the voice-audit suite runs against the new schema.
- The four gold reads load and validate through the new loader; no dashes survive in the promoted golds.
- `journey-narrative` no longer references the removed `journey` field; `arc` is graded in its place.
- The `lens-coherence` judge exists, runs on the four golds, and correctly flags a deliberately-decorative test lens and a deliberately-lazy SURFACE tag.
- The activation state (v13 vs v14 active, and the parse-schema selection in `analyzeSong`) is documented in the comparison notes or a new session note.

## Which skills apply most directly

1. **`creative-conceptualist-specialist`** (archived) — the `lens-coherence` judge is where Analyze→Identify→Violate becomes a *grading* rule: the judge has to recognize category-typical slop the prompt was steering away from.
2. **`narrative-strategy-specialist`** (archived) — the judge rubric mirrors the read's narrative arc (image=hook, lens=thesis, take=development, contradiction=Pratfall); use it to define what "coherent" means for the new judges.
3. **`react-best-practices`** / **`web-interface-guidelines`** — only if `build-compare.ts` renders a UI compare view that needs touching; otherwise this is non-UI engineering.

## Out of scope

- Swapping the production panel (`SongDetailPanel.tsx`) to `ConceptPanel` — that is Session 6.
- The `theme_tags[]` controlled vocabulary and any `signals` generation — still a separate unbuilt artifact.
- Relitigating the schema, cardinality, lens grammar, vocabulary, or the v14 prompt (Sessions 1–4, locked). If the migration reveals the prompt genuinely can't satisfy a jury rule, document it per master §8.3 and surface it — do not silently edit `lyrical-v14.ts` or `concept-schema.ts`.

## When this session ends

Run the master's §11 closing protocol: update §6 (voice-audit files changed, activation state), §4 (mark Session 5 done, Session 6 next), promote any judging/enforcement decisions that became load-bearing into §8, and write the Session 6 brief with its `## Start here` paste-prompt at the top.

---

## Outcomes (2026-05-29 — session complete)

All six deliverables landed. Full detail is in master §6.1 (Session 5 changes block) and §8.5; summary:

1. **Gold exemplars promoted** to `{ read }` in `scripts/voice-audit/exemplars/*.json`, authored from `concept-data.ts`, em-dashes normalized. Loader (`exemplars.ts`) parses `.read` through `ConceptReadSchema`.
2. **Loader + jury re-pointed** (`exemplars.ts`, `evaluate.ts`, `build-compare.ts`, `tier2/pairwise.ts`, `judge-persona.md`). Clean cut — legacy data skipped via `safeParse`.
3. **Tier-1 re-pointed** (`tier1/rules.ts`, `tier1/report.ts`, `stats.ts`, `types.ts`, `experiments.ts`) to the read model.
4. **Tier-2 re-pointed + extended**: `journey-narrative.ts` → `arc-narrative.ts` (grades `arc`, "flat mood is not a failure"); new **`lens-coherence`** judge with the SURFACE-abuse backstop (`tier2/prompts/lens-coherence.ts`, `LensCoherenceSchema`). Plus a runnable LLM check `check-lens-coherence.ts`.
5. **Generation cutover — mechanism shipped, flip deferred.** `analyzeSong` selects `ConceptReadSchema` when `ACTIVE_LYRICAL_VERSION >= 14`; left at `"13"` (dormant). The flip is bundled with the Session 6 panel swap because the prod panel + queries still read the old shape.
6. **Session 6 brief** written (`claudedocs/session-6-prod-panel-swap.md`).

> **Addendum (2026-05-30):** a **Session 5.5 — v14 calibration** brief (`claudedocs/session-5.5-v14-calibration.md`) was inserted as the immediate next step, *before* Session 6. Rationale: this migration was what first made the eval layer capable of grading v14 output, and v14 had until now only been validated on paper (comparison-notes §4). The app is preprod, so calibrating the prompt against the jury before the go-live flip is cheap and is the natural use of the instrument built here. Chain is now 5 → **5.5** → 6.

**Tests/typecheck:** voice-audit suite 70 tests; full `bun run test` 1142 passing / 8 skipped; `bun run typecheck` clean. Fixtures + `rules`/`stats`/`tier2-schemas` tests migrated; new `__tests__/exemplars.test.ts`.

### The participial-closure finding (surfaced, not fixed — §8.3)

The promoted `drivers-license` gold's `lines[1].insight` — *"Heartbreak does its worst work in the imagination, casting the exact scene it dreads."* — trips the Tier-1 `participial-closure` rule (the comma+gerund the voice rules forbid). It is verbatim from the locked `concept-data.ts` and was never linted before, because **golds anchor the pairwise judge, not the deterministic Tier-1 linter**. Per §8.3 it is surfaced, not silently rewritten (the Session 4 dash normalization was an explicit instruction; this is a new discovery on a locked artifact). Decision queued for the user / Session 6: (a) accept golds aren't Tier-1-gated (only the dash rule was required of them), or (b) normalize this insight in both `concept-data.ts` and `exemplars/drivers-license.json`. The migration changed no gold wording beyond the dash normalization.

### Note on running the lens-coherence acceptance check

`bun scripts/voice-audit/check-lens-coherence.ts` exercises the judge over the four golds (expect coherent) plus a decorative-lens read and a lazy-SURFACE read (expect flagged). It makes live LLM calls, so it is a script, not a vitest test, and was **not run during this session** (no provider creds in the working environment). Run it once with a provider configured to confirm the judge's discernment end-to-end.
