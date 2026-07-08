---
status: proposed
updated: 2026-07-08
depends_on: ["06", "08", "09"]
---

# 11 — Shell switch: `useActiveJobs` + completion effects

First polling replacement: the global shell. Proposal §9.1, rollout phase 2.

## Steps

- [ ] Mount `useAccountEvents` once from `src/routes/_authenticated/route.tsx`
- [ ] `src/lib/hooks/useActiveJobs.ts`: one `getActiveJobs()` bootstrap, then
      hydrate `["active-jobs", accountId]` directly from `active_jobs_snapshot`
      frames
- [ ] Fallback: slow poll runs **only while the stream is disconnected**
      (driven by the hook's connection state), quiesces when connected
- [ ] Move the invalidations `useActiveJobCompletionEffects` performs today
      (dashboard `pageData`/`stats`/`recentActivity` + liked-songs keys) onto
      `enrichment_completed` / `enrichment_stopped` events; remove the
      polled-boolean edge inference
- [ ] Verify consumers (`DashboardHeader`, liked-songs header, etc.) need zero
      changes — the hook contract is identical
- [ ] Tests: snapshot frame updates the cache; disconnect resumes polling;
      terminal events fire the same invalidation set as before

## Acceptance gate

- [ ] `bun run test` passes; no consumer component diffs
- [ ] With the stream connected, the network shows no periodic
      `getActiveJobs()` calls after bootstrap
- [ ] Killing the stream resumes the slow fallback poll; reconnecting
      quiesces it
- [ ] Job completion invalidates exactly the key set the old effects hook did

## Guardrails

- Consumers keep the identical hook contract (proposal §9.4) — the data source
  changes underneath, nothing above.
- Do not delete the poll path; it is the designed fallback, just gated.
- Invalidation ownership stays in the shell — routes don't grow their own
  event listeners (contract §5.6).
