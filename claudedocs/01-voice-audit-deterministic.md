# Handoff — Phase 1: Deterministic encode + data plumbing

**Read first:** `claudedocs/00-voice-audit-program.md` (orientation + the cross-cutting
calibration discipline) and `claudedocs/hearted-audit-principles.md` (the rule set).

You are encoding the *mechanical* principles into Tier-1 and building the annotations data
path. Everything here is free, test-driven, and low-risk — no LLM calls, no calibration
judgment beyond "do the 9 golds still pass." Do NOT touch the LLM judges (Phase 2) or write
any prompt (Phase 3).

## Mission

Make Tier-1 faithfully reflect the gate rules the golds embody, and make vote-gated
annotations available to the pipeline — without breaking the 9 golds.

## Tasks

### A. New Tier-1 rules (`scripts/voice-audit/tier1/rules.ts` + `__tests__/rules.test.ts`)

All three are tagged `layer: tier1(NEW)`, `rec: KEEP`, and gold-validated in the principles doc.

1. **MEC-10 — structural-section names in prose.** Ban `refrain|verse|chorus|bridge|hook|
   intro|outro|pre-chorus|pre chorus` in the **prose fields only** (image, take, arc[i].scene,
   contradiction, texture). Must NOT scan `lines` and must NOT scan arc[i].`label` (those are
   house-form event names like "The Reckoning"). Severity HIGH. Gold-validated: GR2 already
   fixed dtmf's "The chorus lands:" scene, so the golds are clean.
2. **ARC-14 — mood width.** Each `arc[i].mood` must be ≥ 2 words (reject a lone bare emotion
   like "Yearning" / "Arrival"). ARC-3 allows 2–3 words and moods may repeat across beats —
   only the single-word case fails. Severity MED. Gold-validated: GR1 fixed blinding-lights
   ("Lonely Yearning" / "Blinded Resolve").
3. **TEN-6 — tension ≠ arc mood.** The two-word `tension` must not duplicate any
   `arc[i].mood` verbatim (case-insensitive). Severity LOW/MED (your call; the doc says
   "tier1(NEW dedup) or editorial").

### B. Patch existing Tier-1 rules

