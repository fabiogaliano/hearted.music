# Zod Migration Notes — Concept Model (Step 2 / Session 3)

**Date:** 2026-05-29 (Session 3)
**Status:** Schemas staged in code. No prompt generates the new shape yet (Session 4). No production rows migrated yet.
**Reads alongside:** master §5.2 / §5.3 / §6.2, `concept-lens-vocabulary.md`, `schema-overprescription-lyric-diagnostic.md`.

---

## 0. What shipped this session

| File | What it is |
|---|---|
| `src/lib/domains/enrichment/content-analysis/concept-schema.ts` | Canonical Zod: `ConceptReadSchema`, `SignalsSchema`, `ConceptAnalysisSchema` + inferred types |
| `src/lib/domains/enrichment/content-analysis/concept-migration.ts` | Pure one-way transformer `transformLegacyToConceptDraft` + `ReadDraft`/`ConceptDraft` types |
| `scripts/voice-audit/transform-legacy-exemplars.ts` | Runs the transformer over the 4 gold exemplars → `exemplars-v14-draft/` |
| `scripts/voice-audit/exemplars-v14-draft/*.json` | 4 scaffolded drafts (lens/contradiction/take stubbed for hand-authoring) |
| `src/features/liked-songs/components/concept-panel/concept-types.ts` | Now re-exports `ConceptRead`/`ConceptArcBeat`/`ConceptLineBeat` from the Zod schema (single source of truth); `ConceptSong` stays local |
| `src/lib/domains/enrichment/content-analysis/__tests__/concept-schema.test.ts` | 14 tests: gold validation, cardinality envelope, transformer mapping |

`bun run test content-analysis` → 57 passing. New files typecheck clean under `tsgo`.

---

## 1. The new stored shape

The analysis row's `analysis` JSONB column (one column — no DDL needed; `queries.ts:110` stores it as `Json`) holds:

```jsonc
{
  "read":    { /* ConceptReadSchema — what the panel renders */ },
  "signals": { /* SignalsSchema — matching layer, hidden from panel */ }
}
```

`read` is required; `signals` is optional (an early row may carry only the read).

### `ConceptReadSchema` (presentation)

| Field | Type | Bound | Notes |
|---|---|---|---|
| `image` | `string` | — | felt-image, ≤8 words (length is a prompt rule, not Zod) |
| `lens` | `string` | — | free string; grammar enforced in prompt + jury, **never** a Zod regex (vocabulary §3) |
| `tension` | `string` | — | **qualified emotion** (modifier + core), NOT a paradox |
| `take` | `string` | — | elastic length is a prompt rule; no Zod length bound |
| `contradiction` | `string \| null` | — | **required key, nullable value** — forces explicit `null` over silent omission |
| `arc` | `ArcBeat[]` | `.min(2).max(6)` | `mood` may repeat (monochrome songs) |
| `lines` | `LineBeat[]` | `.min(1).max(5)` | floor lowered from prompt's 3 |
| `texture` | `string` | — | one contrast-ending sentence (prompt rule) |

`ArcBeat = {label, mood, scene}` · `LineBeat = {line, insight}`.

### `SignalsSchema` (matching — staged, all fields optional)

`theme_tags` (string[] ≤3, becomes an enum when the vocab artifact lands), `themes` (legacy free-form backup), `scenes`/`address`/`register` (enums), `cultural_anchors` (string[]), `eligibility` (bool flags), `tempo_emotion_gap` / `intensity_curve` (derived, nullable). Nothing generates signals until v14+; the derived fields are computed downstream like `audio_features` is today.

---

## 2. The cardinality philosophy (why Zod is looser than the prompt)

**Zod is the permissive envelope; the prompt is the narrower target.** Making Zod *tighter* than the prompt silently rejects coherent generated output (master §5.2). So:

| Field | Prompt v13 target | Diagnostic floor | **Zod envelope** |
|---|---|---|---|
| `arc` (was `journey`) | 4–6 | 2 | **[2, 6]** |
| `lines` (was `key_lines`) | 3–5 | 1 | **[1, 5]** |

Floor comes from the diagnostic (monochrome / one-idea songs); ceiling matches the prompt. The four gold reads (arc 3/6/3/3, lines 2/4/2/2) all sit inside the envelope and validate unmodified.

