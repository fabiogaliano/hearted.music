# Crisp metadata hard filters — story dependency map

Date: 2026-06-21
Status: Implementation dependency and parallelization map

## Sources read

Source-of-truth docs:

- `crisp-metadata-hard-filters-plan.md`
- `crisp-metadata-hard-filters-decisions.md`
- `crisp-metadata-hard-filters-terminology.md`
- `implementation-phases.md`
- `stories/README.md`
- `stories/CMHF-01-shared-domain-contract.md` through `stories/CMHF-19-future-create-playlist-consumer.md`

## Legend

- **Hard edge**: explicit `Depends on` relation or semantic dependency from the plan.
- **Merge-risk edge**: not a semantic dependency, but the stories touch the same hot files and should be serialized or merged through one owner/branch unless the implementation is deliberately split into non-overlapping files.

## 1. Story dependency graph

### Hard dependency DAG

```text
CMHF-01 Shared domain contract
├─ CMHF-02 Persistence migration and DB types
│  ├─ CMHF-07 Combined save RPC
│  ├─ CMHF-08 Filter options RPC
│  ├─ CMHF-09 Playlist read parsing
│  ├─ CMHF-10 Filter metadata loader
│  │  └─ CMHF-11 Exclusion helper
│  │     └─ CMHF-12 Effective exclusion orchestration
│  └─ CMHF-18 Vocals backfill script
│     also depends on CMHF-07 and CMHF-16
├─ CMHF-03 Advanced filters shell/chips prototype
│  ├─ CMHF-04 Language and vocals prototype controls
│  ├─ CMHF-05 Year/date prototype controls
│  └─ CMHF-06 Ladle composition and review states
│     also depends on CMHF-04 and CMHF-05
├─ CMHF-07 Combined save RPC
│  ├─ CMHF-15 Combined save/error/cancel integration
│  └─ CMHF-18 Vocals backfill script
├─ CMHF-08 Filter options RPC
│  └─ CMHF-14 Production options loading/error wiring
├─ CMHF-09 Playlist read parsing
│  └─ CMHF-13 Thread filters through production editor
├─ CMHF-16 Vocals detector core
│  ├─ CMHF-17 Vocals detector editor auto-fill
│  └─ CMHF-18 Vocals backfill script
└─ CMHF-19 Future create-playlist consumer reuse
   also depends on future create-playlist feature design

CMHF-06 + CMHF-09
└─ CMHF-13 Thread filters through production editor
   ├─ CMHF-14 Production options loading/error wiring
   │  also depends on CMHF-08
   └─ CMHF-15 Combined save/error/cancel integration
      also depends on CMHF-07 and CMHF-14
      └─ CMHF-17 Vocals detector editor auto-fill
         also depends on CMHF-16
```

### Additional merge-risk ordering from file overlap

These are not product dependencies, but they reduce conflict risk:

```text
UI prototype hot path:
CMHF-03 -> CMHF-04 -> CMHF-05 -> CMHF-06
```

`CMHF-04` and `CMHF-05` can only run safely in parallel if `CMHF-03` leaves stable component slots and they avoid editing the same story/CSS blocks.

```text
Server/read hot path:
CMHF-09 -> CMHF-08 -> CMHF-07
```

`CMHF-07`, `CMHF-08`, and `CMHF-09` all likely touch `src/lib/server/playlists.functions.ts` and playlist query/read helpers. They can be separate PRs, but should merge frequently and avoid parallel edits to the same exports/import sections.

```text
Production editor hot path:
CMHF-13 -> CMHF-14 -> CMHF-15 -> CMHF-17
```

This path is both explicit dependency and file-overlap dependency because all four stories touch the playlist editor state boundary.

```text
Matching hot path:
CMHF-10 -> CMHF-11 -> CMHF-12
```

This is explicit and should stay serial because each story consumes the previous story's helper shape.

## 2. Critical path — longest serial chain

The longest serial chain for the user-facing release is:

```text
CMHF-01
-> CMHF-03
-> CMHF-04 or CMHF-05
-> CMHF-06
-> CMHF-13
-> CMHF-14
-> CMHF-15
-> CMHF-17
```

