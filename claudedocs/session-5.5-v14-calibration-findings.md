# Session 5.5 — v14 Calibration Findings

**Date:** 2026-05-31
**Status:** In progress (mid-session). v14 measured; v15 is the first iteration and a clear win on every targeted Tier-1 axis, but not yet at the zero-high bar. Pairwise Opus judge **run** (first pass): v14 and v15 both lose every judged pair to gold — but on **specificity + texture accuracy**, not voice mechanics (see below). Gold set **expanded 4 → 9** to measure that frontier across more lyric variance. Cost model **corrected**: judging is free (plan-covered local CLI), only generation costs money.
**Mode:** Measurement + prompt-iteration (NOT engineering). Schema / lens grammar / vocabulary stay locked (Sessions 1–3).

---

## TL;DR

v14 was generated and measured for the first time (n=3 across the 10-song lyric diagnostic, temp 0.3). It had one dominant defect — **participial-closure was 87% of all high-severity Tier-1 hits** — plus ceiling-pinned cardinality and a moderate abstract-lens drift. A single targeted iteration (**v15**) cut mean-high **2.14 → 0.70 (−67%)**, unpinned the arc (now 3–6, was 79%-at-6), and made lenses concrete + lowercase. v15 is **not yet zero-high**: self-reference and book-report-opener in `lines[].insight` are stubborn. The next iteration (v16) targets those; then the paid pairwise judge.

## Methodology (note for future sessions)

- **Versioned iterations, not in-place edits.** v14 is kept **pristine as the control** (it is the prompt that produced the baseline numbers). Each improvement is a new version (v15, v16, …). The `Number(version) >= 14` gate in `regen.ts`/`song-analysis.ts` fires for all of them, and `report-experiments.ts` keys on `promptVersion`, so v14-vs-v15 comparison is clean and automatic. **Do not overwrite v14.**
- **Pre-v14 versions are frozen legacy.** v2–v13 emit the old 8-field schema (`SongAnalysisLyricalSchema`); `regen.ts` refuses to score them under the read-shape rules. They are historical reference only and irrelevant to this calibration.
- **One change → one measurable.** v15 bundled six edits, but each targets a *different* metric (participial → mean-high; padding → arc/lines distribution; lens → casing/concreteness), so deltas stay attributable despite bundling.
- **Cost model (corrected mid-session — the original brief was wrong).** Generation (gemini-2.5-flash, ~5k tok/read) is single-digit cents for the whole 28–30-run diagnostic, and the metric is high-variance (v14 Houdini `[7,6,0]`), so **keep n=3**. The pairwise Opus judge is **NOT billed**: it runs the local `claude` CLI (`tier2/claude-cli.ts` → `claude -p --model opus`), which is plan-covered; the `total_cost_usd` it prints is notional. So **judge early and often** — the old "defer the judge until Tier-1 is clean / cap at `--limit 2`" ordering is **void**. Only Vertex/Gemini generation calls cost real money.

## v14 baseline (control) — 28 runs

- **mean-high 2.14 / mean-medium 0.46.**
- High by rule: **participial-closure 52** (87%), self-reference 4, book-report-opener 2, antithesis 2.
- Worst songs (mean-high): No Sex for Ben 5.3, Houdini 4.3, As It Was 2.7. Cleanest: Beautiful Things 0.3, Ribs 0.3 (genuinely deep songs handled fine).
- **Cardinality pinned to the ceiling:** arc = 6 on 79% of reads (5×5, 4×1; never 2–3); lines = 5 on 64% (rest 4; never 1–3). The "permission to be brief" never fired — a content-zero chant got the same 6-beat / 5-line read as a layered ballad.
- **Lens:** all 28 are real claims (none hit the banned-noun kill-list, so the master §13 kill-switch did **not** fire), but ~⅓ drifted abstract (`happiness as precarity`, `elusiveness as test`, `change as isolation`) and casing was inconsistent (~half Title-Cased). The model also missed the vocabulary's own worked answers (As It Was → it gave `Nostalgia as Isolation`; vocab says `brightness as the lie`).

