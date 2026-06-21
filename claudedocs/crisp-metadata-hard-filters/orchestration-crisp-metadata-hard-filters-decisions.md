# Orchestration deviation log — crisp metadata hard filters

This log records decisions made during autonomous orchestration that were not
spelled out in the plan/decisions/stories. Each entry: what was decided + one-line
rationale.

## Run context

- Branch: `feat/crisp-metadata-hard-filters` (off `main`). Commits stay local; never pushed.
- Scope: CMHF-01..18 end-to-end (production-wired). CMHF-19 skipped (deferred; depends on
  a future create-playlist feature that does not exist yet).
- CMHF-18 backfill: built + tested, default dry-run, **not executed** against any data.
- UI: new dedicated Ladle group `Match Filters/*`. Diverge (2-3 directions) for high-variance
  controls (LanguagePicker, ReleaseYearControl, LikedDateTimeline); single best version for
  simple atoms; converge to one pick for production wiring.
- Ladle review gate (CMHF-06 blocks CMHF-13) is **overridden per user instruction**: production
  wiring proceeds on best design judgment; the component lab is left for the user to iterate.
- On blocker: log + skip the blocked story, continue the rest, sleep at end regardless (per user).
- Unrelated pre-existing working-tree changes (`control-panel/.../EmailSection.tsx`,
  `scripts/spotify-probe/`, `claudedocs/spotify-probe-output.json`, `claudedocs/archives/`) are
  left untouched; feature commits use explicit paths so these are never swept in.

## Decisions

- (none yet)
