# S3-02 · Orchestrator Per-Song Stage Sub-Batching

## Goal

Update the enrichment orchestrator to run each stage against the exact sub-batch that needs it, implementing the Phase A (unbounded) / Phase B+C (entitled) split.

## Why

The orchestrator currently runs all 4 stages for every selected song. Under billing, audio features and genre tagging run for all songs (Phase A), while LLM analysis and embedding run only for entitled songs (Phase B/C). The orchestrator must consume the work plan from S3-01 and dispatch each stage to its correct sub-batch.

## Depends on

- S3-01 (enrichment selector + work plan types)

## Blocks

- S3-03 (content activation runs after shared stages)
- S3-04 (progress accounting depends on stage sub-batching)

## Scope

- Update `src/lib/workflows/enrichment-pipeline/orchestrator.ts`:
  - Parse the work plan into per-stage sub-batches
  - Run `audio_features` stage only on songs with `needs_audio_features`
  - Run `genre_tagging` stage only on songs with `needs_genre_tagging`
  - Run `song_analysis` stage only on songs with `needs_analysis`
  - Run `song_embedding` stage only on songs with `needs_embedding`
  - Content activation is handled by S3-03 (placeholder call site here)
- Stage runners themselves (`stages/*`) remain unchanged — they are already per-batch
- Snapshot candidate eligibility before and after stages (for `newCandidatesAvailable` delta)

## Out of scope

- Content activation implementation (S3-03)
- Removing `markPipelineProcessed` calls (S3-04)
- Progress accounting changes (S3-04)
- Read-model changes

## Likely touchpoints

| Area | Files |
|---|---|
| Orchestrator | `src/lib/workflows/enrichment-pipeline/orchestrator.ts` |

## Constraints / decisions to honor

- One enrichment workflow — no second durable workflow for Phase A vs B/C
- Stage runners remain idempotent
- The orchestrator runs stages in order: audio_features → genre_tagging → song_analysis → song_embedding → (content_activation placeholder)
- `newCandidatesAvailable` computed from before/after candidate snapshots

## Acceptance criteria

- [ ] Phase A stages run for songs regardless of entitlement
- [ ] Phase B/C stages run only for songs with `needs_analysis` / `needs_embedding`
- [ ] Songs that only need Phase A work do not get analysis or embedding stages
- [ ] Candidate eligibility snapshot taken before and after stages
- [ ] Stage sub-batches derived from work plan, not hardcoded
- [ ] Existing stage runner interfaces unchanged

## Verification

- Test: song with only Phase A needs → only audio_features + genre_tagging run
- Test: entitled song needing all stages → all four stages run
- `bun run test` passes

## Parallelization notes

- **Hot file**: `orchestrator.ts` — coordinate with S3-03 and S3-04
- Should merge before S3-03 (content activation adds another step to orchestrator)

## Suggested PR title

`feat(billing): enrichment orchestrator per-song stage sub-batching`
