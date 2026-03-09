## Context

The current core library is spread across implementation-layer folders:

- `src/lib/capabilities/` for sync, analysis, matching, profiling, lyrics, and the enrichment pipeline
- `src/lib/data/` for all query modules
- `src/lib/jobs/` for job lifecycle
- `src/lib/ml/` for embeddings, LLM providers, and reranking
- `src/lib/integrations/` for external providers
- several root modules such as `src/lib/auth-client.ts`, `src/lib/auth.server.ts`, and `src/lib/auth.ts`

This layout worked while the system was primarily a Spotify sync + enrichment engine, but it no longer gives stable placement rules for future features like listener profiles, smart playlists, timeline generation, or multi-service imports. The same business capability is often split across multiple top-level folders, which makes moves noisy and future modules hard to place.

Relevant current files and folders:

- `src/lib/capabilities/sync/orchestrator.ts`
- `src/lib/capabilities/pipeline/orchestrator.ts`
- `src/lib/capabilities/analysis/pipeline.ts`
- `src/lib/capabilities/lyrics/service.ts`
- `src/lib/capabilities/matching/service.ts`
- `src/lib/capabilities/profiling/service.ts`
- `src/lib/data/*.ts`
- `src/lib/jobs/lifecycle.ts`
- `src/lib/ml/embedding/**/*`, `src/lib/ml/llm/**/*`, `src/lib/ml/provider/**/*`, `src/lib/ml/reranker/**/*`

Constraints:

- Keep behavior unchanged during the reorganization
- Preserve git history and blame as much as possible
- Favor `git mv` over copy/delete so rename detection remains strong
- Avoid mixing file moves with logic refactors in the same commit
- Keep the existing `@/` alias and no-barrel-export convention

## Goals / Non-Goals

**Goals:**
- Establish a canonical `src/lib` topology based on bounded contexts and architectural role
- Give each new feature family a stable home: `domains`, `workflows`, `integrations`, `platform`, `shared`
- Separate cross-domain orchestration (`workflows`) from domain logic (`domains`)
- Move query modules into the domains that own them instead of keeping a single `src/lib/data` bucket
- Execute the migration in a git-friendly way: moves first, import rewrites second, cleanup last

**Non-Goals:**
- Changing product behavior, algorithms, HTTP APIs, or database schema
- Redesigning route structure under `src/routes/` or React feature structure under `src/features/`
- Rewriting modules into new coding patterns beyond what the move requires
- Shipping future roadmap features such as listener profile, timeline, or smart playlists as part of this change
- Solving every root-level `src/lib/*` organizational issue in one pass if a module is outside the new topology's immediate scope

## Decisions

### 1. Adopt `domains/ + workflows/ + integrations/ + platform/ + shared/` as the canonical topology

**Decision:** Reorganize core library code under five stable top-level buckets:

- `src/lib/domains/` — business-owned logic and query modules
- `src/lib/workflows/` — cross-domain orchestration flows
- `src/lib/integrations/` — external providers and provider adapters
- `src/lib/platform/` — internal infrastructure such as auth, jobs, storage, cache, and scheduling
- `src/lib/shared/` — pure shared types, utils, and errors

**Rationale:** These buckets describe the long-lived role of a module better than the current split between `capabilities`, `data`, `jobs`, and `ml`. They also scale cleanly to future product areas without turning `services/` into a junk drawer.

**Alternative considered:** Proposal 3 (`orchestration/` + `services/`). Rejected because it explains technical role but not business ownership, and it becomes less useful as new product areas such as narrative or curation emerge.

### 2. Move current modules into bounded contexts that reflect ownership, not implementation history

**Decision:** Use bounded contexts inside `src/lib/domains/` for the code that expresses product meaning:

