# Block 1 implementation plan — harden the eval before the v17 loop

This is the implementation plan for **BLOCK 1** of `claudedocs/05-voice-audit-eval-hardening.md`.

It is rewritten for **execution by an AI coding agent**:
- use **small, independent work packages**
- reference **files + symbols**, not drifting line numbers
- define **done criteria** and **non-goals** up front
- avoid plan branches that force the agent to invent architecture mid-flight

Date: 2026-06-06.

---

## 0. What this block must achieve

Before the Phase-03/04 prompt loop runs, the eval must be good enough that the loop does **not** optimize on:
1. **gold leakage**,
2. **noise misread as signal**, or
3. **uncalibrated judge behavior**.

The loop ships whatever prompt it selects as the first production release. So Block 1 is not "nice to have" instrumentation work. It is the release-safety work.

---

## 1. The hard constraints

These constraints should shape every implementation choice.

### Statistical constraint: n = 9 through release

The eval set stays at **9 gold songs** until after ship.

Implications:
- treat the **song** as the unit of generalization
- do **not** count `9 songs × runs` as a larger n
- use significance as a **noise veto**, not a keep gate
- rely on **per-song gates** and **judge quality** for release safety

At n=9:
- Wilson intervals on win-rate are wide
- McNemar only fires on very large same-direction flips
- a 1-song change is descriptive, not persuasive

### Scope constraints

Do **not** let implementation drift into these:
- growing the eval set
- cross-provider judge juries
- embedding/wordlist refresh work
- production panel cutover
- broad experiment-store refactors
- prompt-search automation

Those are Block 3 or later.

### Safety constraints

- **Do not** flip `ACTIVE_LYRICAL_VERSION` from `"13"` in Block 1.
- **Do not** rewrite existing experiment history formats unless the change is strictly additive.
- **Do not** make `SongAnalysisService` fetch golds, exemplars, or annotations on its own.
- **Do not** silently change the optimization target away from pairwise-vs-gold.

---

## 2. Success criteria for Block 1

Block 1 is complete when all of these are true:

1. **v17 exists and is registered** but production still ships v13.
2. **Eval generation can inject examples without leakage** via leave-one-out selection.
3. **Prompt builders support an annotations block** and an example block without hardcoding gold text into the template.
4. **All 8 tier-2 judges emit rationale/evidence before verdict** in structured output order.
5. **Grounding judge is cite-or-fail** and has a small calibration harness.
6. **A scoreboard can compare two variants at song level** with:
   - per-variant win-rate
   - Wilson CI
   - McNemar mid-p for paired diff
   - per-song verdict table
   - length delta surfaced, not hidden
7. **A v17 baseline artifact is captured only after items 1–6 are in place.**

If any of 1–6 is incomplete, the baseline is not trustworthy yet.

---

## 3. Current code facts the plan must respect

Grounded in the current tree:

- Eval generation lives in `scripts/voice-audit/regen.ts`.
- Eval scoring lives in `scripts/voice-audit/evaluate.ts`.
- Descriptive stats live in `scripts/voice-audit/stats.ts`.
- Gold reads load from `scripts/voice-audit/exemplars.ts`.
- Grounding context for golds already exists in `scripts/voice-audit/lyrics-context.ts`.
- Production lyrical prompt assembly is in `src/lib/domains/enrichment/content-analysis/song-analysis.ts`.
  - This file path matters: it is **not** `scripts/voice-audit/song-analysis.ts`.
- Prompt registration is in `src/lib/domains/enrichment/content-analysis/prompts/registry.ts`.
- Grounding annotation selection/rendering already exists in
  `src/lib/domains/enrichment/content-analysis/grounding-annotations.ts`.
- The structured-output tier-2 schemas are in `scripts/voice-audit/tier2/schemas.ts`.
- There are **8** tier-2 judges total:
  - 7 schema-based judges via `judge.ts`
  - 1 Opus grounding judge via `grounding-judge.ts`

This means Block 1 should mostly be **targeted additions**, not architectural invention.

---

## 4. Implementation order

