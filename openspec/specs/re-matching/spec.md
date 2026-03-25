# Re-matching Specification

> **DEPRECATED** — This spec has been removed by the `target-playlist-match-refresh` change.

---

## Removed Requirements

All requirements in this spec have been replaced by the `target-playlist-match-refresh` capability:

- **Re-match Operation** — Replaced by refresh workflow snapshot publication
- **Re-match is Separate from Pipeline** — Replaced by refresh workflow that owns target-playlist-side enrichment, profiling, and publishing under one job type
- **Playlist Change Detection** — Replaced by target-playlist-aware sync and onboarding planners with execution-time DB reads
- **Re-match Trigger Integration** — Replaced by `target_playlist_match_refresh` jobs with coalescing via `rerunRequested`

See: [target-playlist-match-refresh spec](/openspec/specs/target-playlist-match-refresh/spec.md)
