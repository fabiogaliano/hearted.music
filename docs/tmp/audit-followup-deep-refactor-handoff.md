# Task: decide whether seven audit findings share a root cause worth one deep refactor (analysis only, no code changes)

Repo: `fabiogaliano/hearted.music`, base `origin/main` (PR #32 merged, typecheck clean). Work read-only in a fresh worktree off `origin/main`; do not edit, commit or push. Read `CLAUDE.md` first: its design principles, module boundaries (`docs/architecture/module-boundaries.md`), glossary and testing rules are the standard to judge against. Then read `docs/architecture/audits/refactoring-opportunities-2026-10-06.md` (the audit) and `docs/tmp/worker-outcome-refactor.html` (a refactor already in flight on `library-processing/*`, `src/worker/*`, `execute.ts`, `extension-sync/runner.ts`, `enrichment-pipeline/types.ts`, `match-snapshot-refresh/types.ts`; treat those files as off-limits for your proposals).

## The question

The audit ranked findings one by one. Since then nine landed as local fixes. Seven are still open and were judged safe to run in parallel with the in-flight refactor:

| # | Finding | What remains on `main` |
|---|---|---|
| 3 | Match-visibility inputs hand-assembled per caller | The liked-songs filter bug is fixed. Fifteen `.in()` sites remain in `domains/taste/match-review-queue/` plus two `fetchOwnedPlaylistIds`; no `loadVisibilityPairs` RPC. |
| 6 | Entitlement predicate | Read moved to `domains/billing` and paged. `enrichment-pipeline/stages/content-activation.ts` still reads `account_billing` and calls billing RPCs directly; `liked-songs/filter-options-queries.ts` still uses chunked `.in()`. |
| 11 | Match-deck read model at the server-fn boundary | `lib/server/match-deck.functions.ts` is 1,048 lines; `match-deck-miss-path.ts` returns `Result` from `lib/server`; `resolveMatchDeckView` takes two opposite booleans. |
| 13 | Match filters validated by two schemas | Studio side fixed. `playlist-draft.functions.ts` hand-copies the schema; two `parseSaveMatchFilters` re-parses; one `matchFilters: z.unknown()`. |
| 14 | Dead prompt versions | Twelve `content-analysis/prompts` files v19–v30, selected only by `scripts/voice-audit/*`. |
| 15 | Untyped seams | `AnalysisContent` (9 refs), `payloadSnapshotId` (3), three `as unknown as …RpcResult` casts in `deck-read-queries.ts`. |
| 16 | Client cache invalidation owned by `lib/hooks`, defined in features | 13 `@/features` imports in `lib/hooks`; no `query-keys.ts`; no `billingStateQueryOptions`; `submitInFlight` duplicated. |

Decide: are these seven local cleanups, or symptoms of a few structural choices that one deeper refactor should fix? Give the answer as a decision the owner can take, with evidence.

## The lens

Judge against `CLAUDE.md` first. The principles below come from a sister project's standards; apply them only where they fit this codebase's actual stack (TanStack Start server fns, `better-result`, Supabase JS plus raw `postgres`, a Bun worker; no Effect, no ORM). Where the two disagree, `CLAUDE.md` wins; name the disagreement when it matters.

- **Deep modules.** A small interface hides a lot of work. Ask of every module you touch: is its interface simpler than its implementation? Would deleting it make the complexity vanish (then it is a pass-through and should be inlined)?
- **One module knows each choice.** SQL shape in one query module per subject; wire shape at the server-fn edge. Two modules that change together have leaked a choice. Layout by subject, never by phase.
- **One operation serves every door.** Server fn, worker, control-panel, scripts call the same function. Count the doors for each finding.
- **Functional core, imperative shell.** Derivations and transitions are plain functions with no I/O; server fns, loaders and the worker sequence them. `pure domain logic imports no IO` is already a `CLAUDE.md` rule.
- **Parse at the door, trust inside.** Zod once at the server-fn or RPC edge; the refined type travels; no downstream re-check. Illegal states unrepresentable: one discriminated union over co-occurring booleans or optional fields.
- **Define errors out of existence.** Before an error branch, ask if the meaning allows a no-op or an empty value.
- **DB-derived id sets never re-enter a query as `.in()`.** Push the predicate into an RPC or join.
- **Naming from the glossary.** A name you can't find is a design you can't see yet. Note every place the code uses a synonym.
- **Tests.** Few, load-bearing, outside-in at the server-fn or worker seam; real Postgres via `*.integration.test.ts`; no tests that pin a copy or a pass-through. Say which existing tests a restructure would make redundant and which it would need.

## What to look for

Three hypotheses to test, plus any you find:

1. **A match read model.** #3, #11 and #15 all read match pairs, decisions, ownership, entitlement, filter metadata and deck RPC payloads from different files with different casts. Is there one subject, "what this account may see matched, and in what order", that should own a single typed loader (one RPC or a small set) which the deck, the suggestions panel, the review queue and the proposal rebuilder all call? Measure: how many of the 15 `.in()` sites and 3 casts would it delete; how many doors would share it; what its interface would be in one signature.
2. **Parse-at-the-door as a system rule.** #13 and #15 are the same mistake in two places: a shape is validated weakly at the edge and re-parsed or cast downstream. Is the fix a convention plus a sweep, or is a module missing (for example `fromSupabaseRpc(schema, …)` already exists with one caller)? Count every server fn whose `inputValidator` is weaker than the domain schema it feeds, and every `as unknown as` or hand-decoder on an RPC or job payload.
3. **Query-key ownership.** #16 is a layering inversion: `lib/hooks` reaches up into features. Is the right shape a dependency-free `lib/query-keys.ts` with named invalidation sets, or should the SSE hook move up into features? Decide on dependency direction, not taste.

For #6, say whether `content-activation` touching billing tables is a one-off or whether enrichment has other billing knowledge that belongs in `domains/billing`. For #14, confirm nothing in `src/` selects v19–v30 and propose the move; this one is almost certainly local.

## Method

- Verify every claim against the code and quote `file:line`. Where the audit's line numbers have drifted, give the current ones.
- For each candidate deep module, write the proposed interface as TypeScript signatures with a one-line JSDoc stating the abstraction, then list what it deletes. No interface, no proposal.
- Build a conflict map: which files each proposal touches, and whether any overlap each other or the in-flight worker-outcome branch.
- Run nothing against production. You may run `bun run typecheck` and targeted `bun run test <file>`; the suite is not the gate.

## Deliverable

Write `docs/tmp/audit-followup-deep-refactor.md`, under 1,500 words, in this order:

1. **Verdict** in three sentences: local cleanups, one deep refactor, or a mix, and which.
2. **Root causes**, at most three, each with the findings it explains and the evidence.
3. **Proposed modules**, each with signature, doors served, files deleted, size (S/M/L), openspec needed yes/no, and the `CLAUDE.md` principle it satisfies.
4. **What stays local** and why.
5. **Order and parallelism**: which items can run as separate agents in separate worktrees without touching the same file, and which must wait for the worker-outcome branch.
6. **Open decisions for the owner**, each phrased as a choice with your recommendation first.
7. **Where the sister-project standards didn't fit** this codebase, in one short list.

Stop only when the file is written. If a hypothesis is false, say so plainly; a report that finds seven local fixes is a valid outcome.
