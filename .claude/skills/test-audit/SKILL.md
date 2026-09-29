---
name: test-audit
description: "Invoke whenever writing, changing, reviewing, or sweeping tests. Authoring gate for new tests plus audit workflow for low-value, implementation-coupled, or duplicative tests and the test-only production seams they demand."
---

# Test Audit

Adapted from OpenClaw's `test-audit` skill. The Testing section of the root
`CLAUDE.md` is the project's value bar; this skill is the procedure that
enforces it.

Three modes, one value bar. Authoring mode gates every new or changed test at
write time. Audit mode runs focused sweeps of tests that re-assert source,
duplicate stronger proof, couple behavior to implementation, or keep test-only
production seams alive. Continue broad audits as separate coherent follow-up
commits; optimize for confidence, not deletion count. Campaign mode prunes one
whole subsystem's test surface (every test file the worker, the extension, the
control panel, or one `src/lib` area owns); before starting one, read
[CAMPAIGN.md](CAMPAIGN.md).

## Authoring gate

Before adding any test, answer four questions; a missing answer means do not
add it yet:

1. What observable behavior, invariant, or independent contract does it protect?
2. What credible regression makes it fail? Name it — if it's a regression pin,
   the bug goes in the test title.
3. Why does existing coverage not already catch that failure? Each contract has
   one primary test owner at the strongest boundary; another layer needs its
   own distinct risk, such as a transport or lifecycle failure the owner cannot
   reach. Prefer extending a table-driven case or `src/test/fixtures.ts` over a
   near-duplicate test or an ad hoc fixture; consolidate duplicated setup in
   the same change.
4. Does it need a production seam (export, flag, wrapper, injection hook) that no
   production caller needs? If yes, move the test to the real boundary instead.

