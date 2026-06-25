# MSR-06 — Queue/session orientation schema and lifecycle migration

## Goal

Make sessions and queue items capable of representing independent song and playlist match passes with valid subject constraints.

## Depends on / blocks

Depends on:

- MSR-01
- MSR-05

Blocks:

- MSR-18
- MSR-19
- MSR-20
- MSR-22

## Scope and out of scope

In scope:

- Add `match_review_session.orientation` and replace one-active index with one-active-per-orientation.
- Add `match_review_queue_item.orientation`, nullable `song_id`, `playlist_id`, `source_fit_score`, and `visible_pairs_captured_at`.
- Drop old nullable-unsafe unique indexes and add orientation-specific partial unique indexes.
- Add exactly-one-subject check and split lifecycle constraints.
- Add `match_review_session_snapshot.visibility_config_hash` and primary key update.
- Regenerate DB types.

Out of scope:

- Queue service behavior changes.
- Visible-pair table.
- Mutation RPC rewrites.

## Likely touchpoints

- `supabase/migrations/**match_review_queue**`
- `src/lib/data/database.types.ts`

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` C5, C6, C7, C8, C9, B9, B10.
- Do not keep old `(session_id, song_id)` unique indexes after `song_id` becomes nullable.
- State and resolution must remain separate.

## Acceptance criteria

- Migrations apply with existing song-mode rows defaulting to `orientation = 'song'`.
- One active session is allowed per `(account_id, orientation)`.
- Queue item subject check rejects invalid or mixed subject rows.
- Session snapshot idempotency key includes `visibility_config_hash`.

## Notes on risks or ambiguity

- Primary-key changes can break callers until MSR-19; keep this migration close to the service migration.
- Backfill/defaults must preserve existing song-mode data.