If `CMHF-04` and `CMHF-05` are split into separate branches that both edit `WritingSurface`, stories, and shared CSS, treat them as serial for merge safety:

```text
CMHF-01
-> CMHF-03
-> CMHF-04
-> CMHF-05
-> CMHF-06
-> CMHF-13
-> CMHF-14
-> CMHF-15
-> CMHF-17
```

Important join points on that path:

- `CMHF-13` also requires `CMHF-09`.
- `CMHF-14` also requires `CMHF-08`.
- `CMHF-15` also requires `CMHF-07`.
- `CMHF-17` also requires `CMHF-16`.

Matching enforcement has its own serial chain:

```text
CMHF-01 -> CMHF-02 -> CMHF-10 -> CMHF-11 -> CMHF-12
```

It can merge before production UI and remain effectively inert until saved filters exist.

## 3. Shared-contract stories that must land first

### Global shared-contract gate

1. **CMHF-01 — Shared match-filters domain contract**
   - Owns `PlaylistMatchFiltersV1`, parsers, normalizers, display helpers, predicates, language catalog, option DTOs, and diagnostic types.
   - All lanes use this contract.

2. **CMHF-02 — Persistence migration and generated DB types**
   - Adds `playlist.match_filters`, updates `song.vocal_gender` documentation, and regenerates DB types.
   - Server, production UI persistence, matching metadata, and backfill should rebase after this lands.

### Lane-specific contract gates

- **CMHF-06** before production UI wiring: Ladle-reviewed UI behavior is the source of truth for `CMHF-13+`.
- **CMHF-07** before save integration/backfill writes: combined save and write/invalidation behavior must be stable.
- **CMHF-08** before production options states: options DTO and query key must be stable.
- **CMHF-09** before production editor threading: UI should receive normalized `matchFilters`, not raw JSON.
- **CMHF-10** before exclusion evaluation: matching helper should consume one compact metadata shape.
- **CMHF-16** before editor auto-fill/backfill: detector result type and phrase semantics must be stable.

## 4. Hot files / merge-risk zones

| Hot file or zone | Stories | Risk |
|---|---|---|
| `src/lib/domains/taste/match-filters/*` | CMHF-01, CMHF-04, CMHF-05, CMHF-11, CMHF-16, CMHF-17, CMHF-18, CMHF-19 | Shared schema/helpers can drift; detector/backfill must not fork parser or predicate semantics. |
| `supabase/migrations/*` | CMHF-02 | Migration ordering and generated type fallout; land before persistence callers. |
| `src/lib/data/database.types.ts` | CMHF-02 and downstream fixture fallout | Generated file can cause broad conflicts if branches start before regeneration. |
| `src/lib/server/playlists.functions.ts` | CMHF-07, CMHF-08, CMHF-09, CMHF-15 | Multiple server functions/read paths/imports in one file. Highest server merge risk. |
| `src/lib/domains/library/playlists/queries.ts` | CMHF-02, CMHF-07, CMHF-09, CMHF-18 | Playlist row shape, combined write helper, read parsing, and backfill scan/update helpers overlap. |
| `src/features/playlists/queries.ts` | CMHF-08, CMHF-14, CMHF-15 | Options query helper and save mutation/query invalidation overlap. |
| `src/features/playlists/PlaylistsCoverFlowScreen.tsx` | CMHF-09, CMHF-13, CMHF-14, CMHF-15 | View-model mapping, option fetching, save plumbing, and invalidation all meet here. |
| `src/features/playlists/components/explorations/types.ts` | CMHF-09, CMHF-13, CMHF-15 | `PlaylistSummary`/editor prop shape changes. |
| `src/features/playlists/components/explorations/SpotlightPanel.tsx` | CMHF-13, CMHF-14, CMHF-15, CMHF-17 | Draft ownership, async save, options state, and detector behavior all overlap. |
| `src/features/playlists/components/explorations/WritingSurface.tsx` | CMHF-03, CMHF-04, CMHF-05, CMHF-13, CMHF-14, CMHF-15, CMHF-17 | Highest UI merge risk; shell, controls, production props, loading/error, save errors, and detector chip state overlap. |
| `src/features/playlists/components/explorations/WritingSurface.stories.tsx` | CMHF-03, CMHF-04, CMHF-05, CMHF-06, CMHF-13, CMHF-14, CMHF-15, CMHF-17 | Story scenarios will churn heavily; merge one UI lane frequently. |
| `src/features/playlists/components/explorations/SpotlightPanel.stories.tsx` | CMHF-06, CMHF-13, CMHF-14, CMHF-15, CMHF-17 | Composed story states overlap with production prop changes. |
| `src/features/playlists/components/explorations/playlist-explorations.css` | CMHF-03, CMHF-04, CMHF-05, CMHF-06 | Shared visual classes and layout changes can conflict. |
| `src/lib/domains/library/songs/queries.ts` | CMHF-08, CMHF-10 | Options aggregation and filter metadata loading may both want compact metadata helpers. |
| `src/lib/domains/library/liked-songs/queries.ts` | CMHF-08, CMHF-10 | Account-scoped active liked-song data for options and matching metadata overlaps. |
| `src/lib/workflows/match-snapshot-refresh/orchestrator.ts` | CMHF-10, CMHF-12 | Optional loader wiring and final effective exclusion plumbing can conflict. |
| `src/lib/workflows/match-snapshot-refresh/write-match-snapshot.ts` | CMHF-12 | Must receive same effective exclusion set as `matchBatch`. |
| `src/lib/domains/taste/song-matching/cache.ts` | CMHF-12 | Snapshot hash tests may touch cache metadata behavior. |
| `src/lib/workflows/library-processing/service.ts` and `changes/playlist-management.ts` | CMHF-07, CMHF-18 | Save invalidation and backfill invalidation must share the existing metadata-changed path. |
| `scripts/backfill-playlist-match-filter-vocals.ts` | CMHF-18 | New script, low merge risk except for shared query/invalidation helpers. |

