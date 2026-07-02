Don't use barrel exports.
Use bun for everything, but for testing use vitest that is enabled by "bun run test"
Work on `main` branch unless explicitly asked not to.
DB-derived id sets must never re-enter a query as `.in()` URL filters; push the predicate into an RPC/join. `chunkedRead` is only for externally-sourced id lists.

## Required Skills

Use these skills proactively when working on this project:

- **`tanstack-start-react`** - Routes, loaders, server functions, SSE
- **`react-best-practices`** - Component patterns, performance
- **`web-interface-guidelines`** - UI review, accessibility
