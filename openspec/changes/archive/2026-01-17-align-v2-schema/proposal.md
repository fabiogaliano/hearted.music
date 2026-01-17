# Change: Align v2 Schema to Decisions

## Why

Current migrations diverge from the intended v2 schema (song metadata, analysis/embedding metadata, onboarding steps, and RLS strategy). We want the schema, docs, and types to match confirmed decisions before building Phase 4 services.

## What Changes

- Rewrite v2 migrations to match the confirmed schema (song metadata, playlist counts, liked-song soft delete, job types)
- Update analysis/embedding/matching tables to reflect content-hash strategy and metadata fields
- Switch onboarding_step to string steps and keep preferences in `user_preferences`
- Keep deny-all RLS policies (service-role only) and update docs/specs accordingly
- Update migration docs and regenerate database types

## Impact

- **Affected specs**: `migration-v2`
- **Affected code**: `supabase/migrations/**`, `src/lib/data/**`, `docs/migration_v2/**`