Use this order. It is chosen to minimize rebasing and re-baselining.

### Parallelizable first wave

- **WP1** — v17 prompt + runtime injection surfaces
- **WP2** — stats + scoreboard
- **WP3** — rationale-before-verdict across tier-2 judges

These three are genuinely independent if multiple agents are working. The serialized order in §6 is only the recommended order for **one** agent working alone.

### Then

- **WP4** — grounding cite-or-fail + calibration harness

### Join point

- **WP5** — capture the v17 baseline

WP5 depends on WP1–WP4. Do not baseline earlier.

---

## 5. Work packages

## WP1 — v17 prompt with runtime-injected example + annotations slots

### Goal

Create v17 without baking gold text into the prompt file, and make eval use leave-one-out examples.

### Files

- new `src/lib/domains/enrichment/content-analysis/prompts/lyrical-v17.ts`
- `src/lib/domains/enrichment/content-analysis/prompts/registry.ts`
- `scripts/voice-audit/regen.ts`
- `scripts/voice-audit/exemplars.ts`
- `src/lib/domains/enrichment/content-analysis/song-analysis.ts`

### Required implementation shape

1. Create `lyrical-v17.ts` from v16.
2. Add template slots:
   - `{example}`
   - `{annotations}`
3. Register version `"17"` in `registry.ts`.
4. Leave `ACTIVE_LYRICAL_VERSION = "13"` unchanged.
5. Add a small helper near `exemplars.ts` that renders 1–2 gold exemplars into a few-shot block.
   - Keep it a pure formatter.
   - Do not make it select songs, load files by side effect, or know about prod vs eval.
6. In `regen.ts`, inject examples with a **fixed ordered pool** and **leave-one-out** selection.
7. In `regen.ts`, also populate `{annotations}` per song from the same grounding source the judge uses — `scripts/voice-audit/lyrics-context.ts` / the shared grounding-annotation selector — so eval and prod both see the song's vote-gated annotations. Unlike examples, annotations are **not** leave-one-out; there is no leakage risk in letting a song see its own annotations.
8. In `song-analysis.ts`, extend `AnalyzeSongInput` to accept optional injected blocks rather than teaching the service how to fetch them.

### Locked decisions

- Number of worked examples: **2**
- Fixed prod pair: **Not Like Us + Pink Pony Club**
- Eval pool order: **Not Like Us, Pink Pony Club, Motion Sickness**
- For the current song, take the first 2 pool entries whose song is not the current one.
- Eval should inject the current song's own vote-gated annotations block from the shared grounding data path; no exclusion rule applies there.
- `{annotations}` should be wired as an optional injected block; empty string is valid.

### Anti-derail notes

- Do **not** paste exemplar JSON directly into `lyrical-v17.ts`.
- Do **not** fetch gold exemplars from production code.
- Do **not** solve genre-matched examples in Block 1.
- Do **not** expand this into a general prompt-composition framework.
- Keep the selection rule deterministic and visible in code.

### Done when

- `getLyricalPrompt("17")` resolves.
- v17 template contains `{example}` and `{annotations}`.
- `regen.ts` can build a prompt for every gold without ever injecting that song's own gold.
- `song-analysis.ts` can accept prebuilt `exampleText` / `annotationsBlock` without changing existing callers.
- Production active version is still 13.

### Verify

- targeted unit tests for example selection / formatting
- `bun run test scripts/voice-audit/__tests__`

---

## WP2 — stats layer + scoreboard, designed for n=9

### Goal

Turn the current console-only evaluator into a variant-comparison tool that the prompt loop can safely use.

### Files

- `scripts/voice-audit/stats.ts`
- new `scripts/voice-audit/scoreboard.ts`
- `scripts/voice-audit/evaluate.ts`
- `scripts/voice-audit/experiments.ts` or a new additive eval-artifact file, if needed
- tests under `scripts/voice-audit/__tests__/`

### Required implementation shape

#### 1. Add pure inferential helpers to `stats.ts`

