# Architecture Docs

Start here for the fastest mental model.

Docs are organized topic-first; status lives in each file's frontmatter
(`status: proposed | accepted | ...`), not in the folder name. See the
repo-wide conventions in [`../README.md`](../README.md).

- **root of a topic folder** = current-state canonical reference
- **an initiative folder** (e.g. [`account-events/`](./account-events/)) = one body of work with its whole lifecycle (research → proposal → decision) in one place
- **`proposals/`**, **`audits/`** under a long-lived domain = future work / dated reviews for that domain

## Core reference

| Path | Purpose |
| --- | --- |
| [`system-overview.md`](./system-overview.md) | Whole-system view: extension sync, job system, enrichment, matching, review, Spotify write-back |
| [`matching/overview.md`](./matching/overview.md) | How playlist matching works: inputs, profiling, scoring, normalization, reranking |
| [`library-processing.md`](./library-processing.md) | Control plane for scheduling `enrichment` and `match_snapshot_refresh` |
| [`module-boundaries.md`](./module-boundaries.md) | Ownership rules for `src/lib/*` modules |
| [`onboarding.md`](./onboarding.md) | Walkthrough onboarding system: steps, modules, step→route mapping |

## Initiatives (topic folders with their own lifecycle)

| Path | Purpose |
| --- | --- |
| [`account-events/`](./account-events/) | Portable account-scoped browser-push system (research spike + proposal) replacing browser polling for background-job freshness |

## Audits & reviews (dated)

| Path | Purpose |
| --- | --- |
| [`audits/deepening-opportunities-2026-07-02.md`](./audits/deepening-opportunities-2026-07-02.md) | Architecture review: ranked refactor candidates for deepening shallow modules |
| [`audits/architecture-patterns-review-2026-07-02.md`](./audits/architecture-patterns-review-2026-07-02.md) | System-wide pattern review: layering, TanStack usage, type/error boundaries, worker lifecycle, React patterns — top-10 improvement plan |
| [`audits/production-readiness-audit-2026-06-09.md`](./audits/production-readiness-audit-2026-06-09.md) | Production-readiness audit: gaps and follow-ups before shipping |

## Matching reference deep dives

| Path | Purpose |
| --- | --- |
| [`matching/score-normalization.md`](./matching/score-normalization.md) | Why fusion normalizes signals across the full candidate matrix |
| [`matching/reranker.md`](./matching/reranker.md) | Cross-encoder reranking and offline replay evaluation |
| [`matching/research/lyrics-matching.md`](./matching/research/lyrics-matching.md) | Genius→LRCLIB lyric-matching research and eval-harness methodology |
| [`matching/roadmap.md`](./matching/roadmap.md) | Consolidated matching research and prioritized roadmap |

## Matching proposals (future work)

| Path | Purpose |
| --- | --- |
| [`matching/proposals/progressive-match-feed.md`](./matching/proposals/progressive-match-feed.md) | Future incremental-feed architecture and measurement gate for deciding if the refactor is worth it |
| [`matching/proposals/immutable-proposal-versions.md`](./matching/proposals/immutable-proposal-versions.md) | Follow-up plan to make match-deck proposal builds immutable/versioned and remove rebuild races at the root |
| [`matching/proposals/deck-read-model.md`](./matching/proposals/deck-read-model.md) | Long-term `/match` read-model refactor plan |
| [`matching/proposals/first-page-fast-playlist-match-cards.md`](./matching/proposals/first-page-fast-playlist-match-cards.md) | First-page-fast match cards + match-review client seam |
