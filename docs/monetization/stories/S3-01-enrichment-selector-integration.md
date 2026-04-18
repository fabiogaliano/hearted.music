# S3-01 · Enrichment Selector Integration

## Goal

Wire the enrichment orchestrator to use `select_liked_song_ids_needing_enrichment_work` and parse per-song stage flags into sub-batches.

## Why

The current selector returns a flat list of songs needing full processing. The billing-aware selector returns per-song stage flags that the orchestrator must parse to determine which stages to run for each song. This is the foundational wiring for Phase A/B/C split.

## Depends on

- S1-11 (billing-aware selector RPC)
- S1-12 (generated types)
- S2-01 (billing domain types)

## Blocks

- S3-02 (stage sub-batching uses the parsed flags)
- S3-03 (content activation uses `needs_content_activation` flag)

## Scope

- Update `src/lib/workflows/enrichment-pipeline/batch.ts`:
  - Call `select_liked_song_ids_needing_enrichment_work` instead of `select_liked_song_ids_needing_pipeline_processing`
  - Parse the returned rows into a work plan: per-song stage flags
  - Export a typed work plan structure (e.g., `EnrichmentWorkPlan`)
- Update `src/lib/workflows/enrichment-pipeline/types.ts` if needed for work plan types

## Out of scope

- Stage sub-batching in orchestrator (S3-02)
- Content activation stage (S3-03)
- Removing the old selector (can coexist until S3-02 lands)
- Read-model changes

## Likely touchpoints

| Area | Files |
|---|---|
| Batch selector | `src/lib/workflows/enrichment-pipeline/batch.ts` |
| Types | `src/lib/workflows/enrichment-pipeline/types.ts` |

## Constraints / decisions to honor

- Stage flag names are frozen: `needs_audio_features`, `needs_genre_tagging`, `needs_analysis`, `needs_embedding`, `needs_content_activation`
- A song is returned when ANY flag is true
- Ordering: most-recent-liked first

## Acceptance criteria

- [ ] `batch.ts` calls the new selector RPC
- [ ] Work plan correctly partitions songs by stage needs
- [ ] TypeScript types for the work plan are clean and explicit
- [ ] Project compiles

## Verification

- Unit test: mock selector output → correct work plan parsing
- `tsc --noEmit` passes

## Parallelization notes

- Can start as soon as Phase 2 contracts merge
- Touches `batch.ts` — should not conflict with read-model work (S3-07+)
- Must merge before S3-02

## Suggested PR title

`feat(billing): wire enrichment selector with per-song stage flags`
