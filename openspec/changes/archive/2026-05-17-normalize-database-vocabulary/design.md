## Context

Current final-schema names from migrations/generated types include:

| Current DB name | Current meaning | Problem |
| --- | --- | --- |
| `job_failure` | per-item failures recorded during job execution | Sounds like terminal job-row failure, but the row is scoped to `job_id + item_type + item_id + stage` |
| `resolve_stage_failures` | marks unresolved non-terminal per-item stage failures as resolved | Name omits job/item scope |
| `count_unresolved_failures` | counts unresolved per-item failures for failure policy escalation | Name omits job/item scope |
| `item_status` | account-scoped new/view state for songs/playlists | No longer broad status; action columns were removed and decisions moved to `match_decision` |
| `api_token` | extension bearer auth token hashes | Name suggests general API tokens, but all current usage is extension auth |

The repo is pre-production, so generated types and code can still be aligned before these names become operationally expensive to change.

## Goals / Non-Goals

**Goals:**

- Align table/RPC names with current domain language.
- Keep behavior and data shape unchanged except for names.
- Update database functions, TypeScript generated types, app code, tests, and specs together.
- Avoid old-name compatibility views/functions unless a concrete migration constraint requires a short-lived transition.

**Non-Goals:**

- Rename tables whose names are already clear: `job`, `job_execution_measurement`, `match_snapshot`, `match_result`, `match_decision`, `library_processing_state`, billing tables, core song/playlist tables.
- Change queue behavior, matching/newness behavior, extension auth semantics, or failure policy.
- Rebuild historical migrations as part of this change.
- Introduce new enum values or schema columns.

## Decisions

### 1. Rename `job_failure` to `job_item_failure`

**Decision:** The final table name SHALL be `job_item_failure`.

**Rationale:** Rows are not job-level failures; they are item-level accounting records under a job attempt. The new name matches the TypeScript module direction (`item-failures`) and makes selectors/failure policy easier to reason about.

**Dependent names to update where present:**

- indexes: `idx_job_item_failure_*`;
- FK/constraint names: `job_item_failure_*`;
- generated Supabase table type: `Tables<"job_item_failure">`;
- comments/docs/specs that describe durable stage accounting.

### 2. Rename job item failure RPCs to include job/item scope

**Decision:** Replace:

- `resolve_stage_failures(...)` with `resolve_job_item_stage_failures(...)`;
- `count_unresolved_failures(...)` with `count_unresolved_job_item_failures(...)`.

Drop the old RPC names in the same migration after app code is updated, unless migration ordering requires both names temporarily during deployment.

**Rationale:** These RPCs operate on unresolved `job_item_failure` rows for a specific account/item/stage. The old names were too broad.

### 3. Rename `item_status` to `account_item_newness`

**Decision:** The final table name SHALL be `account_item_newness`.

**Rationale:** The table is account-scoped and currently stores `is_new` plus `viewed_at`. It no longer stores action status. Matching decisions live in `match_decision`, and processing currency should not be inferred from this table beyond existing newness/status derivation rules.

**Dependent names to update where present:**

- indexes: `idx_account_item_newness_*`;
- trigger: `account_item_newness_updated_at`;
- generated Supabase table type: `Tables<"account_item_newness">`;
- SQL functions such as `get_liked_songs_page`, `get_liked_songs_stats`, and selectors that join the table.

### 4. Rename `api_token` to `extension_api_token`

**Decision:** The final table name SHALL be `extension_api_token`.

**Rationale:** Current token generation/validation/revocation paths are exclusively for the Chrome extension bearer token handoff. If a general public API token product exists later, it should get a separate table and capability.

**Dependent names to update where present:**

- indexes: `idx_extension_api_token_*`;
- generated Supabase table type: `Tables<"extension_api_token">`;
- extension auth query module and route tests.

### 5. Use a forward migration, not historical migration rewrites

**Decision:** Implement the rename through a new forward Supabase migration using `ALTER TABLE ... RENAME`, `ALTER FUNCTION ... RENAME` or `DROP/CREATE` for RPC signatures, and `CREATE OR REPLACE FUNCTION` for functions whose bodies reference renamed relations.

**Rationale:** Even pre-prod, a forward migration is safer for linked local/remote environments and preserves migration history. A later migration squash/reset can happen separately if desired.

### 6. No compatibility layer by default

**Decision:** Do not leave old table views or old RPC wrappers in the final branch.

**Rationale:** The point is to remove misleading vocabulary before production. Compatibility aliases would keep generated types and future code exposed to old names.

Exception: a temporary compatibility object may exist inside the migration transaction only if required to update dependent functions safely, but it must not remain after migration completion.

## Migration Plan

1. Add a Supabase migration that renames:
   - `api_token` -> `extension_api_token`;
   - `item_status` -> `account_item_newness`;
   - `job_failure` -> `job_item_failure`.
2. Rename dependent indexes, constraints, and triggers where practical.
3. Rename or recreate RPCs:
   - `resolve_job_item_stage_failures`;
   - `count_unresolved_job_item_failures`.
4. Recreate SQL functions that reference old table/RPC names, including liked-songs stats/page functions, enrichment selectors, and any matching/newness helpers.
5. Update TypeScript DB access modules and tests to use new table/RPC names.
6. Run Supabase type generation to update `src/lib/data/database.types.ts`.
7. Update OpenSpec/docs references.
8. Verify no old names remain in production code or final generated types except in historical migrations and this change's migration comments.

## Risks / Trade-offs

- **[SQL function drift]** Several RPCs embed table names. Mitigation: grep all migrations and generated functions for old names; recreate every final function body that references renamed tables.
- **[Generated type churn]** Renamed tables will cause many TS type updates. Mitigation: regenerate types once after migration, then update compile errors mechanically.
- **[Remote pre-prod data]** Renames preserve data, unlike drop/create. Mitigation: use `ALTER TABLE RENAME` and avoid destructive recreation.
- **[Spec churn]** Older specs contain stale names. Mitigation: update active specs that define current behavior; leave references only where intentionally historical.

## Verification Strategy

- Apply migration locally with Supabase migration tooling.
- Regenerate types with the project script: `bun run gen:types`.
- Grep production code and generated types:
  - `rg "job_failure|item_status|api_token|resolve_stage_failures|count_unresolved_failures" src openspec/specs docs`
  - Allowed matches should be documented historical notes only, not active code/spec requirements.
- Run affected focused tests:
  - `bun run test src/lib/workflows/enrichment-pipeline src/lib/workflows/library-processing src/lib/domains/library/liked-songs src/lib/server src/routes/api/extension`
- Run `bun run typecheck`.
- Run `openspec validate normalize-database-vocabulary --strict --no-interactive`.

## Open Questions

- Should `account_item_newness` also rename columns later, e.g. `viewed_at` -> `seen_at`? Recommendation: no for this change; table name fixes the main ambiguity and column semantics are acceptable.
