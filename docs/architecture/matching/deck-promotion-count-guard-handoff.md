# Handoff: promotion-side subject-count guard for `start_or_resume_match_deck`

Status: **not started** — deferred DB-level follow-up from the deck read-model
fix branch (`claude/match-deck-read-model-orchestrate-kzd5xs`, fix pass 3).
Prompt below is self-contained; hand it to a fresh session verbatim.

---

## Prompt

Add a subject-count consistency guard to branch-2 promotion in the
`start_or_resume_match_deck` RPC so a concurrent reader can never promote a
`ready` proposal whose subject rows are mid-rewrite.

### Why

`buildOneProposal` (`src/lib/domains/taste/match-review-queue/proposal-builder.ts`)
is five non-transactional PostgREST calls: upsert proposal
(`status='building'`, `total_subjects=0`) → DELETE subjects → INSERT subjects →
INSERT seed pairs → UPDATE (`status='ready'`, `total_subjects=N`) in one row
write. When a request-path inline build and a worker `build_proposals` job race
the same (account, orientation, hash), one writer can flip the row `ready`
while the other sits between its DELETE and re-INSERT. Any
`start_or_resume_match_deck` call landing in that window promotes zero/partial
subjects into a durable session, and the promotion's
`match_review_session_snapshot` ledger row makes `append_sessions`
short-circuit — the truncated session persists until the next snapshot publish.
The request path's own re-invoke is already guarded in TypeScript
(`src/lib/server/match-deck-miss-path.ts`, step 2a post-build re-check); this
guard closes the remaining concurrent-reader and worker-crash variants at the
promotion site itself.

### Change

One new migration (next available timestamp), full-body copy of
`supabase/migrations/20260707000018_start_or_resume_deck_consistent_progress_counters.sql`
with exactly two edits:

1. Header comment: state it supersedes 000018 by adding the count guard.
2. In the branch-2 proposal SELECT (the `WHERE ... p.status = 'ready'` block,
   ~line 87), add:

   ```sql
   AND p.total_subjects = (
     SELECT count(*) FROM public.match_review_proposal_subject ps
     WHERE ps.proposal_id = p.id
   )
   ```

Keep the `SECURITY DEFINER` / `SET search_path` / REVOKE-GRANT footer
untouched. No TypeScript changes: a mismatch falls into the existing BRANCH 3
miss, the miss handler's step-0 `findInFlightBuildProposalsJob` check finds the
running worker job and defers, and the client's bounded poll re-reads.

### Why this is sound (verify, don't re-derive)

- `ready` and `total_subjects` are written in the same UPDATE
  (`proposal-builder.ts:335-336`), so a `ready` row always carries its intended
  count atomically; the `building` upsert stamps `total_subjects=0`.
- The SELECT is one statement → one READ COMMITTED snapshot → the
  (status, count, subject rows) triple it sees is internally consistent.
- Residual after the guard: a reader promotes a complete, valid subject set
  just before the other writer's DELETE — that yields a correct full session,
  which is harmless.
- A legitimately empty proposal (`total_subjects=0`, zero rows) still passes
  (0 = 0) — pre-existing behavior, do NOT "fix" it.

### Verification gates

- Byte-diff the new migration against 000018: only the header comment and the
  added predicate may differ.
- `bun run test` (Vitest — never npm), `bun run typecheck`,
  `bun run typecheck:worker`, `bun run check` — all green.
- If a local Supabase is available, apply the migration and exercise: ready
  proposal with matching count promotes; a proposal with `total_subjects`
  greater than its row count returns the miss shape.

### Patches beyond the migration — apply only if actually needed

- `src/lib/server/match-deck-miss-path.ts` file-header step-2 docstring: one
  sentence noting the DB-side guard now covers the concurrent-reader/crash
  residual the re-check couldn't reach.
- Append an entry to
  `claudedocs/orchestration-deck-read-model-fixes-decisions.md` (decision +
  rationale, matching the existing entry style).
- Nothing else. No barrel exports; comments explain WHY only; never skip tests.

When the gates are green, commit (conventional style, e.g.
`fix(match): guard deck promotion on proposal subject count`) and push.
