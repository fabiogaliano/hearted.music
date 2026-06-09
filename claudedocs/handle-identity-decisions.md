# Handle Identity — Autonomous Run Decision Log

Every decision made on-the-spot that was **not** explicit in the plan or task files.
Terse. Append-only. Each entry: `[task NN | stage] decision — rationale`.

The plan (`docs/social/handle-identity-implementation-plan.md`) wins over task files
on disagreement; §15 is the decision index.

---

## Orchestrator setup

- `[setup] Starting state differed from the orchestrator brief.` Brief assumed branch
  `concept-audit-principles` with staged docs + uncommitted enrichment/cursor WIP. Actual:
  on `main`, tree clean, docs already committed (`b5efae7`), and the enrichment + liked-songs
  cursor work already committed (`cff1ec8`, `40cdbf5`). The cursor migration
  `20260609042937_fix_liked_songs_page_stable_cursor.sql` is the current migration tip and is
  already in main's history.
- `[setup] Skipped the commit→stash→cherry-pick dance.` Nothing to stage (clean), nothing to
  stash (clean), docs already in main. Just `git switch -c feat/handle-identity main`. The
  branch carries the docs and the cursor migration automatically.
- `[setup] No new git stash was created this run.` End-of-run report must NOT claim the user's
  WIP was stashed — it was already committed to main. (Pre-existing unrelated stashes remain in
  `git stash list` untouched.)
- `[setup] Orchestrating directly with the Agent tool (general-purpose subagents), not the
  Workflow tool.` The brief specifies fresh Task-tool subagents per stage with adaptive
  orchestrator gates ("STOP on >2 review rounds", "continue with what's unblocked") and real
  git/DB side effects — better served by in-the-loop gating than a deterministic script.
- `[setup] Serializing tasks (and all commits).` Overnight unattended; "when in doubt,
  serialize". Avoids `.git/index.lock`, local-DB, and lockfile races. Wall-clock cost accepted.

---

## Task 01

- `[task 01 | implement] Used a local inline validator function (readRequiredUrlClientEnv) instead of Zod in env.public.ts` — env.public.ts uses a hand-rolled readOptionalClientEnv pattern with no Zod import; the new required URL validator follows the same style to avoid introducing a new validation lib into that module.
- `[task 01 | implement] All four env files exist (.env, .env.local, .env.example, .env.cloud) and were all updated` — ls confirmed all four are present; no env files are missing.
- `[task 01 | implement] VITE_PUBLIC_APP_ORIGIN added to src/env.ts client schema and runtimeEnv` — repo convention is that all VITE_ client vars appear in both env.public.ts and env.ts (t3-oss/env-core); adding to env.ts as required z.url() keeps the two in sync.
- `[task 01 | implement] README optional-vars block updated (not a separate README snippet)` — no standalone env-vars README exists; the only VITE_ var docs are in README.md's optional block; added VITE_PUBLIC_APP_ORIGIN there.
- `[task 01 | orchestrator] On an APPROVE verdict with zero changes, orchestrator does the mark-done + commit directly instead of spawning a patch+commit subagent` — it's markdown bookkeeping (index.md row + task Status line), not feature code; saves an agent. Fresh patch+commit subagents are still used whenever review returns REQUEST_CHANGES.
- `[task 01 | orchestrator/ops] .env, .env.local, .env.cloud are gitignored; only .env.example is committed` — the prod value VITE_PUBLIC_APP_ORIGIN=https://hearted.music lives in gitignored .env.cloud, so the real cloud/deploy environment must set this var independently. Surfaced in end-of-run report.
