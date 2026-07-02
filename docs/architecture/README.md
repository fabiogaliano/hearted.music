# Architecture Docs

Start here for the fastest mental model.

## Core docs

| Path | Purpose |
| --- | --- |
| [`system-overview.md`](./system-overview.md) | Whole-system view: extension sync, job system, enrichment, matching, review, Spotify write-back |
| [`matching/overview.md`](./matching/overview.md) | How playlist matching works: inputs, profiling, scoring, normalization, reranking |
| [`library-processing.md`](./library-processing.md) | Control plane for scheduling `enrichment` and `match_snapshot_refresh` |
| [`module-boundaries.md`](./module-boundaries.md) | Ownership rules for `src/lib/*` modules |
| [`onboarding.md`](./onboarding.md) | Walkthrough onboarding system: steps, modules, step→route mapping |
| [`deepening-opportunities-2026-07-02.md`](./deepening-opportunities-2026-07-02.md) | Architecture review: ranked refactor candidates for deepening shallow modules |

## Matching deep dives

| Path | Purpose |
| --- | --- |
| [`matching/score-normalization.md`](./matching/score-normalization.md) | Why fusion normalizes signals across the full candidate matrix |
| [`matching/reranker.md`](./matching/reranker.md) | Cross-encoder reranking and offline replay evaluation |
| [`matching/progressive-match-feed.md`](./matching/progressive-match-feed.md) | Future incremental-feed architecture and measurement gate for deciding if the refactor is worth it |
| [`matching/roadmap.md`](./matching/roadmap.md) | Consolidated matching research and prioritized roadmap |
