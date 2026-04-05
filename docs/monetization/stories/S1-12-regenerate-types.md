# S1-12 · Regenerate Supabase Types + Compile-Fix Pass

## Goal

Regenerate `database.types.ts` from the updated schema and fix any compilation errors caused by new tables, RPCs, or column changes.

## Why

Every new table, RPC, and column must be reflected in the generated TypeScript types. Downstream stories depend on these types being available and the project compiling cleanly.

## Depends on

- S1-01 through S1-11 (all schema and RPC migrations)

## Blocks

- All Phase 2 stories (TypeScript billing domain needs generated types)

## Scope

- Run Supabase type generation (`supabase gen types typescript`)
- Replace `src/lib/data/database.types.ts` with the output
- Fix any compile errors in existing code caused by the type changes
- Verify `bun run test` passes (no new test failures from type changes)

## Out of scope

- Writing new TypeScript modules that use the types (Phase 2)
- Changing application logic

## Likely touchpoints

| Area | Files |
|---|---|
| Generated types | `src/lib/data/database.types.ts` |
| Any file that imports from `database.types.ts` if signatures changed |

## Constraints / decisions to honor

- The generated file is auto-generated — do not hand-edit
- `song_analysis` measurement columns are nullable; existing code should not break

## Acceptance criteria

- [ ] `database.types.ts` includes all new tables and RPCs
- [ ] Project compiles without errors (`bun run build` or typecheck)
- [ ] `bun run test` passes with no new failures

## Verification

- `bun run build` or `tsc --noEmit`
- `bun run test`

## Parallelization notes

- Must wait for all Phase 1 migration/RPC stories to merge
- Quick turnaround — should be a small PR

## Suggested PR title

`chore(billing): regenerate Supabase types for billing schema`