## 5. Parallelizable story groups

### After CMHF-01 and CMHF-02 land

These lanes can run in separate branches with low semantic coupling:

```text
Lane A — UI prototype/review:
CMHF-03 -> CMHF-04/CMHF-05 -> CMHF-06

Lane B — server/read contracts:
CMHF-09, CMHF-08, CMHF-07

Lane C — matching enforcement:
CMHF-10 -> CMHF-11 -> CMHF-12

Lane D — detector core:
CMHF-16
```

Safe parallel combinations:

- `CMHF-03` or the UI prototype lane can run alongside `CMHF-07/08/09`, `CMHF-10`, and `CMHF-16` after the shared contract is stable.
- `CMHF-10 -> CMHF-12` can run alongside the UI and server lanes, except coordinate with `CMHF-08` if both add helpers in `songs/queries.ts` or `liked-songs/queries.ts`.
- `CMHF-16` can run alongside UI/server/matching after `CMHF-01`; it should avoid changing core parser/predicate files already stabilized by CMHF-01.
- `CMHF-18` can run alongside `CMHF-17` once its dependencies (`CMHF-02`, `CMHF-07`, `CMHF-16`) are landed, but the script should merge late and not be run until production save/update behavior is stable.

Conditional parallel combinations:

- `CMHF-04` and `CMHF-05` can run in parallel only if each owns new control files and avoids concurrent edits to shared story/CSS blocks. Otherwise put them in one UI branch or serialize.
- `CMHF-07`, `CMHF-08`, and `CMHF-09` can run as separate PRs only with tight coordination around `playlists.functions.ts` and playlist query helpers. They are safer as short sequential PRs.

## 6. Stories that must NOT run in parallel

