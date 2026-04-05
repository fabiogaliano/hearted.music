# S3-04 · Remove Legacy item_status Writes + Progress Accounting

## Goal

Remove `markPipelineProcessed()` from the orchestrator (content activation now handles `item_status`) and update enrichment progress accounting to derive totals from planned stage work.

## Why

`markPipelineProcessed()` writes `item_status` after all enrichment stages, regardless of entitlement. This conflicts with the new semantics where `item_status` means "account-visible content activated." Progress accounting currently assumes `songs × 4` stages; it must derive from the actual work plan flags.

## Depends on

- S3-03 (content activation has taken over `item_status` writes)

## Blocks

- None directly

## Scope

- Remove `markPipelineProcessed()` call from the orchestrator
- Verify no other code path writes `item_status` for non-entitled songs (search for other callers)
- Update `src/lib/workflows/enrichment-pipeline/progress.ts`:
  - Totals derived from planned stage work per song (sum of `true` flags)
  - Include content activation as a stage in the count
  - Progress no longer assumes a fixed number of stages per song

## Out of scope

- Content activation implementation (S3-03)
- Read-model changes

## Likely touchpoints

| Area | Files |
|---|---|
| Orchestrator | `src/lib/workflows/enrichment-pipeline/orchestrator.ts` |
| Progress | `src/lib/workflows/enrichment-pipeline/progress.ts` |
| Status queries | `src/lib/domains/library/liked-songs/status-queries.ts` (verify `markPipelineProcessed` usage) |

## Constraints / decisions to honor

- `item_status` is written only by content activation
- Progress accounting must be accurate for songs with mixed stage needs
- `markPipelineProcessed` may still be used by devtools — if so, scope appropriately

## Acceptance criteria

- [ ] `markPipelineProcessed()` no longer called from orchestrator production path
- [ ] No code path writes `item_status` for non-entitled songs
- [ ] Progress totals reflect actual planned work, not `songs × 4`
- [ ] Progress is accurate for Phase-A-only songs (fewer stages)
- [ ] Project compiles and tests pass

## Verification

- Grep for `markPipelineProcessed` usage — only devtools/test remaining
- Unit test: progress for mixed work plan
- `bun run test` passes

## Parallelization notes

- **Hot file**: `orchestrator.ts` — must land after S3-03
- Can run in parallel with all read-model stories

## Suggested PR title

`refactor(billing): remove legacy item_status writes, update progress accounting`
