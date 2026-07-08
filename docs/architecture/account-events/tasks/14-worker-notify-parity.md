---
status: proposed
updated: 2026-07-08
depends_on: []
---

# 14 — Worker NOTIFY wake-up parity

Independent of the browser-push chain: give worker poll loops the same
notify-fast-path + poll-repair pattern extension sync already uses.
Proposal §2.4, §10, rollout phase 5. Can run in parallel with everything else.

## Steps

- [ ] Copy the `src/worker/notify-listener.ts` / `poll-extension-sync.ts`
      pattern
- [ ] Library-processing enqueue path: `NOTIFY` in the enqueue transaction →
      wake `src/worker/poll.ts`
- [ ] Deck-job enqueue path: same for `src/worker/poll-match-deck-jobs.ts`
      (this deliberately reverses the scope-cut in migration
      `20260706000010_enqueue_match_review_deck_job.sql`, which skipped
      `pg_notify`)
- [ ] Coalesce: at most one wake per queue/channel per 100–250 ms window
- [ ] Audio backfill (`poll-audio-feature-backfill.ts`) is optional — skip
      unless trivial once the pattern is in place
- [ ] Tests: enqueue→claim latency beats the poll interval; a dropped notify
      is still repaired by the poll loop

## Acceptance gate

- [ ] `bun run test` passes
- [ ] With notify active, a fresh job is claimed well under the 5 s poll
      interval
- [ ] With notifications suppressed in test, the poll loop still claims the
      job (at-least-once repair intact)
- [ ] Wake volume stays coalesced under burst enqueues

## Guardrails

- Poll loops are never removed — they are the repair path, notify is only the
  fast path.
- Empty or tiny NOTIFY payloads; never job bodies.
- Keep worker wake channels separate from the browser `account_event_wake`
  channel; monitor combined NOTIFY volume against the ~hundreds/sec
  cluster-wide convoy zone (proposal §10).