| Current location                                                         | Target location                                           |
| ------------------------------------------------------------------------ | --------------------------------------------------------- |
| `src/lib/data/song.ts`                                                   | `src/lib/domains/library/songs/queries.ts`                |
| `src/lib/data/liked-song.ts`                                             | `src/lib/domains/library/liked-songs/queries.ts`          |
| `src/lib/data/playlists.ts`                                              | `src/lib/domains/library/playlists/queries.ts`            |
| `src/lib/data/accounts.ts`                                               | `src/lib/domains/library/accounts/queries.ts`             |
| `src/lib/data/preferences.ts`                                            | `src/lib/domains/library/accounts/preferences-queries.ts` |
| `src/lib/data/newness.ts`                                                | `src/lib/domains/library/liked-songs/status-queries.ts`   |
| `src/lib/capabilities/lyrics/**/*`                                       | `src/lib/domains/enrichment/lyrics/**/*`                  |
| `src/lib/capabilities/analysis/**/*` and `src/lib/data/song-analysis.ts` | `src/lib/domains/enrichment/content-analysis/**/*`        |
| `src/lib/data/song-audio-feature.ts`                                     | `src/lib/domains/enrichment/audio-features/queries.ts`    |
| `src/lib/ml/embedding/**/*`                                              | `src/lib/domains/enrichment/embeddings/**/*`              |
| `src/lib/capabilities/genre/**/*`                                        | `src/lib/domains/enrichment/genre-tagging/**/*`           |
| `src/lib/capabilities/profiling/**/*`                                    | `src/lib/domains/taste/playlist-profiling/**/*`           |
| `src/lib/capabilities/matching/**/*` and `src/lib/data/matching.ts`      | `src/lib/domains/taste/song-matching/**/*`                |

`src/lib/domains/curation/*` and `src/lib/domains/narrative/*` are part of the target topology but do not require immediate implementation beyond reserving the boundary in the plan.

**Rationale:** New features like listener profile, smart playlists, and musical timeline naturally belong to bounded contexts. The topology should optimize for that future placement now.

**Alternative considered:** Keep a single `src/lib/data` folder and only move service classes. Rejected because it preserves the biggest ownership ambiguity in the current tree.

### 3. Make workflows the only home for cross-domain orchestration

**Decision:** Move orchestration entrypoints into `src/lib/workflows/`:

- `src/lib/capabilities/sync/*` → `src/lib/workflows/spotify-sync/*`
- `src/lib/capabilities/pipeline/*` → `src/lib/workflows/enrichment-pipeline/*`

Within domains, local orchestration that belongs to a single capability can remain near that capability, for example `src/lib/domains/enrichment/content-analysis/orchestrator.ts` replacing `src/lib/capabilities/analysis/pipeline.ts`.

**Rationale:** This separates broad application flows from leaf services without forcing every orchestrator into a generic top-level layer. `spotify-sync` and `enrichment-pipeline` are workflows; lyrics fetching and playlist profiling are domain logic.

**Alternative considered:** Leave `sync` and `pipeline` inside their respective domains. Rejected because both flows coordinate multiple domains and providers and are more understandable as workflows.

### 4. Consolidate provider adapters under `integrations/` and internal infrastructure under `platform/`

**Decision:** Keep provider-facing modules under `src/lib/integrations/` and internal app infrastructure under `src/lib/platform/`.

Planned moves:

- `src/lib/integrations/spotify/**/*` stays under `src/lib/integrations/spotify/**/*`
- `src/lib/integrations/lastfm/**/*` stays under `src/lib/integrations/lastfm/**/*`
- `src/lib/integrations/reccobeats/**/*` and `src/lib/integrations/audio/**/*` converge under the integrations boundary for audio providers
- `src/lib/integrations/deepinfra/**/*`, `src/lib/integrations/huggingface/**/*`, and selected `src/lib/ml/{llm,provider,reranker}` modules are reorganized under `src/lib/integrations/llm/**/*`
- `src/lib/jobs/**/*` moves to `src/lib/platform/jobs/**/*`
- `src/lib/auth-client.ts`, `src/lib/auth.server.ts`, `src/lib/auth-schema.ts`, and `src/lib/auth.ts` move under `src/lib/platform/auth/**/*`
- Supabase/storage helpers are organized under `src/lib/platform/storage/**/*`

**Rationale:** The old `ml/` bucket mixes provider adapters with domain composition logic. Provider integrations are a dependency concern, not a business domain.

**Alternative considered:** Keep `src/lib/ml` as a permanent top-level bucket. Rejected because it obscures whether a module is provider-specific infrastructure or domain logic.

### 5. Use a move-first migration strategy designed for git rename preservation

**Decision:** Implement the reorganization in ordered phases:

1. Create target folders
2. Move files with `git mv` and minimal or no content edits
3. Perform mechanical import rewrites after moves settle
4. Remove vacated folders only after the tree compiles

During move commits, avoid mixing semantic logic changes with path changes.

**Rationale:** Git tracks renames best when file content remains mostly stable. Combining path changes with refactors makes review, blame, and rollback materially worse.

**Alternative considered:** Big-bang copy/paste into a new tree followed by cleanup. Rejected because it destroys history attribution and creates a noisy diff that hides architectural intent.

