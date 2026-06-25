# MSR-07 — Visible-pair capture and event/decision context schema

## Goal

Add persistent captured visible pairs and the event/decision columns needed to log what the user actually saw.

## Depends on / blocks

Depends on:

- MSR-06

Blocks:

- MSR-23
- MSR-24
- MSR-26
- MSR-27
- MSR-28

## Scope and out of scope

In scope:

- Create `match_review_item_visible_pair` with PK, FKs, rank/score constraints, and indexes.
- Rename event/decision rank columns to `model_rank`/`visible_rank` as specified.
- Add nullable `served_orientation` to `match_event` and `match_decision`.
- Add RPC shells or signatures for capture/add/dismiss/finish if needed for generated types.
- Regenerate DB types.

Out of scope:

- Full RPC bodies beyond safe stubs.
- Server function mutation rewrites.
- UI changes.

## Likely touchpoints

- `supabase/migrations/**match_event**`
- `supabase/migrations/**match_review_item_visible_pair**`
- `src/lib/data/database.types.ts`

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` C11, C12, C13, C14, C15, D3, D4, D5, D7, D8.
- Use `model_rank`, `visible_rank`, and `fit_score` terminology.
- Direct/non-queue decisions may leave served context nullable.

## Acceptance criteria

- Visible-pair table exists and enforces unique visible ranks per queue item.
- Event and decision schemas expose `served_orientation`, `model_rank`, and `visible_rank`.
- Generated DB types include capture/mutation RPC signatures if shells are included.

## Notes on risks or ambiguity

- Column renames are broad; grep SQL and TS callers before merging or keep compatibility views only if explicitly justified.
