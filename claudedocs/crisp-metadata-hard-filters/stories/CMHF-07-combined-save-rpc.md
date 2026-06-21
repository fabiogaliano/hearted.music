# CMHF-07 — Combined save RPC

## Goal

Add `savePlaylistMatchConfig` as the all-or-nothing server save for matching intent, genre pills, and match filters.

## Depends on / blocks

- Depends on: CMHF-01 and CMHF-02.
- Blocks: CMHF-15 and CMHF-18.

## Scope

In scope:

- Add server input/output types for `SavePlaylistMatchConfigInput` and `SavePlaylistMatchConfigResult`.
- Add `savePlaylistMatchConfig` in `src/lib/server/playlists.functions.ts`.
- Add a playlist query helper that writes `match_intent`, `genre_pills`, and `match_filters` together.
- Verify playlist ownership using current account/session.
- Trim only leading/trailing whitespace from `matchIntent`; preserve internal whitespace/newlines; empty becomes `null`.
- Sanitize `genrePills` with existing sanitizer.
- Validate and normalize `matchFilters` with the strict save parser.
- Emit existing metadata-changed invalidation after successful write.
- Treat invalidation failure after write as logged degraded success.
- Add server/query tests for ownership, normalization, validation failure, write failure, invalidation success, and invalidation degraded success.

Out of scope:

- Production UI callers switching to this RPC.
- Options read RPC.
- Backfill script.
- Deleting old RPCs unless no production/test caller needs them in this PR.

## Likely touchpoints

- `src/lib/server/playlists.functions.ts`
- `src/lib/domains/library/playlists/queries.ts`
- `src/lib/workflows/library-processing/service.ts`
- `src/lib/workflows/library-processing/changes/playlist-management.ts`
- `src/lib/server/__tests__/playlists.functions.test.ts` or nearby server tests.

## Constraints and decisions to honor

Reference `crisp-metadata-hard-filters-decisions.md` sections 1, 3, 6, and 10.

- RPC name is `savePlaylistMatchConfig`.
- Input/output field names are `playlistId`, `matchIntent`, `genrePills`, and `matchFilters`.
- Write all three fields together; validation/write failure must not partially save.
- Unknown filter keys reject save payloads.
- Invalidation failure after a successful write is non-fatal.
- Existing separate save functions should be refactored away from production callers once CMHF-15 lands.

## Acceptance criteria

- Valid save writes normalized `match_intent`, sanitized `genre_pills`, and normalized `match_filters` in one update.
- Ownership failure returns/throws the existing not-found style error and writes nothing.
- Invalid filters write nothing.
- DB write failure does not emit invalidation.
- Invalidation failure after write logs and still returns normalized values.
- Tests cover trim-only `matchIntent` normalization with preserved internal whitespace/newlines.
- Relevant `bun run test` coverage passes.

## Notes on risks or ambiguity

- Current production code saves intent and genres separately in parallel; do not update that behavior here unless CMHF-15 is in the same branch.
- Keep error messages actionable but avoid leaking cross-account playlist existence.
