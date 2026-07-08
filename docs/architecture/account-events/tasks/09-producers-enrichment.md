---
status: proposed
updated: 2026-07-08
depends_on: ["03"]
---

# 09 — Producers: enrichment events

Emit `enrichment_completed` / `enrichment_stopped` at the worker boundary
where the outcome is known. Contract §2; proposal §8.1.

## Steps

- [ ] Pick the settle boundary: `src/lib/workflows/library-processing/runner.ts`
      (or its helper layer) vs `src/worker/poll.ts` — whichever owns the final
      job-settled transaction
- [ ] On terminal success, `writeAccountEvent` with `enrichment_completed`
      `{ jobId, counts }` in the **same transaction** as the terminal state
      write; `counts` mirrors `ProgressCounts` from
      `src/lib/server/jobs.functions.ts`
- [ ] On terminal stop, emit `enrichment_stopped` with `reason` mapped to
      `"user_cancelled" | "failed" | "superseded"` plus final counts
- [ ] Tests: each terminal path writes exactly one durable row with the
      contract payload; non-terminal progress transitions write nothing

## Acceptance gate

- [ ] `bun run test` passes
- [ ] A completed job yields one `enrichment_completed` row whose counts match
      the job's final progress
- [ ] Cancel / fail / supersede each map to the correct `reason`
- [ ] Rolling back the settling transaction leaves no orphan event row

## Guardrails

- Outbox rule: event write and state change commit atomically or not at all.
- No `accountId` in the payload — column only.
- `firstVisibleMatchReady` stays derived; never promote it to an event
  (proposal §7.3).
