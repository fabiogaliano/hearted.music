# Session 6 — Swap the Production Panel + Flip Generation to v14 (Step 5)

## Start here

Open a fresh Claude Code session in this repo and paste:

```
I'm continuing the Hearted song-analysis concept redesign.
Master: claudedocs/concept-redesign-handoff-2026-05-28.md
This session: claudedocs/session-6-prod-panel-swap.md

Read both files, then execute this brief — the final step: swap the
production SongDetailPanel to the ConceptPanel reading the new { read }
shape, and flip generation to v14 (ACTIVE_LYRICAL_VERSION = "14"), the
two halves of one coordinated cutover. Schema, lens vocabulary, and
voice-audit are locked/migrated (Sessions 1-5), and v14 was measured and
tuned against the eval layer in Session 5.5. Engineering + UI mode.
```

> **Prerequisite:** Session 5.5 (v14 calibration) should be done first — it is the first time v14 is generated and scored against gold, and it may have revised `lyrical-v14.ts`. If 5.5 fired the kill-switch (master §13), do NOT proceed with this session.

---

## Goal

Make the redesign live: production songs are analyzed by v14 (emitting the `{ read }` model) and rendered by the locked `ConceptPanel`, replacing the eight-field `SongDetailPanel`. This is the coordinated cutover that Sessions 4 and 5 deliberately deferred to a single step because the generation flip and the panel swap must land together — neither is safe alone.

## Inherited decisions (locked — do not relitigate)

1. **Schema** (Session 3): `ConceptReadSchema` / `ConceptAnalysisSchema`.
2. **Prompt** (Session 4, calibrated Session 5.5): `lyrical-v14.ts` emits the read; registered, not yet active. Session 5.5 ran it against the eval layer and tuned it to clear the quality bars — use the *calibrated* prompt, and read `session-5.5-v14-calibration-findings.md` for what changed and any residual gaps.
3. **Lens grammar + vocabulary** (Sessions 1–2).
4. **Voice-audit** (Session 5): fully migrated to the read shape; the `lens-coherence` judge exists.
5. **The cutover is two coupled changes** (comparison-notes §5, master §8.5): (a) `analyzeSong` already selects `ConceptReadSchema` when `ACTIVE_LYRICAL_VERSION >= 14` — the selection mechanism is shipped and dormant; (b) the prod panel still renders the old 8 fields. Flipping generation without swapping the panel produces `read`-shaped rows the panel can't display; swapping the panel without flipping generation leaves it with no new-shape rows to read. **Do both, in one session.**
6. **No backwards compat** (Session 3): old rows re-enrich through v14. There is no runtime legacy-read path.

## What to read

- Master **§5.4** (the locked UI direction — refine, don't redesign), **§6.1** (file tree, esp. `concept-panel/*` and the Session 5 changes block), **§8.5** (the activation cutover note + the audit-blindness window that this session closes; also the queued gold participial-closure decision).
- `claudedocs/session-4-prompt-v14-comparison.md` **§5** (the exact cutover steps).
- The panel: `src/features/liked-songs/components/concept-panel/ConceptPanel.tsx`, `concept-types.ts`, `concept-data.ts`, `concept-artwork.functions.ts`, and the dev route `src/routes/dev-song-detail-panel-v3.tsx`.
- The prod panel being replaced: `src/features/liked-songs/components/SongDetailPanel.tsx` + `detail/PanelContent.tsx`.
- The generation path: `src/lib/domains/enrichment/content-analysis/song-analysis.ts` (the dormant version-aware schema selection), `prompts/registry.ts` (`ACTIVE_LYRICAL_VERSION`), and `queries.ts` (how the stored `analysis` JSON is typed/read).
- The required skills (CLAUDE.md): `tanstack-start-react`, `react-best-practices`, `web-interface-guidelines`.

## What to produce

1. **Generation flip.** Set `ACTIVE_LYRICAL_VERSION = "14"`. Confirm `analyzeSong` then validates output against `ConceptReadSchema` (the branch is already there). Decide + document the **stored shape**: v14's `generateObject(prompt, ConceptReadSchema)` returns flat read fields, so `buildAnalysisData` stores `{ ...readFields, audio_features }`. Confirm `queries.ts` / the `SongAnalysis` row type accommodate this (or adapt them), and confirm `signals` is genuinely out of scope (still unbuilt — `theme_tags` vocab does not exist).
2. **Panel swap.** Route the production song-detail surface to `ConceptPanel` reading the stored `read`. Preserve the locked layout (Read → Take → Trace). Wire the per-song palette and artwork the prod panel already uses.
3. **Re-enrichment plan for existing rows.** Old analyses are 8-field and won't render in the new panel. Decide the path: lazy re-enrich on view, a batch backfill, or a migration script. The kill-switch (master §13) applies — watch the first ~100 generated reads for lens slop.
4. **Close the audit-blindness window.** Once v14 generates new-shape rows, regenerate the voice-audit golden set + `baseline.json` (master §8.5), so the deterministic CLI and `evaluate.ts`/`build-compare.ts` have data again. Run `check-lens-coherence.ts` against the live golds.
5. **Resolve the queued gold-hygiene decision** (master §8.5, Session 5): accept that golds aren't Tier-1-gated, or normalize the `drivers-license` participial-closure insight in both `concept-data.ts` and `exemplars/drivers-license.json`.

## Acceptance criteria

- A newly-analyzed song is generated by v14 and renders correctly in the production `ConceptPanel` (lens/tension/image, take, arc/lines/texture).
- `bun run test` stays green; `bun run typecheck` clean.
- No code path tries to render an old-shape row through the new panel without a re-enrichment story.
- The activation state in master §6 + §8.5 is updated to "v14 active, panel swapped."

## Which skills apply most directly

1. **`tanstack-start-react`** — the panel swap touches the route/loader and how the stored `read` reaches the component.
2. **`react-best-practices`** + **`web-interface-guidelines`** — `ConceptPanel` is the user-facing surface; review composition, performance, and a11y as it goes live.
3. **`narrative-strategy-specialist`** (archived) — only if the first ~100 live reads show the lens decaying and you need to judge whether the kill-switch (master §13) should fire.

## Out of scope

- Building the `signals` matching layer (`theme_tags[]` controlled vocab, `scenes`, `address`, etc.) — still a separate unbuilt artifact.
- Re-tuning the v14 prompt or the lens vocabulary (Sessions 2/4, locked). Use `regen.ts --version 14` + the migrated voice-audit if you need to *measure* v14, but do not edit the prompt without surfacing per master §8.3.
- Redesigning the panel layout (master §5.4 / §8.1 locked — refine only).

## When this session ends

Run the master's §11 closing protocol. This is the final planned session, so instead of writing a "Session 7 brief", update master §13 (success criteria) with which held and which didn't at go-live, and record any post-launch follow-ups (re-enrichment backfill status, lens-slop watch) as a short punch list in the master.