| Stories | Reason |
|---|---|
| CMHF-01 with any downstream story that defines filter shape | Domain contract is the source of truth; downstream branches must not invent schema/helpers. |
| CMHF-02 with CMHF-07/08/09/10/18 | Downstream stories depend on the DB column and generated `playlist.match_filters` types. |
| CMHF-03 with CMHF-04/05/06 | The shell/props/chip behavior must exist before control stories compose into it. |
| CMHF-06 with incomplete CMHF-04 or CMHF-05 | Review story must represent the full UI, not a partial composition. |
| CMHF-13 with CMHF-14/15/17 | All touch `SpotlightPanel`/`WritingSurface` editor state; later stories depend on production filter threading. |
| CMHF-14 with CMHF-15 | Save behavior depends on final option loading/error semantics, especially preserving removable chips while controls are disabled. |
| CMHF-15 with CMHF-17 | Detector auto-fill depends on the final async save/cancel draft boundary. |
| CMHF-10 with CMHF-11/12 | Metadata loader shape feeds exclusion helper; exclusion helper feeds orchestration. Keep serial. |
| CMHF-11 with CMHF-12 | Orchestration must consume a stable summary/exclusion helper contract. |
| CMHF-16 with CMHF-17/18 | Auto-fill and backfill must consume one stable detector result type and phrase behavior. |
| CMHF-18 with CMHF-07 or CMHF-16 | Backfill writes need stable combined write/invalidation helpers and detector semantics. |
| CMHF-19 with current release stories | It is deferred and also depends on future create-playlist design; do not let it create a second schema now. |

## 7. Recommended implementation waves

### Wave 1 — Shared foundation, no fan-out yet

```text
CMHF-01 -> CMHF-02
```

Merge strategy:

- Land `CMHF-01` first and make downstream branches import its concrete files directly; no barrel exports.
- Land `CMHF-02` immediately after and require all persistence/server/matching/UI branches to rebase on regenerated DB types.
- Do not let UI/server/matching branches define temporary filter types that diverge from `PlaylistMatchFiltersV1`.

### Wave 2 — Parallel lane build-out after the foundation

```text
UI prototype lane:       CMHF-03 -> CMHF-04 + CMHF-05 -> CMHF-06
Server/read lane:        CMHF-09, CMHF-08, CMHF-07
Matching lane:           CMHF-10 -> CMHF-11 -> CMHF-12
Detector core lane:      CMHF-16
```

Merge strategy:

- UI lane should preferably merge as one branch or as a tight stack because `WritingSurface`, stories, and CSS are hot.
- If `CMHF-04` and `CMHF-05` split, one branch should own common story scaffolding and the other should add only isolated control files.
- Server lane should use short PRs and frequent rebases. Prefer landing `CMHF-09` before `CMHF-13`, `CMHF-08` before `CMHF-14`, and `CMHF-07` before `CMHF-15`.
- Matching lane can merge before production UI; it is safe because tests can seed stored filters and users cannot save filters yet.
- Detector core can merge early if it has no editor side effects.

### Wave 3 — Production editor integration

```text
CMHF-06 + CMHF-09 -> CMHF-13
CMHF-13 + CMHF-08 -> CMHF-14
CMHF-14 + CMHF-07 -> CMHF-15
```

Merge strategy:

- Treat `CMHF-13`, `CMHF-14`, and `CMHF-15` as a serial stack touching the same editor state owner.
- Do not start `CMHF-13` until Ladle review is approved in `CMHF-06`.
- Merge `CMHF-13` before adding production options and save behavior so draft state changes are reviewable.
- Merge `CMHF-14` before `CMHF-15` so save behavior respects final loading/error rules.

### Wave 4 — Vocals integration and release maintenance

```text
CMHF-15 + CMHF-16 -> CMHF-17
CMHF-02 + CMHF-07 + CMHF-16 -> CMHF-18
```

Merge strategy:

- `CMHF-17` and `CMHF-18` can run in parallel after dependencies because one is UI and one is a script.
- Merge `CMHF-17` after production save/cancel behavior is stable to avoid reworking dismissal semantics.
- Merge `CMHF-18` late and keep dry-run as the default/safest mode. Do not run it in production as part of the code merge.

### Wave 5 — Deferred future consumer

```text
Future create-playlist design + CMHF-01 -> CMHF-19
```

Merge strategy:

- Keep this out of the current release.
- When scheduled, reuse `PlaylistMatchFiltersV1` or an intentional versioned successor and shared predicates.
- Do not add a second filter schema or second predicate interpretation.