### 6. Accept a temporary mixed topology during migration rather than compatibility wrappers everywhere

**Decision:** The implementation may temporarily keep both old and new folder families in the same branch while imports are rewritten, but it should avoid introducing widespread compatibility wrappers or barrel files.

**Rationale:** Wrapper files reduce immediate import churn, but they prolong the old topology, violate the no-barrel preference, and create a second cleanup phase with little product value.

**Alternative considered:** Leave re-export shims in `src/lib/capabilities` and `src/lib/data` for one release. Rejected unless an individual move proves too disruptive to land atomically.

### 7. Keep future bounded contexts conceptual until they own real code

**Decision:** `src/lib/domains/curation/*` and `src/lib/domains/narrative/*` are part of the target topology, but this change will not create placeholder files or empty scaffolding for them unless a moved module actually lands there.

**Rationale:** The topology should define placement rules without creating noisy empty directories that add no implementation value and complicate the move commit.

**Alternative considered:** Materialize the full future tree up front. Rejected because empty folders are not meaningful in git and create misleading implementation scope.

### 8. Keep reranking under provider/integration infrastructure in this reorganization

**Decision:** Modules currently under `src/lib/ml/reranker/*` move with the provider-facing stack under `src/lib/integrations/llm/*` in this change, rather than being absorbed into `src/lib/domains/taste/song-matching/*`.

**Rationale:** This change is primarily about stable topology and low-noise moves. Reranking is currently closer to provider-backed model infrastructure than to taste-domain orchestration, so moving it under `integrations/llm/*` minimizes semantic refactoring during the reorganization.

**Alternative considered:** Move reranking directly into `src/lib/domains/taste/song-matching/*`. Rejected for now because it combines a folder move with a domain-ownership reinterpretation that can be revisited later if the matching domain starts owning reranking policy directly.

### 9. Leave `server`, `hooks`, `theme`, and `utils` for follow-up changes

**Decision:** `src/lib/server/*`, `src/lib/hooks/*`, `src/lib/theme/*`, and `src/lib/utils/*` remain outside this reorganization unless a direct import rewrite is required by moved dependencies.

**Rationale:** Pulling these areas into the same migration would increase churn without materially improving the core library topology that this change is standardizing.

**Alternative considered:** Fold every root-level helper into `platform/` or `shared/` in one pass. Rejected because it expands the diff surface and weakens rename preservation.

## Risks / Trade-offs

- **[Large import churn]** → Use `git mv` first, then mechanical search/replace by bounded context, and keep commits scoped by area
- **[Rename detection can still fail]** → Avoid content edits during move commits and verify with `git diff --summary --find-renames`
- **[Temporary broken imports during the branch]** → Migrate in dependency order: platform/integrations first, then domains, then workflows, then route/server consumers
- **[Architecture overspecification for future empty domains]** → Treat `curation` and `narrative` as boundary reservations in the design; only materialize tracked files when a real module lands
- **[Review fatigue]** → Keep the change behavior-preserving and document old→new path mapping in the PR/change description

## Migration Plan

1. Create the target folder skeleton under `src/lib/domains`, `src/lib/workflows`, `src/lib/integrations`, and `src/lib/platform`
2. Move infrastructure modules first (`jobs`, auth, storage clients) with `git mv`
3. Move domain query modules out of `src/lib/data` into their owning bounded contexts
4. Move capability folders into `domains/*` and workflow folders into `workflows/*`
5. Consolidate provider adapters from `src/lib/ml` and `src/lib/integrations/*` into their final `integrations/*` and domain homes
6. Rewrite imports across `src/lib`, `src/routes`, `src/features`, `scripts`, and tests
7. Remove emptied legacy folders (`src/lib/capabilities`, `src/lib/data`, `src/lib/jobs`, `src/lib/ml`) only after typecheck passes
8. Review rename preservation with git diff tools before merging

**Rollback:** If the migration becomes too noisy or breaks import resolution late in the branch, revert the latest move batch as a unit and re-land it in smaller bounded-context slices.

## Open Questions

1. Should `src/lib/integrations/audio/*` be merged into `src/lib/integrations/reccobeats/*` during this reorganization, or deferred to a later provider-cleanup change?
2. Should the implementation maintain current filenames where possible (`service.ts`, `orchestrator.ts`, `queries.ts`) even when moving into deeper bounded-context folders, or normalize names further in a separate cleanup pass?
