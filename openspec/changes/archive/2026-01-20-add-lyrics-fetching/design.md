## Context
The analysis pipeline currently emits songs with empty lyrics, yet `SongAnalysisService.analyzeSong()` requires lyrics. v0 (`old_app`) contains a complete Genius-based lyrics flow (search strategy, HTML parsing, annotation formatting) that was never ported to v1.

## Goals / Non-Goals
- Goals:
  - Ensure the analysis pipeline receives lyrics before analysis.
  - Reuse the v0 Genius integration and heuristics to minimize new risk.
  - Respect provider rate limits and avoid persistent storage issues.
- Non-Goals:
  - Building a lyrics UI or editing workflow.
  - Supporting multiple providers in v1.
  - Long-term lyrics persistence unless explicitly approved.

## Decisions
- Decision: Implement runtime lyrics fetching via a `LyricsService` ported from `old_app` and invoke it as a prefetch step in the analysis pipeline.
  - Rationale: Matches proven v0 behavior, avoids DB migration, and minimizes architectural churn.
- Decision: Use in-memory, per-batch caching to avoid duplicate requests during a single analysis run.
  - Rationale: Improves throughput without storing lyrics long-term.

## Alternatives considered
- Persist lyrics to a database table.
  - Rejected for now due to potential provider ToS concerns and additional migration overhead.
- Skip analysis for songs lacking lyrics.
  - Rejected because it does not resolve the current functional gap.

## Risks / Trade-offs
- Provider rate limits or downtime could slow analysis.
  - Mitigation: concurrency limits + request spacing + graceful fallback to `NoLyricsError`.
- Lyrics storage policy ambiguity.
  - Mitigation: keep runtime fetching; revisit persistence only with explicit approval.

## Migration Plan
1. Port `old_app` lyrics modules into `src/lib/services/lyrics/`.
2. Wire `LyricsService` into `AnalysisPipeline` prefetch step.
3. Add Genius token configuration and guardrails for missing env vars.
4. Add tests for query strategy, parsing, and pipeline integration.

## Open Questions
- Should we add a persisted cache once provider ToS are confirmed?
- Should failures skip songs or retry with exponential backoff?
- Should we include Genius annotations in the output (v0 did, richer context for LLM prompts)?
- Should we port `TrackPrefetchService` as a standalone module or embed the cache contract inside `AnalysisPipeline`?
