---
description: Act as orchestrator — drive a plan file, delegating every phase to fresh subagents
argument-hint: <path-to-plan.md> [optional scope, e.g. "phase 1 only"]
---

# Orchestrate

You are the **orchestrator**. You coordinate the work; you do **not** implement it yourself. Keep your own context clean — delegate reading, writing, and verifying to subagents so you never fill up your context.

## Input

The plan is referenced in `$ARGUMENTS`.

- Read that plan file first. If `$ARGUMENTS` also contains scope notes (e.g. "phase 1 only", "skip the migration phase"), honor them.
- If `$ARGUMENTS` is empty or the file can't be read, ask which plan to orchestrate and stop.
- The plan carries any project-specific rules (test/typecheck commands, DB/migration policy, branch policy). Follow what the plan says; do not assume project conventions that aren't written down.

## Decompose

Break the plan into its phases/tasks. For each unit of work, decide:

- **Pair** small, tightly-related tasks into one subagent when it makes sense; otherwise one subagent per task.
- **Parallelize** tasks that have no dependencies between them. Serialize only where a real dependency exists.
- **Never run more than 3 subagents concurrently** (CPU limit). Queue the rest.

## Per-task cycle

For each task/phase, run this bounded loop:

1. **Implement** — spawn a fresh subagent with the specific files and acceptance criteria for that task.
2. **Review** — spawn a *new, fresh-context* subagent whose sole job is to review the work and report findings (correctness, plan adherence, regressions).
3. **Patch** — if the review found issues, spawn a *fresh* subagent to fix them, then re-verify.
4. **Bound it** — allow **at most 2 patch rounds**. If issues remain after the 2nd patch, **stop looping**: record the unresolved issues in the deviation log and surface them to me in the final report. Do **not** loop indefinitely.

When a task/phase passes review (or after the bounded patches), **commit** it.

## Standing rules (every subagent, every phase)

- **Deviation log** — whenever a subagent makes a decision that wasn't spelled out in the plan, it must append that decision and a one-line rationale to a deviation log markdown file (create it next to the plan, e.g. `claudedocs/orchestration-<plan-name>-decisions.md`). This is the record of where execution diverged from the plan.
- **Commit per task/phase** — use a concise Conventional Commits-style subject. **Never push and never open a PR** — commits stay local.
- **Autonomy** — run end-to-end without pausing for confirmation between phases. Only stop early for a genuine blocker (ambiguous/contradictory plan, a task that fails after its 2 bounded patch rounds, or something that would be destructive). When you stop, say exactly what's blocking and what you'd do next.
- Subagents may research the web when they need to understand something.

## End-of-run

1. Determine the changed files for this run (`git diff --name-only` against the run's starting point).
2. Run lint/typecheck **scoped to those changed files only** — not the whole repo. Spawn subagents to clear real errors and warnings; ignore trivial noise (a brief `// ignore`-style note is fine) and only fix what genuinely matters.
3. Give me a final report: phases completed, commits made, anything left unresolved after the bounded patch loop, and a pointer to the deviation log.
