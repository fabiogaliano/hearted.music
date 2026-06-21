# Crisp metadata hard filters — implementation story index

Source docs:

- `crisp-metadata-hard-filters-plan.md`
- `crisp-metadata-hard-filters-decisions.md`
- `crisp-metadata-hard-filters-terminology.md`
- `implementation-phases.md`

Granularity: small PRs per change set. Each story is intended to be independently reviewable, with explicit dependencies.

## Dependency graph

```text
CMHF-01 Shared domain contract
├─ CMHF-02 Persistence migration and DB types
│  ├─ CMHF-07 Combined save RPC
│  ├─ CMHF-08 Filter options RPC
│  ├─ CMHF-09 Playlist read parsing
│  └─ CMHF-10 Filter metadata loader
│     └─ CMHF-11 Exclusion helper
│        └─ CMHF-12 Effective exclusion orchestration
├─ CMHF-03 Advanced filters shell/chips prototype
│  ├─ CMHF-04 Language and vocals prototype controls
│  ├─ CMHF-05 Year/date prototype controls
│  └─ CMHF-06 Ladle composition and review states
└─ CMHF-16 Vocals detector core

CMHF-02 + CMHF-07 + CMHF-08 + CMHF-09 + CMHF-06
└─ CMHF-13 Thread filters through production editor
   ├─ CMHF-14 Production options loading/error wiring
   └─ CMHF-15 Combined save/error/cancel integration
      └─ CMHF-17 Vocals detector editor auto-fill

CMHF-02 + CMHF-07 + CMHF-16
└─ CMHF-18 Vocals backfill script

CMHF-01 + completed future create-playlist design
└─ CMHF-19 Future create-playlist consumer (deferred)
```

## Stories

| ID | Title | Phase | Depends on | Blocks |
|---|---|---:|---|---|
| [CMHF-01](./CMHF-01-shared-domain-contract.md) | Shared match-filters domain contract | 1 | Source docs | All later stories |
| [CMHF-02](./CMHF-02-persistence-migration-db-types.md) | Persistence migration and generated DB types | 1 | CMHF-01 | Server, production UI, matching/backfill writes |
| [CMHF-03](./CMHF-03-advanced-filters-shell-chips-prototype.md) | Advanced filters shell and active chips prototype | 2 | CMHF-01 | CMHF-04, CMHF-05, CMHF-06 |
| [CMHF-04](./CMHF-04-language-vocals-prototype-controls.md) | Language and vocals prototype controls | 2 | CMHF-03 | CMHF-06, CMHF-13 |
| [CMHF-05](./CMHF-05-year-date-prototype-controls.md) | Release-year and liked-date prototype controls | 2 | CMHF-03 | CMHF-06, CMHF-13 |
| [CMHF-06](./CMHF-06-ladle-composition-review-states.md) | Ladle composition and review states | 2 | CMHF-03, CMHF-04, CMHF-05 | CMHF-13 |
| [CMHF-07](./CMHF-07-combined-save-rpc.md) | Combined save RPC | 3 | CMHF-01, CMHF-02 | CMHF-15, CMHF-18 |
| [CMHF-08](./CMHF-08-filter-options-rpc.md) | Filter options RPC | 3 | CMHF-01, CMHF-02 | CMHF-14 |
| [CMHF-09](./CMHF-09-playlist-read-parsing.md) | Playlist read parsing and invalid stored-filter handling | 3 | CMHF-01, CMHF-02 | CMHF-13 |
| [CMHF-10](./CMHF-10-filter-metadata-loader.md) | Filter metadata loader for match refresh | 4 | CMHF-01, CMHF-02 | CMHF-11 |
| [CMHF-11](./CMHF-11-exclusion-helper.md) | Match-filter exclusion helper | 4 | CMHF-01, CMHF-10 | CMHF-12 |
| [CMHF-12](./CMHF-12-effective-exclusion-orchestration.md) | Effective exclusion set orchestration | 4 | CMHF-11 | End-to-end matching enforcement |
| [CMHF-13](./CMHF-13-thread-filters-production-editor.md) | Thread filters through production editor | 5 | CMHF-06, CMHF-09 | CMHF-14, CMHF-15, CMHF-17 |
| [CMHF-14](./CMHF-14-production-options-loading-error.md) | Production options loading/error wiring | 5 | CMHF-08, CMHF-13 | CMHF-15 |
| [CMHF-15](./CMHF-15-combined-save-error-cancel.md) | Combined save, error, and cancel integration | 5 | CMHF-07, CMHF-13, CMHF-14 | Production editor complete |
| [CMHF-16](./CMHF-16-vocals-detector-core.md) | Vocals detector core | 6 | CMHF-01 | CMHF-17, CMHF-18 |
| [CMHF-17](./CMHF-17-vocals-editor-autofill.md) | Vocals detector editor auto-fill | 6 | CMHF-15, CMHF-16 | Auto-fill UX complete |
| [CMHF-18](./CMHF-18-vocals-backfill-script.md) | Vocals backfill script | 6 | CMHF-02, CMHF-07, CMHF-16 | Release maintenance task |
| [CMHF-19](./CMHF-19-future-create-playlist-consumer.md) | Future create-playlist consumer reuse | 7 | Future feature design, CMHF-01 | Deferred |

## Shared-contract gate

Do not split production UI, server, matching, or detector/backfill work across branches until CMHF-01 and CMHF-02 have landed. After that, CMHF-03 through CMHF-12 and CMHF-16 can proceed in parallel according to the graph above.

## Completion checks by lane

- UI-bearing stories: include Ladle stories and run `bun run ladle:build` before review completion.
- Code stories: add/adjust Vitest coverage and run the smallest relevant `bun run test` target, or full `bun run test` if practical.
- Schema stories: regenerate `src/lib/data/database.types.ts` after migrations.
- No story should introduce barrel exports, `any`, non-null assertions, hidden filters, or a second filter schema.