## v15 (iteration 1) — 30 runs, six changes

The six edits to `lyrical-v15.ts` (diff vs v14 = exactly these, verified):
1. comma-plus-`-ing` ban now covers the **-ing-adjective** case ("a single, exhilarating night") + arc-scene/insight examples + a pre-finish self-check.
2. `lines` insight and `arc` scene field specs **reinforce the voice rules at point-of-use** (no comma+`-ing`, no "This is"/"It is", no "the speaker/listener", no "is not X", no puffery).
3. Cardinality made **structural, not maximal**: arc length tracks the song's distinct sections; lines quote only distinct insights; explicit anti-padding clause.
4. Lens spec demands a **picturable concrete Y** + **lowercase** casing.
5. Puffery list adds adverb forms ("profoundly") + the two leaked copula verbs (`frames`, `acts as`).
6. (Global) added "the listener" to the self-reference ban.

### Results vs v14

| Metric | v14 | v15 |
|---|---|---|
| mean-high / read | 2.14 | **0.70** (−67%) |
| participial-closure (high) | 52 | 13 (−75%) |
| antithesis (high) | 2 | **0** |
| self-reference (high) | 4 | 5 (unchanged) |
| book-report-opener (high) | 2 | 3 (unchanged) |
| arc length dist | {6:79%,5,4×1} | **{6:9,5:15,4:5,3:1}** |
| lines length dist | {5,4} | **{5:17,4:11,3:2}** |
| lens casing | ~half Title | **100% lowercase** |
| mean-medium | 0.46 | 0.47 |
| puffery (medium) | 9 | 12 |
| schema fails | 2 | 0 |

### What landed
- **Participial-closure −75%.** Houdini 4.3→0.33, As It Was 2.7→0.0, Forever 1.7→0.67.
- **Cardinality honest.** No Sex for Ben produced an `arc=3 / lines=3 / contradiction=null / 0-high` read — the first genuinely surface-true read. Arc spread 3–6 centered on 5.
- **Lens concreteness + casing.** `joy as a countdown`, `joy as a hostage`, `blessing as a threat` (Beautiful Things); `home as a quiet cell` (As It Was); `youth as phantom limb`, `innocence as a fading photograph` (Ribs); `first love as blueprint`, `memory as a future ghost` (Thinkin). All lowercase.

### What did NOT improve (→ v16 targets)
- **Not zero-high.** 21 highs / 30 runs remain.
- **self-reference (5) + book-report-opener (3) are stubborn**, concentrated in `lines[].insight` ("This is a call to…", "the speaker"). The point-of-use reminder helped participial but not these.
- **Puffery ticked up** (9→12); "profound" still leaks despite the adverb addition. Medium, not gating, but a quality smell.
- **A few lenses still abstract** (DtMF `memory as present` / `present as a past echo` — repetitive and abstract). Houdini got `elusiveness as invitation` / `testing the limits` — closer to the vocab's `flirtation as a power dare` but not there.
- **dash low-severity hits rose** 3→19 — these are the `G-funk`/`synth-pop` hyphenated-compound false positives (Tier-1 rule limitation, master-brief says do not chase). Not a v15 defect.

## Pairwise Opus judge — first run (the real frontier)

