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