Add:
```ts
export function wilsonInterval(successes: number, n: number, z = 1.96): { lo: number; hi: number }
export function mcnemarMidP(b: number, c: number): { p: number; b: number; c: number }
```

Definitions to lock now:
- For `wilsonInterval`, `successes` = the number of **songs** whose collapsed outcome is **WIN or TIE vs gold** for that variant.
- That WIN-or-TIE collapse makes the outcome a true binary proportion, which is why Wilson applies cleanly here.
- If the project ever changes to **ties = 0.5** scoring, this is no longer a simple binomial proportion and the CI method must change.
- For `mcnemarMidP(A, B)`, the actual inputs are the discordant counts `b` and `c` from a **paired variant-vs-variant** comparison: `b = songs where variant A succeeds and variant B fails`; `c = songs where variant A fails and variant B succeeds`.

Keep them:
- pure
- small
- unit-tested against fixed values

#### 2. Persist eval results as an explicit artifact

`evaluate.ts` currently prints results and discards them. Block 1 needs a saved artifact for later diffing.

Use one explicit persisted shape. Keep it additive.

Minimum artifact contents:
- variant identity: prompt version, model, temperature, timestamp
- per-song run list
- per-run verdict vs gold
- per-song derived outcome used by the scoreboard
- per-song candidate/gold word counts
- tier-1 counts

#### 3. Make scoreboard read **song-level** outcomes

This is the most important anti-derail rule in the whole plan:

- multiple runs for one song are **repeated measures**, not extra n
- scoreboard inference operates on **9 songs**, not on candidate rows
- McNemar is a **paired A-vs-B test**, not a single-variant test

So the scoreboard must:
1. load raw per-run results
2. collapse them to **one song-level outcome per variant per song**
3. compute, for each variant separately, its marginal WIN-or-TIE success count and Wilson CI
4. compute, for an A-vs-B comparison, the paired discordant counts across songs:
   - `b = songs where A succeeds and B fails`
   - `c = songs where A fails and B succeeds`
5. run `mcnemarMidP(b, c)` on those discordant counts only

Do **not** compute McNemar from one variant's internal win/loss mix vs gold. That is meaningless.

#### 4. Pick the collapse rule now

Do not leave this ambiguous for the implementer.

Required rule:
- for any **new** variant you intend to compare inferentially, use an **odd** number of runs per song
- song-level `success` = majority of runs where candidate is **WIN or TIE** vs gold
- odd runs are required because they guarantee a song-level majority and preserve the full `n = 9`
- if **legacy** historical data has an even split, mark the song **indeterminate** and block automatic keep/revert

This prevents the scoreboard from faking certainty out of 2-run splits and from accidentally shrinking McNemar to `n = 8` or `n = 7`.

#### 5. Surface length effects, but do not overbuild

Add a simple per-song length delta:
- `candidate.wordCount - gold.wordCount`

Also print a lightweight correlation flag if verdict tracks length suspiciously.

Do **not** build the full LC-AlpacaEval-style regression in Block 1.

### Decision rule the scoreboard should support

The scoreboard is there to support this rule:

- never keep an edit on a 1-song wobble alone
- keep only if there is:
  - no gate regression,
  - song-spread improvement,
  - rationale agreement on why it improved,
  - no obvious length gaming
- McNemar significance is a strong positive when it appears
- absence of significance means **"too noisy to trust"**, not **"edit proven bad"**

### Anti-derail notes

- Do **not** bootstrap the simple win-rate at n=9.
- Do **not** treat candidate rows as independent samples.
- Do **not** build a giant experiment database.
- Do **not** bury the n=9 warning in docs only; print it in the scoreboard output.

### Done when

- `stats.ts` exports tested Wilson + McNemar helpers.
- `evaluate.ts` can emit a persisted eval artifact.
- `scoreboard.ts` can compare two eval artifacts and print:
  - per-song outcomes
  - per-variant win-rate + Wilson CI
  - paired McNemar p + discordant counts
  - length deltas
  - the n=9 warning note

### Verify

- unit tests for `wilsonInterval` and `mcnemarMidP`
- one smoke run on stored/historical data if available
- `bun run test scripts/voice-audit/__tests__`

