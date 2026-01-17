## Context

We are aligning migrations, docs, and data modules with the agreed v2 schema decisions. The project uses a service-role data layer and custom auth, so RLS should remain deny-all for anon/authenticated clients. We will reset the database after rewriting migrations.

## Goals / Non-Goals

- **Goals**
  - Make migrations match the intended schema (including metadata + soft delete)
  - Keep RLS deny-all with service-role-only access
  - Ensure docs and generated types stay in sync
- **Non-Goals**
  - Implementing Phase 4 services
  - Changing matching algorithms or DeepInfra model choices

## Decisions

- **RLS**: deny-all policies for anon/authenticated; service_role bypass only
- **Artists**: `song.artists` stored as `TEXT[]`
- **Song metadata**: add `isrc`, rename `image_url`, keep `popularity` + `preview_url`
- **Onboarding**: `user_preferences.onboarding_step` as string steps
- **Migrations**: rewrite existing migration files and reset DB

## Risks / Trade-offs

- Rewriting migrations requires a clean reset of local DB
- Data modules must be updated to avoid type mismatches after regeneration

## Migration Plan

1. Rewrite migrations to match the confirmed schema
2. Update docs + specs for alignment
3. Regenerate database types
4. Update data modules for renamed/added columns

## Open Questions

- None (decisions confirmed)