Ran the free pairwise judge (v14 and v15 vs the original 4 golds, `--limit 2`). **Both lost
every judged pair (win+tie ≈ 0%).** The signal is in the *rationale*, not the score: the judge
rarely cited the voice mechanics v15 fixed. It cited **specificity and texture accuracy** —
the read asserts a sonic/genre texture that is wrong (Motion Sickness rendered as an "acoustic
lullaby"; it is jangly, propulsive indie rock) or stays a notch more generic than gold. So
v15's mechanical win is real but **orthogonal** to why it loses. Caveats: small sample
(`--limit 2`, 4 dense songs); re-judge on the now-9 golds for a firmer number. The judge also
**praised gold quality** on the design goals — independent corroboration that retires the
earlier gold-provenance worry.

→ **v16 target shifts** from "more Tier-1 cleanup" to **texture grounding + concrete
specificity** (the `texture`, `image`, `lines[].insight`, `arc[].scene` fields). Tier-1
remains the cheap secondary guardrail.

## Gold set expanded (4 → 9)

To measure the specificity/texture frontier across lyric variance the original 4 golds missed,
added 5 reads (Opus-drafted to the voice rules, **prose unreviewed by the user**, schema-valid,
Tier-1-clean — no high, no dash): **dtmf** (foreign-language + parenthetical glosses),
**no-sex-for-ben** (short surface-true chant: arc=3, lines=2, `contradiction:null`),
**beautiful-things** (monochrome deep dread), **pink-pony-club** (two-act narrative),
**as-it-was** (tempo-vs-emotion gap). Files in `scripts/voice-audit/exemplars/`, registered in
`index.json`, keyed by `spotifyTrackId`. DtMF carried a real id; the other 4 use a **stable
slug** join-key mirrored in `regen.ts` SONGS + `index.json` (not a real Spotify id, only
string-matched; lyric cache is keyed by artist/title so nothing about fetching changes).
`exemplars.test.ts` updated to expect all 9 keys; suite green. **5 of the 9 golds are inside the
`diagnostic` tier**, so a diagnostic run is now directly judge-able for them. Full table +
mechanism in `session-5.5-continued-handoff.md` → "Gold set". Two **pre-existing** golds
(drivers-license, blinding-lights) carry a high participial-closure hit the suite intentionally
does not gate — flagged there as optional answer-key polish.

## Evidence touching the master §8.2 working assumptions (per §8.3)

- **§13 kill-switch did NOT fire.** The "lens slop at scale" abort signal is about lenses degenerating into mood-tags / banned abstract nouns. Across 58 generated lenses (v14+v15), **zero** used the banned nouns; all are X-as-Y/X-into-Y/Verb-ing claims. The v14 drift was *toward abstract-but-defensible Y*, and v15's concrete-Y nudge corrected most of it. The concept holds.
- **§8.2-6 (cardinality).** The ceiling-pinning was a **generation behavior**, not a schema problem — the Zod envelope `arc[2,6]`/`lines[1,5]` was correct; the prompt just defaulted to the ceiling. A prompt fix (v15) unpinned it without any schema change. No push-back on the working assumption.
- **§9-5 (surface over-prescription).** Confirmed and now partially mitigated in generation: surface-true songs *can* get short reads (No Sex for Ben arc=3) once the prompt makes brevity structural. The schema never blocked it.
- **No schema / vocabulary / grammar change was needed or made.** All locked artifacts (Sessions 1–3) are untouched.

## Files
- `src/.../prompts/lyrical-v14.ts` — control, pristine (reverted after an exploratory edit).
- `src/.../prompts/lyrical-v15.ts` — iteration 1 (registered "15").
- `src/.../prompts/registry.ts` — v15 added to `LYRICAL_PROMPTS`. `ACTIVE_LYRICAL_VERSION` still "13" (untouched; the flip is Session 6).
- `scripts/voice-audit/experiments/` — v14 (28) + v15 (30) run records (untracked).
- `scripts/voice-audit/exemplars/` — gold set, expanded 4 → 9 this session (+ `index.json`).
- Aggregation helper was a throwaway (`/tmp/agg-version.ts`); deleted — recreate in ~5 min if `report-experiments.ts` isn't granular enough.

## Status of the acceptance bars (Session 5.5 brief)
- Tier-1 zero-high: **not yet** (v15 mean-high 0.70, down from 2.14) — now a *secondary* bar; the judge reframed the primary target to texture/specificity.
- lens-coherence judge: **not yet run** on v15.
- Pairwise Opus judge: **run** (first pass) — v14 & v15 both 0% win+tie vs the original 4 golds; loss is texture/specificity, not mechanics. Re-judge on the 9-gold set for a firmer baseline.
- Qualitative: tension = qualified emotion ✓; no banned abstract-noun lenses ✓; surface songs route short ✓ (partial); foreign-language gloss — not yet spot-checked on v15 DtMF.