---

## WP3 — rationale-before-verdict across all 8 judges

### Goal

Force the judges to reason before they emit the pass/fail boolean.

### Files

- `scripts/voice-audit/tier2/schemas.ts`
- `scripts/voice-audit/tier2/prompts/*.ts`
- any judge regression harness already used for tier-2 validation

### Required implementation shape

1. Physically reorder each schema so rationale/evidence fields appear **before** the verdict boolean.
2. Update prompts so they instruct the model to:
   - examine evidence first
   - explain briefly
   - decide last
3. Keep semantics unchanged beyond output order and prompt wording.

For example, schemas of this form:
- `specific, generic_sentences, rationale`

should become this shape:
- `rationale, generic_sentences, specific`

Exact field order should match the reasoning flow of that judge.

### Anti-derail notes

- Reordering prompt text alone is not enough.
- Reordering schema fields without prompt updates is incomplete.
- Do not redesign judge scoring logic here.
- Do not mix this with cross-provider work.

### Done when

- all 8 judges emit reasoning fields before verdict fields
- prompts explicitly say reason first, decide last
- gold pass cases still pass
- known negative fixtures still fail

### Verify

- existing judge regression CLI/harness
- `bun run test scripts/voice-audit/__tests__`

---

## WP4 — grounding judge hardening: cite-or-fail + calibration harness

### Goal

Make grounding trustworthy enough to be part of the release bar.

### Files

- `scripts/voice-audit/tier2/prompts/grounding.ts`
- `scripts/voice-audit/tier2/grounding-judge.ts`
- `scripts/voice-audit/lyrics-context.ts`
- new small fixtures/harness files under `scripts/voice-audit/`

### Required implementation shape

#### A. Cite-or-fail grounding

Change grounding so a passed claim must be grounded by cited evidence from:
- heard lyrics, or
- vote-gated annotations

This should be visible in the prompt contract, not just in prose comments.

Minimum change:
- require explicit grounding evidence for passed claims
- fail claims that cannot cite support
- keep `paratextual_flags` separate from hard fail

#### B. Self-consistency harness

Add a small script or helper that:
- runs a judge 2–3 times on the same input
- records pass/fail flips
- records agreement rate

Run it at the judge's real operating temperature/model path, not an artificial deterministic mode.

#### C. Graded subtle-negative fixture set

Add a small checked-in fixture set of **subtle** grounding negatives.

Keep it small and explicit. This is not a labeling project.

The fixture should cover cases like:
- true real-world fact unsupported by lyrics/annotations
- biography imported from outside the song
- reception/legacy claim
- fabricated setting detail

Severity labels can be simple and checked-in.

### Targets

- self-agreement target: **0.8 desired**, **0.7 floor**
- κ on the subtle-negative fixture is a **directional calibration signal**, not a solo release gate on a tiny fixture
- use **plain Cohen's κ** only for the binary pass/fail decision vs the checked-in label
- if severity grades need to affect the metric, that is **weighted κ** and should be treated as a later extension, not assumed implicitly here
- for the binary pass/fail fixture, κ **0.6** is the rough floor for "substantial" agreement, but interpret it alongside raw agreement and self-consistency because small fixtures make κ jumpy

### Anti-derail notes

- Do not build a UI or dataset pipeline for this.
- Do not widen scope to all judges before grounding is working.
- Do not use a single obvious negative as the only calibration proof.
- Do not let the grounding judge use outside knowledge.

### Done when

- grounding prompt requires explicit support for passes
- a grounding calibration harness exists and runs
- a subtle-negative fixture exists in repo
- calibration outputs are recorded and interpretable
- the harness output makes clear whether it is reporting raw agreement, binary Cohen's κ, or both

### Verify

- run the harness on the 9 golds and the subtle negatives
- `bun run test scripts/voice-audit/__tests__`

---

## WP5 — capture the v17 baseline

### Goal

Capture the baseline only after the eval is trustworthy.

### Preconditions

All of WP1–WP4 are complete.

