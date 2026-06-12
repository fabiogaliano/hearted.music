# TypeScript 7.0 (native `tsgo`) adoption

**Date:** 2026-05-25
**Decision:** Adopt the TypeScript 7.0 native compiler (`tsgo`) as the **primary** typechecker, keep `tsc` 6.x as a pinned legacy fallback during the beta period.

## Why

TypeScript 7.0 is the port of the compiler from TypeScript to Go ("Project Corsa"). It is type-checking-only feature-identical to 6.x but dramatically faster. We only ever use TypeScript as a *typechecker* here (`noEmit: true`; Vite/esbuild does all transpilation), which is exactly the capability `tsgo` has matured first — so the riskiest beta gaps (programmatic API, declaration emit, `--build`) don't apply to us.

## Release status (as of 2026-05-25)

- TypeScript 7.0 **Beta** was announced 2026-04-21. Microsoft states type-checking logic is *"structurally identical to TypeScript 6.0"* and that it is *"ready for CI pipelines today."*
- It ships as a **separate package** during the beta: `@typescript/native-preview` (binary `tsgo`). The `typescript` package's `latest` is still `6.0.3`. The package will be renamed to `typescript` in a future release.
- We pin an exact dev build (`7.0.0-dev.20260524.1`) rather than the moving `@beta` tag for reproducible CI.

Sources:
- [Announcing TypeScript 7.0 Beta](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-beta/)
- [Progress on TypeScript 7 — December 2025](https://devblogs.microsoft.com/typescript/progress-on-typescript-7-december-2025/)

## Compatibility analysis

### Our toolchain — no blockers

| Beta limitation | Affects us? |
| --- | --- |
| Binary is `tsgo`, package is `@typescript/native-preview` | Yes — handled via scripts below |
| No stable programmatic API until 7.1+ | No — zero `import 'typescript'` consumers in source |
| Efficient `--watch` still landing | No — Vite owns the watch loop |
| `--outFile` removed; `tsc --build`/project-refs parallelization developing | No — we use `noEmit` + single `-p`, never `--build`/`--outFile` |
| JSDoc patterns restricted (JS support) | Negligible — `.ts/.tsx` codebase |
| Every `compilerOption` we use (`moduleResolution: bundler`, `allowImportingTsExtensions`, `verbatimModuleSyntax`, `noUncheckedSideEffectImports`, `paths`) | Supported |

### The one real discrepancy: `@ladle/react`

`tsgo` exits non-zero on **2 errors, both inside `node_modules/@ladle/react/typings-for-build/app/src/ui.tsx`** — zero in our 950 source files.

**Root cause (traced via `--listFiles`):** Ladle's `package.json` points `types` → a `.d.ts`, but its bundled `typings-for-build` tree includes `.tsx` *source* files. `tsc` loads 18 Ladle files and stops at the `.d.ts`; `tsgo` loads 20 and resolves into `ui.tsx`, then type-checks Ladle's own pre-existing React-19 typing bug. `skipLibCheck` only skips `.d.ts`, not `.tsx`, so it can't suppress this. Because 30+ of our story files import `@ladle/react`, the file enters the program regardless of `exclude` — excluding our own config/stories is not an option.

This is a **module-resolution divergence in the beta**, not a type-system change and not a bug in our code.

**Resolution (final): forked Ladle.** A `scripts/typecheck.ts` wrapper (ignore `node_modules`-origin errors, same spirit as `skipLibCheck`) was the interim fix. It was **superseded** by forking Ladle — the dialog-types fix already existed in Ladle's `main` (commit #626, removed the `@ts-ignore`) but was unreleased on npm 5.1.1. We published the fork as **`@fabiogaliano/ladle-react@5.2.0`** (also bumping its bundled Vite 6 → 8 / Rolldown to match our engine) and alias it as `@ladle/react`. With the fork installed, `tsgo --noEmit` is clean with **no wrapper**.

## What changed

- **Added** devDependency `@typescript/native-preview@7.0.0-dev.20260524.1` (binary `tsgo`).
- **Kept** `typescript@^6.0.3` for the legacy fallback (`tsc`).
- **Forked `@ladle/react`** → published `@fabiogaliano/ladle-react@5.2.0`, wired in via `"@ladle/react": "npm:@fabiogaliano/ladle-react@^5.2.0"` (all imports unchanged). Fixes the dependency type errors at the source; the fork's Vite 8 also lets us use `@vitejs/plugin-react` directly in `ladle-vite.config.ts` (no more swc neutralization). Fork source: `github.com/fabiogaliano/ladle`.
- **Scripts:**
  - `typecheck` → `tsgo --noEmit` (primary)
  - `typecheck:worker` → `tsgo -p src/worker/tsconfig.json --noEmit`
  - `typecheck:legacy` → `tsc --noEmit` (escape hatch)
  - `typecheck:legacy:worker` → `tsc -p src/worker/tsconfig.json --noEmit`

## Metrics: before vs after

Same machine, root project (`tsconfig.json`, 950 `.ts/.tsx` files), 3 isolated runs each, `--noEmit`, peak RSS via `/usr/bin/time -l`.

| | tsc 6.0.3 (before) | tsgo 7.0-beta (after) | Delta |
| --- | --- | --- | --- |
| Wall time, warm (median) | ~12.6 s | **~1.9 s** | **~6.5× faster** |
| Wall time, cold (run 1) | 18.76 s | 2.17 s | ~8.6× faster |
| Peak RSS | ~1044 MB | ~1077–1218 MB | ~15% more |
| Errors in our code | 0 | 0 | — |
| Dependency errors surfaced | 0 | 0 (after Ladle fork) | see above |

Raw runs — before: 18.76 / 11.84 / 13.43 s · after: 2.17 / 1.68 / 1.92 s.

`tsgo` trades ~15% more memory for the speed (Go runtime + multi-core checking; user-time ≈ 2× wall-time). Negligible on dev machines; note only for memory-capped CI runners.

## How to use / roll back

```bash
bun run typecheck          # fast path (tsgo), used by CI/hooks
bun run typecheck:legacy   # tsc 6.x fallback if tsgo ever disagrees
```

Full rollback: revert `package.json` scripts to `tsc --noEmit` and remove `@typescript/native-preview`.

## Open items

- **Re-pin to `typescript`** when 7.0 stabilizes and the package is renamed; remove the `:legacy` scripts after a clean soak period.
- **Track upstream Ladle** — when upstream ships the dialog-types fix (and ideally Vite 8 support), we can drop the fork and return to `@ladle/react`. Until then the fork lives at `github.com/fabiogaliano/ladle` and publishes `@fabiogaliano/ladle-react`.