**Decision recorded (arc shape):** Option A — single variable-length `arc`, not a headline-spine + `arc_extended` split (user-confirmed, Session 3). The scannability concern that motivated the split is a *rendering* refinement for Session 6 (smaller chips / scroll for long arcs), not a schema concern. Keeps the `journey → arc` mapping one-to-one.

---

## 3. Field-by-field old → new mapping

Legacy 8-field `AnalysisContent` / `SongAnalysisLyrical` → new `{ read, signals }`:

| Legacy field | → New field | Transform |
|---|---|---|
| `headline` | `read.image` | rename |
| `compound_mood` | `read.tension` | rename (already a qualified emotion — no paradox needed) |
| `interpretation` + `mood_description` | `read.take` | **merge** (concat is a scaffold; gold `take` is a fresh rewrite) |
| `journey[]` `{section, mood, description}` | `read.arc[]` `{label, mood, scene}` | rename keys |
| `key_lines[]` `{line, insight}` | `read.lines[]` | identical shape |
| `sonic_texture` | `read.texture` | rename |
| `themes[]` | `signals.themes[]` | passthrough (reading-only backup) |
| — | `read.lens` | **NEW** — no legacy source; hand-author / v14-generate |
| — | `read.contradiction` | **NEW** — null unless the song holds one |
| — | `signals.theme_tags[]` | **NEW** — controlled vocab (separate artifact) |
| `audio_features` | (unchanged) | stays a sibling of `read`/`signals`, set post-generation as today |

---

## 4. Migration strategy: re-enrich, don't transform-in-place

**Backwards compatibility is NOT required** (user-confirmed, Session 3). This simplifies the strategy:

- There is **no runtime legacy-read path**. The app does not need to render old 8-field rows through the new panel. Old rows are **re-enriched wholesale by prompt v14** on next access (or by a batch re-run), producing native new-shape rows.
- The `prompt_version` column already distinguishes shapes: v13 (and earlier) rows are old-shape; v14+ rows are new-shape. A reader can branch on version if a transition window ever needs it — but with no backwards-compat requirement, the cleaner path is to re-enrich and not read old rows through the new code at all.
- The transformer (`concept-migration.ts`) therefore exists for **one purpose only**: scaffolding the new gold exemplars for hand-authoring (Session 5). It is *not* a production runtime dependency.
- **Additive at the DB layer:** no `ALTER TABLE`. The shape lives entirely inside the existing `analysis` JSONB column. Adding the new model is a code change, not a schema migration.

---

## 5. The exemplar / jury constraint (§8.5) — unchanged, respected

`scripts/voice-audit/exemplars.ts::loadGoldExemplars()` parses every `exemplars/*.json` through the **old** `SongAnalysisLyricalSchema`. New-model fields cannot live in those files without breaking the pairwise jury. So:

- The transformer writes to `scripts/voice-audit/exemplars-v14-draft/` — a **separate** directory the loader never touches.
- Promoting drafts to live gold is **Session 5** work (voice-audit migration): hand-author `lens`/`contradiction`/`take`, then re-point the loader + jury at the new shape.

---

## 6. Prompt rules this schema implies (for Session 4, not enforced in Zod)

These are deliberately **out of Zod** (envelope stays permissive) but the prompt must carry them:

1. `lens` must use one of the three locked forms (`X as/of/with Y` · `X into Y` · `Verb-ing the X`); draw from `concept-lens-vocabulary.md`.
2. `tension` = qualified emotion (modifier + core), **not** a paradox.
3. `take` elastic 1–3 sentences; match the song's actual depth; permission to be brief/flat on surface-true songs.
4. `arc` floor 2, `mood` may repeat; do not manufacture movement on monochrome songs.
5. `lines` floor 1; do not pad to a quota on one-idea songs.
6. Foreign-language `lines`: quote the original line + a parenthetical English gloss (diagnostic Pattern A). `lens` is always English.
7. `contradiction`: emit `null` when the song holds no irreducible contradiction; do not invent one.
8. `theme_tags`: 1–3 from the controlled vocab (when that vocab exists).

---

## 7. What's explicitly NOT done here

- Prompt v14 (Session 4).
- The `theme_tags[]` controlled vocabulary (separate artifact; only its *shape* — string[] ≤3, future enum — is scoped here).
- Voice-audit migration / `lens-coherence` judge / promoting drafts to gold (Session 5).
- Wiring the new schema into `SongAnalysisService.analyzeSong` generation path (Session 4+, when v14 exists).
- Any UI change (Session 6).
