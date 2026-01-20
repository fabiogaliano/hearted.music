# Change: Add runtime lyrics fetching to analysis pipeline

## Why
AnalysisPipeline currently supplies empty lyrics while SongAnalysisService requires non-empty lyrics, causing analyses to fail. The v0 `old_app` implementation already proved a working Genius-based lyrics flow that can be ported with minimal architectural disruption.

## What Changes
- Add a lyrics service (Genius integration, search strategy, HTML parsing) ported from `old_app`.
- Prefetch lyrics before analysis so `analyzeSong` receives text or a typed `NoLyricsError`.
- Add environment configuration for the Genius access token and rate limiting defaults.
- Add tests for query strategy, HTML parsing, and pipeline integration.

## Impact
- Affected specs: new `lyrics` capability (change spec); existing data-flow spec remains unchanged.
- Affected code: `src/lib/services/analysis/pipeline.ts`, `src/lib/services/analysis/song-analysis.ts`, new `src/lib/services/lyrics/`, env config.
