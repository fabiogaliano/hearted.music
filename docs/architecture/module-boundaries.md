# Module Boundaries

Ownership rules for top-level source modules under `src/lib/`.

## Modules

| Module | Purpose | Ownership Rule |
| --- | --- | --- |
| `src/lib/data` | Database infrastructure only | Supabase client setup (`client.ts`), generated DB types (`database.types.ts`), future low-level DB adapter setup. **No feature/platform/content modules.** |
| `src/lib/domains` | Domain-specific logic and persistence | Bounded contexts own their queries, types, and services. Persistence modules live with the domain that owns the concept. |
| `src/lib/platform` | Cross-cutting platform capabilities | Auth, jobs, billing infrastructure. Platform persistence lives here when no single domain owns the concept. |
| `src/lib/workflows` | Multi-step orchestration | Coordinates domain/platform modules. Owns orchestration logic, not table access directly (delegates to domain/platform queries). |
| `src/lib/integrations` | External service adapters | Spotify, AI providers, etc. Thin wrappers around third-party APIs. |
| `src/lib/shared` | Shared utilities and types | Error types, result wrappers, generic helpers. No business logic. |
| `src/lib/content` | Static app content | JSON-backed helpers, legal documents, landing-page content, demo data. Not DB-backed, not domain persistence. |

## Rules

1. **`src/lib/data` is infrastructure-only.** A module that exports business/platform operations, query functions, or static app content must not live under `src/lib/data` even if it uses Supabase internally.

2. **Persistence lives with the owning concept.** Domain queries go under `src/lib/domains/<domain>/`. Platform persistence goes under `src/lib/platform/<capability>/`. Never place feature queries in `src/lib/data`.

3. **Static content lives under `src/lib/content/`.** Modules backed by JSON files, hardcoded data, or build-time-bundled content belong here, not in `data` or `domains`.

4. **No barrel exports.** Each module is imported by its direct path. No `index.ts` re-exports.
