# voice-audit variant changelog

Append-only log of evaluated prompt variants. One row per captured eval artifact. This is the
durable record the prompt-tuning loop diffs against — never rewrite past rows; only append.

Each row records the variant, the eval conditions, and the scoreboard read at capture time:

- **variant** — prompt version @ temperature, generator model
- **runs/song** — must be ODD for any variant compared inferentially (guarantees a song-level
  majority and preserves the full n=9)
- **win-or-tie** — marginal successes / determinate songs, with the Wilson 95% band
- **artifact** — path to the persisted `EvalArtifact` the scoreboard read
- **notes** — gate state, length-effect flag, anything the next iteration must know

At n=9 a row is descriptive, not a verdict. Significance (McNemar mid-p in a paired comparison)
is a strong positive when it appears; its absence means "too noisy to trust", not "edit bad".

## How a baseline/variant row is captured (WP5)

```bash
# 1. Generate (odd runs/song) over the nine golds — PAID generation.
bun scripts/voice-audit/regen.ts --version 17 --songs golds --runs 3 --temperature 0.3

# 2. Evaluate vs gold and persist the artifact — PAID Opus pairwise judging (~$3.78 @ 3 runs).
bun scripts/voice-audit/evaluate.ts --version 17 --temperature 0.3 --limit 3 \
  --out scripts/voice-audit/eval-artifacts/v17-base.json

# 3. Read the scoreboard.
bun scripts/voice-audit/scoreboard.ts scripts/voice-audit/eval-artifacts/v17-base.json

# 4. Append the row below.
```

## Rows

<!-- date | variant | runs/song | win-or-tie (Wilson95) | artifact | notes -->

_None yet. The first row is the v17 hardened-eval baseline (WP5), captured only after WP1–WP4 land._

---

# Phase 4 — prompt-iteration history (2026-06-06 → 06-08)

The record of the prompt-tuning rounds. Distilled from the working changelog; the `lyrical-vNN.ts`
files in `content-analysis/prompts/` are themselves the in-tree experiment artifacts, and each cites
its hypothesis (`Hn`) here. **None of v18–v30 beat v17** — they stay registered as the record only.

## Standing conclusions (do not re-litigate)

1. **v17 is the converged-best prompt.** Authored straight from the read spec's principles; it closed
   the v14/v15 specificity + grounding gap entirely. No later edit (v18–v30) beat it.
2. **The antithesis pivot ("X is not Y. It is Z") cannot be prompted away — it must be GATED away.**
   It is a Gemini-2.5 base-model default (~0.28–0.38/cand on Flash, ~1.13 on pro), essentially
   independent of how the prompt addresses it. **Showing the literal pivot string as a "Wrong:" example
   makes it worse** (v20). Prohibition, demonstration, and removal all failed. The reliable levers are
   non-generation: the tier1 `antithesis` gate + regenerate-on-hit, or the post-generation rewrite pass.
3. **NO-GO on matching the golds — and register is not why.** Across paid Opus pairwise (0/54, 0/27),
   v17 and every rewrite tie **zero** golds. The gap is three classes, only one promptable:
   (a) residual MEDIUM/ungated register (puffery, data-speak, book-report openers tier1 misses);
   (b) **depth / specific noticing** a surgical rewrite structurally cannot add; (c) **correctness /
   grounding** errors a rewrite faithfully preserves. (b)+(c) are the wall; only generation-side levers
   (gold-dense few-shot, fine-tune, stronger model) can reach them — none is a prompt edit.
4. **The dominant tier1 tell is `participial-closure` (~3.4/read), not the pivot** — and 0% of
   candidates are fully HIGH-clean, so regenerate-on-hit can't reach tier1-clean. Only the rewrite pass
   (which fixes participial + antithesis + self-reference together) gets there.

## Variant → verdict

| variant | hypothesis | lever | verdict |
|---|---|---|---|
| v18 | — | regroup arc | dead (McNemar 1.000; worse on redundancy/voice-softness) |
| v19 | H1 | blocklist essayistic openers | routed around (new openers substituted) — REVERT |
| v20 | H2 | concrete behavioral ban + `Wrong:` examples | **worse** (priming spikes the pivot to 0.56) — REVERT |
| v21 | H3 | demonstration: examples above the rule-wall | insufficient; pairwise back to 0 — REVERT |
| v22 | H4 | PRIMING test: remove v17's anti-pivot line | no mention → 0.38 (worse than v17's 0.28) — REVERT |
| v23 | H5 | pure-affirmative, no guardrail | **worst (0.44)** — v17's explicit caution does real work — REVERT |
| v24 | H6 | copula-displacement | cleanest free score but partly rule-dodging; gain within noise — REVERT |
| v25 | H7 | micro-exemplars | genuine 2nd-person voice transfer, but adds pivots at take-closings — REVERT |
| v26 | H8 | purge spelled `Wrong:` strings | flat-to-worse (0.36) — REVERT |
| v27 | H9 | category-level naming | SAFE (0.31 ≈ v17); better-phrased caution, not a win — optional wording refinement |
| v28 | H10 | synthesis (v24 + v25) | did not stack (0.29 ≈ v17) — REVERT |
| v29 | H11 | positive-menu generation | flat-to-worse (0.30 vs 0.23); adds book-report + self-ref — REVERT |
| v30 | H13 | XML wrapper on generation | built, not run (XML was a no-op on the rewrite side) |

Probes: P1/P2 (model swap Flash → gemini-2.5-pro) hit a ceiling at ~17% / 1-of-8, length-driven and
register still pervasive. H12 (direct-assertion rewrite) = a validated content-safe register cleaner,
interchangeable with the minimal rewrite; ties zero golds (0/27).

## Where it landed (shipped)

- **Session-6 cutover (commits 7e7b6ae / 8c77cfa):** `ACTIVE_LYRICAL_VERSION = "17"`. Prod runs v17
  **raw generation** (no `{example}` few-shot — H14 measured the lever at −0.07 HIGH/read on the real
  population, noise, so it was NOT wired in).
- **Rewrite pass wired into prod (H16, 2026-06-08, user-approved):** the tier1 rules engine + rewrite
  pass were promoted out of `scripts/` into `content-analysis/voice/` (`tier1-rules.ts`, `burstiness.ts`,
  `rules-types.ts`, `rewrite-pass.ts`); `song-analysis.ts` runs `rewriteRead` on every lyrical read
  before store (instrumental analyses skip it; on any error it returns the original, so it can only
  improve or no-op). Measured on the real population: **−96% surface tells, 90% of reads fully
  HIGH-clean, ≈0% length drift**, for +1 Flash call (~3.4k tokens)/song. This is a PIPELINE change, not
  a prompt-version flip — `ACTIVE` stays "17". It cleans how reads SOUND; it does **not** close the
  depth/correctness gap to gold (conclusion 3).
