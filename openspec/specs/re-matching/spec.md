# Re-matching Specification

> **DEPRECATED** — This spec has been removed by the `target-playlist-match-refresh` change.

---

## Removed Requirements

All requirements in this spec have been replaced by the `target-playlist-match-refresh` and `library-processing` capabilities:

- **Re-match Operation** — Replaced by refresh workflow snapshot publication
- **Re-match is Separate from Pipeline** — Replaced by library-processing-managed `match_snapshot_refresh` jobs where liked-song enrichment remains candidate-side only
- **Playlist Change Detection** — Replaced by target-playlist-aware sync and onboarding planners with execution-time DB reads
- **Re-match Trigger Integration** — Replaced by library-processing change application and scheduler-owned refresh re-ensure

See: [target-playlist-match-refresh spec](/openspec/specs/target-playlist-match-refresh/spec.md), [library-processing spec](/openspec/specs/library-processing/spec.md)