Then check the test against every [junk pattern](#junk-patterns); a match fails
the gate unless the [retention bar](#retention-bar) names the contract it
independently guards. A test that would break under behavior-preserving
refactoring is asserting implementation, not behavior; rewrite it at the
owning boundary before landing it.

Pick the boundary from the project's value order: money/entitlements,
job/state-machine transitions, data integrity, multi-step flows; pure logic
only where behavior isn't obvious from one read. A DB state machine belongs in
an `*.integration.test.ts` against real local Postgres, not in a suite that
mocks the Supabase client into the answer.

Bug regression tests must fail on the pre-fix code for the intended reason and
pass after the owner-boundary repair. A regression test that never demonstrably
failed proves the mock, not the fix. One regression at the owner boundary
covers the bug; do not replay the same scenario at every layer it crosses.

## Junk patterns

The shared checklist for both modes: the authoring gate rejects a new test that
matches one, and audits hunt for existing tests that do.

- assertion-free coverage probes;
- self-comparisons and identity copiers;
- copied fixtures, inventories, manifests, or export lists;
- exact source, import, or string greps;
- copy assertions: literal UI strings, `getByText` on prose, snapshot of
  rendered copy — a copy edit must never break a test (use `getByRole` + regex
  names);
- private predicate or call-shape tests duplicated at real boundaries;
- duplicate invocations of the same contract;
- per-feature replays of shared helpers (the same `src/lib` helper re-verified
  from each feature that calls it);
- tests whose only purpose is preserving test-only exports, globals, or wrappers;
- dead production code whose only callers are tests;
- expected values produced by the helper or renderer under test, or copied from
  a run of it instead of the spec or hand calculation;
- mocks that implement the asserted behavior, or one identical mock standing in
  for different APIs — including a Supabase/`postgres` mock that returns the
  row the assertion then checks;
- over-mocking: mocking `react` or `@tanstack/*`;
- fixtures that supply the claim, ack, or callback ordering the owner should
  produce, or persistence asserted against a table the path never writes;
- capability tests that restate declared flags or config instead of exercising
  the gate the flag promises (e.g. asserting an entitlement flag is set instead
  of that locked match results stay hidden);
- negative controls that pass for an unrelated reason, such as a denial from a
  different guard, a Zod rejection before the handler runs, or an `Err` the
  production path never reaches;
- names or fixtures that promise more than the input exercises, such as a
  "releases the job lock" test asserting the lock was not cleared.

## Value bar

Tests justify their maintenance cost by protecting behavior, a credible
regression, or an independently meaningful contract. In an audit, an existing
test that must change for behavior-preserving source reorganization is suspect,
not automatically deletable; the authoring gate still rejects new ones.

Before judging a candidate, read the complete test and production owner, its
entry point, callers, callees, sibling implementations, overlapping tests, CI
routing (`vite.config.ts` projects, `domTestFiles`, `liveTestExcludes`,
`.github/workflows/main.yml`), and relevant history (`git log -p -- <file>`).
Read the root `CLAUDE.md` and `docs/architecture/module-boundaries.md` first.
When the test claims dependency-backed behavior (Better Auth, Stripe,
`better-result`, Supabase, the Spotify API), inspect the dependency source or
types in `node_modules` directly.

## Discovery

Keep discovery read-only and report evidence before editing. For broad scope,
run parallel discovery lanes (one read-only agent each):

- domain and data (`src/lib/`: data, domains, server functions, platform);
- UI (`src/features/`, `src/routes/`, `src/components/`);
- the Bun worker (`src/worker/`);
- the WebExtension (`extensions/src/`);
- the control panel (`control-panel/server/`, `control-panel/src/`) and
  `scripts/**/__tests__`;
- a cross-cutting pattern sweep for the junk patterns.

Skip `.claude/worktrees/` — agent worktrees hold full repo copies. Outside
campaign mode, prefer a few high-confidence candidates over a large
speculative inventory. Write findings to `docs/tmp/test-audit-<scope>.md`.

## Retention bar

Keep a test when it independently enforces a public or cross-boundary
contract: billing/entitlement/unlock gates, job claim and status transitions
(compare-and-set, idempotent re-invocation), migrations, RLS and DB security
invariants, server-fn input schemas, auth/session, the extension ↔ app message
protocol, Spotify/Stripe webhook handling, LLM prompt bytes, env/config
defaults, or a documented architecture boundary. Also keep:

- call ordering when order is observable behavior;
- regressions with a credible failure mode — regression pins stay however
  trivial they look;
- source inspection when it is the cheapest independent guard: it fails when
  the contract changes (the user-facing key, byte, route path, or SQL
  predicate) and survives an identifier-only refactor;
- a retained test that fails on the baseline: treat it as a possible product
  bug, reproduce it, and repair the owner rather than deleting it.

Static or slow is not a deletion reason. A test that resembles implementation
may still be the independent contract; prove otherwise before removing it.

## Candidate evidence

Record every field below before editing. A missing field means the candidate is
not ready for deletion:

- exact test name and location;
- what failure it can actually detect;
- non-test callers of the covered production or support seam;
- stronger remaining owner-boundary proof, or why no proof is needed;
- relevant history and the reason the test or seam exists;
- production or test-support deletion unlocked;
- risk and the focused validation command.

## Edit shape

Choose one coherent owner-boundary batch. Delete obsolete test-only exports,
globals, wrappers, and dead production paths instead of preserving aliases.
Move retained regressions to their canonical owners. Consolidate repeated
dependency assertions into one generic contract and shared setup into
`src/test/fixtures.ts`, `src/test/mocks.ts`, or `src/test/utils/render.tsx`.

Prefer net-negative production LOC. Do not add replacement tests that restate
the same implementation, and do not convert uncertain candidates into cleanup
to increase deletion counts. Test pruning and production-seam removal are
structural changes: commit them separately from any behavior fix.

## Validation

Never edit source or tests while Vitest is running in the checkout.

1. Run the smallest owner and sibling tests: `bun run test <path>` (one file
   at a time; don't run the full suite to verify a file). Integration tests
   self-skip without local Supabase — a skip is not a pass. Start it
   (`supabase start`) and confirm the file actually ran. Stop the dev worker
   first when touching account-event suites; it races them.
2. For removed source greps or plan assertions, run the script, migration, or
   build that owns the real contract (`bunx supabase db reset` for migration
   assertions, `bun run ext:build` for manifest assertions).
3. `bun run check` on the changed paths, then `git diff --check`.
4. When a deletion removes an export or a seam: `bun run typecheck`, plus
   `bun run typecheck:worker` for `src/worker/` and
   `bun run typecheck:control-panel` for `control-panel/`. If a deleted or
   moved `.test.ts` was listed in `domTestFiles` or `liveTestExcludes`, update
   `vite.config.ts` in the same change.
5. Inspect `git diff --numstat`; report production/tooling separately from
   tests and test support.
6. After final audit edits, run `/code-review` on the diff.

## Landing and continuation

Work on `main` unless told otherwise. Commit only when authorized (use the
`commit` skill); never push without being asked — pre-push runs check,
typecheck, and the full suite. Land one coherent batch at a time; after
landing, rerun read-only discovery for the next high-confidence batch.

## Handoff

Report:

- root cause and removed low-value categories;
- production owner simplifications;
- retained false positives and why they remain valuable;
- focused and full proof actually run (including which integration files ran
  against real Postgres versus skipped);
- production versus test LOC;
- commit state;
- named follow-ups, including product bugs found but not fixed.
