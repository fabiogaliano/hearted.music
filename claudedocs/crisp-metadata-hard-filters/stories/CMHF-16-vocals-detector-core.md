# CMHF-16 — Vocals detector core

## Goal

Add a deterministic local detector for unambiguous vocal-gender phrases in matching intent text.

## Depends on / blocks

- Depends on: CMHF-01.
- Blocks: CMHF-17 and CMHF-18.

## Scope

In scope:

- Add a detector module near `src/lib/domains/taste/match-filters/`.
- Detect female and male vocal-gender keyword families listed in the plan, plus deliberate tested expansions if added.
- Return a typed result that distinguishes absent, ambiguous, and unambiguous female/male detections.
- Add tests for broad phrases, singular/plural words, hyphenated terms, ambiguity, and no hidden inference.

Out of scope:

- Editor integration and dismissal behavior.
- Backfill script.
- LLM/provider/external inference.
- Changing saved `matchIntent` text.

## Likely touchpoints

- `src/lib/domains/taste/match-filters/vocals-detector.ts` or similar concrete module.
- Tests under `src/lib/domains/taste/match-filters/__tests__/`.

## Constraints and decisions to honor

Reference `crisp-metadata-hard-filters-decisions.md` sections 5 and 9.

- Detector scope is vocal gender only.
- Detector is deterministic and local.
- No provider env vars, LLM calls, artist-name guesses, images, or external inference.
- If both female and male signals are detected, do not auto-fill unless a rule is explicitly unambiguous.
- Detector does not overwrite existing draft/saved `vocalGender`; callers enforce that.

## Acceptance criteria

- Detector recognizes initial female keyword families from the plan.
- Detector recognizes initial male keyword families from the plan.
- Mixed male+female text returns ambiguous unless covered by an explicit tested unambiguous rule.
- Text with no relevant signal returns absent.
- Tests prove no inference from artist names or unrelated terms.
- Public detector return type is narrow and safe for editor/backfill callers.
- Relevant `bun run test` coverage passes.

## Notes on risks or ambiguity

- Broad words like `girl` and `boy` may false-positive; add phrase-boundary tests deliberately.
- Prefer conservative ambiguity over hidden inference.
