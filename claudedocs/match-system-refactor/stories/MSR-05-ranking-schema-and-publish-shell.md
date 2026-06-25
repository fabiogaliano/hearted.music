# MSR-05 — Ranking schema and publish RPC compatibility shell

## Goal

Add the orientation-specific ranking table and make snapshot publication payloads backward-compatible with nested ranking rows.

## Depends on / blocks

Depends on:

- MSR-04

Blocks:

- MSR-14
- MSR-15
- MSR-17
- MSR-22

## Scope and out of scope

In scope:

- Add `match_result_ranking` table with columns, checks, FK, uniqueness, and partial rank indexes.
- Update `publish_match_snapshot` so older callers without `rankings` still publish successfully.
- If full insertion is deferred to MSR-17, add only safe JSON parsing/ignore behavior here.
- Regenerate `src/lib/data/database.types.ts`.

Out of scope:

- Ranking module implementation.
- Snapshot hash changes.
- Read paths using rankings.

## Likely touchpoints

- `supabase/migrations/**`
- `src/lib/data/database.types.ts`
- Publish RPC migration for `publish_match_snapshot`

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` C1, C2, C3, C4, D1, D2.
- Ranking rows are authoritative for model ordering; `match_result.score/rank` remain legacy compatibility fields.
- Partial unique rank indexes enforce one dense rank per served suggestion list.

## Acceptance criteria

- Migration applies cleanly.
- Generated DB types include `match_result_ranking`.
- Legacy publish payloads without nested `rankings` still work.
- Ranking table enforces orientation/source/document-mode checks.

## Notes on risks or ambiguity

- Do not break existing snapshot publication while ranking code is still absent.
- Coordinate migration ordering with other schema stories because `database.types.ts` is a hot generated file.