### Cost / runtime expectation

Use the current code's own cost note as the planning baseline: `scripts/voice-audit/evaluate.ts` documents pairwise judging at roughly **$0.14 per judged pair**.

That means the pairwise portion alone is roughly:
- **9 songs × 1 run** ≈ **$1.26**
- **9 songs × 3 runs** ≈ **$3.78**

WP4 grounding calibration adds additional Opus cost that scales linearly with **cases × repeats**, and WP5 baseline capture adds generation time on top. Treat WP4 and WP5 as deliberate paid runs, not something to trigger casually inside every edit loop.

### Steps

1. Generate v17 runs across the 9 golds.
2. Evaluate them against gold.
3. Persist the eval artifact.
4. Run the scoreboard on the baseline artifact.
5. Log the baseline row in `experiments/changelog.md` or equivalent append-only file.

### Anti-derail notes

- Do not baseline before judge order changes land.
- Do not baseline before grounding cite-or-fail lands.
- Do not compare future variants against an older pre-hardening baseline.

### Done when

- there is one canonical `v17-base` eval artifact
- the scoreboard renders it successfully
- the baseline row is logged with CI and notes

---

## 6. Recommended execution granularity for an AI coding agent

This is the safest breakdown for implementation sessions:

1. **PR / session 1** — WP2 stats helpers + tests
2. **PR / session 2** — WP2 eval artifact + scoreboard
3. **PR / session 3** — WP3 schema reordering + prompt edits
4. **PR / session 4** — WP1 v17 prompt + runtime injection
5. **PR / session 5** — WP4 grounding cite-or-fail
6. **PR / session 6** — WP4 calibration harness + fixtures
7. **PR / session 7** — WP5 baseline capture

Why this order works well for an AI agent:
- starts with the most deterministic code
- avoids mixing prompt work and stats work in one change
- keeps re-baselining risk low
- makes failures local and reversible

This section is a **single-agent** execution order. It does not contradict §4's note that WP1/WP2/WP3 are parallelizable.

If only one item is started first, start with **WP2**.

---

## 7. Explicit non-goals for Block 1

These are intentionally out of scope even if they are good ideas:

- grow the eval set beyond 9
- add OpenAI/Anthropic/Google judge juries
- build length-controlled regression
- refresh AI-slop wordlists
- automate prompt search
- flip production to v17
- change the UI/panel/query layer for the new read model

If implementation starts drifting into any of these, stop and cut scope back.

---

## 8. Minimal command checklist

Use these as the verification spine while implementing:

```bash
bun run test scripts/voice-audit/__tests__

bun scripts/voice-audit/regen.ts --version 17 --songs not-like-us --runs 1
bun scripts/voice-audit/evaluate.ts --version 17 --limit 1
# scoreboard command to be added in WP2
```

For any baseline or real variant comparison, use an **odd** run count per song. Treat even-run histories as legacy fallback only.

---

## 9. Research notes: keep, but do not re-litigate during implementation

The research reasoning is already captured in:
- `claudedocs/05-voice-audit-eval-hardening.md`
- `claudedocs/00-voice-audit-program.md`

For Block 1 implementation, the important locked choices are:
- Wilson for marginal WIN-or-TIE success rate
- McNemar mid-p for paired variant-vs-variant discordance
- leave-one-out few-shot injection
- rationale/evidence before verdict
- grounding cite-or-fail

`claudedocs/06-block1-implementation-plan.md` **supersedes** `claudedocs/05-voice-audit-eval-hardening.md` on the CI/test implementation details, especially the Wilson-vs-bootstrap choice for simple win-rates.

Do not reopen those choices unless the code reveals a concrete incompatibility.

---

## 10. Bottom line

The shortest version of this plan is:

- **WP2** makes the scoreboard honest.
- **WP1** removes leakage.
- **WP3** stops judges from deciding before reasoning.
- **WP4** makes grounding release-safe.
- **WP5** captures the first baseline only after the instrument is trustworthy.

That is the version of Block 1 that an AI coding agent can implement without getting lost or shipping a misleading baseline.