4. **MEC-7 — self-reference.** Add `the album` to the wordlist. Do **not** add bare
   `the song` — GR3 keeps it editorial (dtmf's gold uses "inside the song" deliberately).
5. **MEC-5 — book-report-opener.** Add field-start framing openers `It is`, `It's`,
   `This song is` to the existing fixed-opener list (it only fires at field start).
6. **MEC-4 — remove the intra-word-hyphen penalty** from the `dash` rule and delete/adjust
   its assertion in `rules.test.ts` (the doc CUT it: "late-night", "neon-lit" are allowed).
   **Leave em-dash parity grading (MEC-3) untouched.**

### C. Annotations data plumbing (GRD-9 / GRD-6 / LIN-9)

The annotations exist in `exemplars/lyrics/*.json` (each annotation has `text`,
`votes_total`, `verified`, `state`, `pinnedRole`) but never reach any prompt. Build the
selection/formatting utility here so Phase 3 can wire it into the v17 template.

7. Build `selectGroundingAnnotations(lyricsDoc, { minVotes })` + `renderAnnotationsBlock()`
   (suggested home: `scripts/voice-audit/` next to `merge-annotations.ts`, or a shared
   `content-analysis/` util if you want prod to share it later). The **GRD-6 vote gate is
   `votes_total > 15`**, i.e. `minVotes = 16` (strictly greater than 15). Output a compact,
   model-readable block keyed to the line each annotation explains. Unit-test it against
   2–3 real `lyrics/*.json` files (Not Like Us = rich; No Sex for Ben = zero, must yield an
   empty block, not crash).
   - Do NOT modify any prompt template here. Phase 3 consumes this utility. Just build + test
     the data path, so v17 has a clean function to call.

## The gold self-consistency gate (the calibration step)

After A + B, run the full updated `runAllRules()` over all 9 `exemplars/*.json`. **Every gold
must produce 0 HIGH and 0 MEDIUM hits.** Add this as an enforced test (a loop over the 9
golds) if one doesn't already exist. If a gold fails:
- real gold bug → fix the gold + log it in the principles doc revision log (like GR1/GR2);
- rule too aggressive → fix the rule and note the scope caveat.

Never silence a failure by weakening the assertion.

## Done criteria

- [ ] MEC-10, ARC-14, TEN-6 implemented with tests.
- [ ] self-reference (+"the album") and book-report-opener (+"It is"/"This song is") patched.
- [ ] MEC-4 intra-word-hyphen penalty removed; its test case removed/updated; MEC-3 intact.
- [ ] `selectGroundingAnnotations` + `renderAnnotationsBlock` built + unit-tested (vote gate >15).
- [ ] All 9 golds: 0 high / 0 medium under `runAllRules()`, enforced by a test.
- [ ] `bun run test scripts/voice-audit/__tests__` green.

## Hand to Phase 2

Append a "Progress so far" block to this file: which rules landed, any gold edits + why,
the exact signature of the annotation utility (Phase 3 imports it), and any rule you
*considered but deferred* to editorial.

---

## Progress so far — Phase 1 COMPLETE (2026-06-05)

All done-criteria met. `bun run test scripts/voice-audit/__tests__` green (**95/95**, was 72);
`bun run typecheck` clean (exit 0). No production code flipped (research-only, per program scope).

### Rules that landed — `scripts/voice-audit/tier1/rules.ts`

New, registered in `ALL_RULES`:
- **`structuralSection`** (MEC-10, **HIGH**) — bans `refrain|verse|chorus|bridge|hook|intro|outro|pre-chorus|pre chorus`
  in the **interpretive** prose only: `prose(a).filter(f => f.name !== "texture")` → image, take,
  contradiction, arc[i].scene. Never scans `lines`, arc `label`, arc `mood`, `lens`, `tension`.
  **`texture` is deliberately excluded** — see the GR6 decision below.
- **`moodWidth`** (ARC-14, **MED**) — flags any `arc[i].mood` with `< 2` whitespace-separated words.
- **`tensionMoodDedup`** (TEN-6, **MED**) — flags any `arc[i].mood` equal to `tension`, case-insensitive
  exact. **Tension-vs-mood only.** Beat-vs-beat mood repeats are intentionally *not* gated (ARC-3: monochrome
  songs honestly repeat moods).

Patches to existing rules:
- **MEC-7** `selfReference` — added `"the album"`. Did **not** add `"the song"` (GR3 keeps it editorial).
- **MEC-5** `bookReportOpener` — added field-start `"It is"`, `"It's"`, `"This song is"` (fires at field start only;
  ordered so `"It's not just"` still wins its longer span).
- **MEC-4** `dashes` — intra-word-hyphen penalty **removed** (`if (intraWord) continue;`); `hyphenSpan` helper
  deleted. A spaced hyphen standing in for a dash ("first - then") still flags MED. **MEC-3 em-dash parity
  grading untouched.**

### The gold-vs-rule conflict found this phase — GR6 (logged in principles §K)

The 9-gold sweep surfaced one conflict: **as-it-was** `texture` says *"ringing hollow underneath each hook"* —
"hook" is an MEC-10 term, but here it names the **sonic motif** (a legit sound description, not "The chorus
lands:" structural-naming). Per the standing rule (fix the principle unless the gold is a clear straggler bug),
**I scoped the rule, not the gold**: MEC-10 excludes `texture` (the sound field, GRD-8). The principles-doc
MEC-10 enumeration already listed only (take, scene, image, contradiction); this handoff's task A1 adding
`texture` was the over-reach. **No gold was edited.**

### Gold / fixture edits

- **No gold edited.** All 9 `exemplars/*.json` are byte-unchanged; they pass the new gate as-is.
- **One tier1 fixture fixed** (not a gold): `__tests__/fixtures/clean.json` arc[1].scene
  `"A refrain that almost breaks…"` → `"A held note that almost breaks…"`. It carried an accidental
  structural word that predates MEC-10 and would have broken the "clean fixture is clean" test. Its arc
  *labels* ("Verse 1"/"Chorus"/"Bridge"/"Outro") were left alone — MEC-10 correctly never scans `.label`.

### The gold self-consistency gate (enforced)

`scripts/voice-audit/__tests__/exemplars.test.ts` → "every gold produces zero HIGH and zero MEDIUM tier-1 hits
(Phase 1 gate)": loops all 9 golds, asserts `runAllRules(g.read).filter(h => h.severity !== "low") === []`,
with a failure message naming the offending `rule@field:"span"`. (LOW rules — burstiness, rule-of-three,
lexical-repetition, paired dashes — stay diagnostic/non-gating; dtmf shows 4 LOW lexical-repetition, expected.)

### Annotation data path — for Phase 3 to import (GRD-6 / GRD-9 / LIN-9)

**File:** `src/lib/domains/enrichment/content-analysis/grounding-annotations.ts` (prod-shareable; pure, no DB —
imports only the `LyricsDocument` / `AnnotationInfo` *types*). Test: `__tests__/grounding-annotations.test.ts`.

```ts
import {
  selectGroundingAnnotations,   // (doc: LyricsDocument, opts?: { minVotes?: number }) => SelectedAnnotation[]
  renderAnnotationsBlock,        // (selected: SelectedAnnotation[]) => string  ("" when empty)
  GROUNDING_MIN_VOTES,           // 16  (votes_total >= 16  ≡  GRD-6's "> 15")
  type SelectedAnnotation,       // { section, lineId, line, text, votes_total, verified, state?, pinnedRole? }
} from "@/lib/domains/enrichment/content-analysis/grounding-annotations";
```

- Input is the **`LyricsDocument`** (i.e. `envelope.lyrics.document` from `exemplars/lyrics/<key>.json`), not the
  whole envelope.
- GRD-6 floor is the **default**; pass `{ minVotes }` to override. The DB already pre-filtered spam at ingest
  (`isAnnotationWorthKeeping`: editor-approved OR ≥10 votes); this gate is the stricter grounding layer on top.
- Selection is in reading order (LIN-3); `renderAnnotationsBlock` groups notes under their line, stamps votes,
  collapses each note's internal whitespace to one paragraph, and **does not truncate** (no silent cap — Phase 3
  owns any length budget).
- Verified against real data: not-like-us (62 above gate, rich), beautiful-things (gate bites: 5 stored → 1),
  no-sex-for-ben (0 → empty block, no crash), plus a synthetic strict-`>15` boundary (15 out, 16 in).

### Considered but deferred to editorial / later phases (not automated here)

- **TEN-6 beat-vs-beat** mood dedup — left out on purpose (ARC-3 allows repeated moods).
- The **MEC-6 "move" extension** ("it isn't X, it's Y"), **SFT-1 kicker**, **SFT-5 fragmentation**,
  **SFT-2/7/8/9**, **ARC-5/6/7/8/10/11/12/15**, **IMG-3/4**, **XCT-1 redundancy** — these are tier2/editorial
  per the principles; **out of Phase 1 scope** (Phase 2 judges + the v17 prompt + human review). No tier1 noise added.
- The **prompt halves** of MEC-5/MEC-7/MEC-10/ARC-14 and the **annotations slot** (GRD-9) are Phase 3 prompt work.
