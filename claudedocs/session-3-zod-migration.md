# Session 3 — Design the Zod Schema Migration (Step 2)

## Start here

Open a fresh Claude Code session in this repo and paste:

```
I'm continuing the Hearted song-analysis concept redesign.
Master: claudedocs/concept-redesign-handoff-2026-05-28.md
This session: claudedocs/session-3-zod-migration.md

Read both files, then execute this brief — design the Zod schema
migration (master Step 2) for the new "read" + "signals" content model.
The lens grammar and vocabulary are locked (Sessions 1-2); the
cardinality shapes and tension/lens redefinitions are this session's
job. This is engineering-design mode, not editorial.
```

---

## Goal

Design (and stage in code) the Zod schema for the new content model — the presentation "read" object (`image`, `lens`, `tension`, `take`, `contradiction?`, `arc`, `lines`, `texture`) and the separate "signals" matching object — plus the migration path from the existing 8-field `AnalysisContent`. Resolve the cardinality shapes the lyric diagnostic left open. Produce migration notes and the Session 4 brief.

## Inherited decisions (locked — do not relitigate)

1. **Lens grammar = closed three-form set** (`X as/of/with Y` · `X into Y` · `Verb-ing the X`), Session 1. The vocabulary (`concept-lens-vocabulary.md`, Session 2) is the controlled list. The Zod type for `lens` is a `string` with the form-set enforced in the *prompt* and the *jury*, not in Zod (a regex would be brittle and reject valid lenses — confirmed by the form-reconciliation in the vocabulary's §3). Do not try to encode the grammar as a Zod refinement.
2. **Presentation and matching split into separate sub-objects** on the analysis row (§8.2 item 5, still a working assumption — but Session 2 did nothing to push back on it).
3. **Migration is additive and lazy** (master §6.2): existing rows get `lens: null, theme_tags: []` and re-enrich on next access. No backfill blocking.
4. **`concept-types.ts` tuples were already widened** to `ConceptArcBeat[]` / `ConceptLineBeat[]` (Session 1, TS-only). The formal Zod shape is what this session locks.

## Decisions THIS session must make (the open questions, with diagnostic inputs)

These come from master §9 (Open questions) and the lyric diagnostic's recommendations. Present options to the user where the call is a real fork; pick sensible defaults where it isn't.

1. **`arc` cardinality shape** (master §9 item 2a / §5.2 caveat). Two live options:
   - (A) variable-length `arc` 2–6, panel renders gracefully (overflow/smaller chips for longer arcs);
   - (B) `arc[2..3]` headline spine + optional `arc_extended[]` (4–6).
   The diagnostic argues for a **floor of 2** and **`mood` allowed to repeat** (monochrome songs — Beautiful Things). Recommend (A) unless the user wants the headline/extended split.
2. **`lines` cardinality** — lower the floor to **1** (diagnostic: 3–5 forces filler on 1–2-idea songs). Cap stays ~5.
3. **`tension` redefinition** — recast as **qualified emotion** (modifier + core, e.g. "Hollow Brightness"), explicitly **NOT required to be a paradox**. The paradox burden moves to optional `contradiction`. This also requires fixing **master §2 glossary**, which currently calls `tension` a "paradox" — that borrows `contradiction`'s job (flagged in §9 item 5 and the diagnostic).
4. **`contradiction`** — stays **optional** (Zod `.optional()` / nullable). Confirmed correct by the diagnostic (Forever/Ben get none; Ribs/PPC get strong ones).
5. **`take` length** — the diagnostic wants elastic 1–3 sentences. This is mostly a *prompt* rule (Session 4), but decide whether Zod enforces any length bound at all (recommend: no hard bound in Zod; let the prompt + jury handle it).

## What to read

- Master **§5.2 / §5.3** (the two schema tables — presentation and matching), **§6.2** (what's not done, migration shape), **§9** (open questions — your decision list), **§8.5** (the Zod-binding constraint on exemplars)
- `claudedocs/concept-lens-vocabulary.md` **§3** (why the lens is a free string, not a Zod enum) and **§10** (handoff notes — SURFACE abuse, Form 2 rarity)
- `claudedocs/schema-overprescription-lyric-diagnostic.md` (the "Recommendations" and "Where these land" sections — your cardinality-floor and tension-redefinition inputs)
- `src/features/liked-songs/components/concept-panel/concept-types.ts` (the current TS types — the widened `arc`/`lines`)
- `src/features/liked-songs/types.ts` (`AnalysisContent` — the old 8-field shape you migrate from)
- `src/lib/domains/enrichment/content-analysis/song-analysis.ts` (`SongAnalysisLyricalSchema` — the live Zod schema; the exemplars and jury are bound to it, §8.5)
- `scripts/voice-audit/exemplars.ts` (`loadGoldExemplars`) — to understand what the deferred transformer must not break

## What to produce

1. **New Zod schemas in code** — a `ConceptReadSchema` (presentation) and a `SignalsSchema` (matching), with the cardinality decisions above encoded. Place them where the project keeps domain schemas (mirror `song-analysis.ts`); no barrel exports.
2. **Migration notes** (`claudedocs/` or inline) — how `AnalysisContent` rows map to the new shape, what's additive, what re-enriches lazily, and the field-by-field old→new mapping (`headline→image`, `compound_mood→tension`, `interpretation`+`mood_description`→`take`, `journey→arc`, `key_lines→lines`, `sonic_texture→texture`, NEW `lens`/`contradiction`).
3. **The deferred one-way transformer** (Decision 3 / Option B, deferred from Session 1) — most naturally built *here*, alongside the Zod shape: reads old-schema exemplar JSONs, maps to the new shape, stubs `lens`/`contradiction` for hand-authoring. Build only if the Zod shape lands cleanly enough to support it; otherwise note explicitly why it slips again.
4. **The Session 4 brief** at `claudedocs/session-4-prompt-v14.md` with its own `## Start here` paste-prompt.

**Acceptance criteria:**
- `bun run test` and typecheck pass with the new schemas in the tree.
- The new schemas validate all four `concept-data.ts` reads (the new gold) without modification.
- The cardinality decisions are encoded AND match the active prompt v13's ranges (don't make Zod tighter than the prompt — that silently rejects coherent output; master §5.2).
- Migration notes are specific enough that Session 5 (voice-audit migration) and Session 6 (prod swap) can follow them without re-deriving the mapping.

## Which skills apply most directly

1. **`postgres`** (if the analysis row is a DB column / JSONB) and **`tanstack-start-react`** — for where schemas live and how loaders/server-fns consume them. This is the engineering-mode session, so the project's required skills (`tanstack-start-react`, `react-best-practices`) apply to any code touched.
2. **`how-to-make-sense-of-any-mess`** — Covert Step 4 (Choose a Direction): the `arc` shape fork (variable vs headline+extended) is a noun-verb-requirement decision. Use the do-say/don't-say discipline on field names.
3. **`information-architecture`** — the presentation/signals split is a facet decision; the `theme_tags[]` controlled vocab (separate artifact) gets scoped here even if not built.

## Out of scope for this session

- Writing prompt v14 (Session 4) — but you may *note* prompt rules the schema implies.
- Building the `theme_tags[]` controlled vocabulary (separate artifact; only scope its shape).
- Migrating voice-audit / the `lens-coherence` judge (Session 5).
- Any UI change (Session 6).
- Relitigating the lens grammar or the vocabulary families (Sessions 1–2, locked).

## When this session ends

Run the master's §11 closing protocol: promote resolved decisions into §8 (the `arc` shape and `tension` redefinition become working assumptions or locked items), update §6 (new schema files) and §4 (mark Session 3 done), fix the §2 glossary `tension`-as-paradox error, and write the Session 4 brief with its `## Start here` paste-prompt at the top.
