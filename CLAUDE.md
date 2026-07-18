Don't use barrel exports.
Use bun for everything, but for testing use vitest that is enabled by "bun run test"
Work on `main` branch unless explicitly asked not to.
DB-derived id sets must never re-enter a query as `.in()` URL filters; push the predicate into an RPC/join. `chunkedRead` is only for externally-sourced id lists.

## Required Skills

Use these skills proactively when working on this project:

- **`tanstack-start-react`** - Routes, loaders, server functions, SSE
- **`react-best-practices`** - Component patterns, performance
- **`web-interface-guidelines`** - UI review, accessibility

## Agent defaults (vendored for cloud/remote sessions)

These mirror the maintainer's global `~/.claude/CLAUDE.md`, committed here so cloud
sessions (which clone only the repo, not `~/.claude`) follow the same rules.

- Use bun for everything; run tests with `bun run test` (Vitest). Never npm.
- Comments explain WHY only — no section dividers, restate-code, or JSX labels.
- Build only what's asked. No speculative features.
- Never disable/skip tests. Find root cause, fix the issue.
- Tests → `tests/` or `__tests__/`. Scripts → `scripts/`. Analysis notes → `docs/tmp/`. Never create `claudedocs/`.
- Read files before Write/Edit. Absolute paths only. Parallel tool calls by default.
