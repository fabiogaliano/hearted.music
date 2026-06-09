# Task 02 — Schema & migrations

**Plan:** §4 (§4.1–§4.3) · **Recommended order:** steps 2–4 · **Status:** [x]

## Goal

Add the `account.handle` column and the atomic `claim_handle` RPC, then regen
types. Schema ships before app code (no feature flag; pre-prod, so no backfill).

The handle stays **nullable** because pre-claim rows must keep existing. The
unique index is on canonical `handle` directly — app + server normalization plus
the DB format check keep stored values canonical, so reads can use plain
`handle = normalizedHandle` without repeating `lower(btrim(...))`.

## Migration workflow (CLI, one migration at a time, on demand)

Create **each** migration on demand, at the moment you implement its sub-task —
**do not scaffold both files upfront**. Both are created and applied through the
`supabase` CLI; all DB inspection goes through the **`supabase-local` skill**. Never
hand-place a migration file or run ad-hoc DDL.

Per migration, run this loop — finish it for §4.1 before starting §4.2:

1. **Create just that one file** with the CLI — it auto-stamps the next
   `YYYYMMDDHHMMSS_*.sql` name after the current migration tip (confirm the tip with
   `ls supabase/migrations/ | sort | tail -1`; as of this writing
   `20260609003846_create_llm_usage.sql`):
   ```sh
   supabase migration new add_account_handle       # when doing §4.1
   # …author → apply → verify, THEN return for §4.2…
   supabase migration new create_claim_handle_rpc  # only then, when doing §4.2
   ```
2. **Author** the SQL in the generated file (bodies in §4.1 / §4.2).
3. **Apply** it incrementally and non-destructively against local:
   ```sh
   supabase migration up --local
   ```
   - Do **not** `supabase db reset` — it wipes local data + re-seeds; `migration up`
     applies only the new pending migration and preserves in-progress local
     onboarding rows used to exercise the claim flow.
   - Do **not** `supabase db push` — it promotes to the linked remote.
   - Do **not** apply schema via ad-hoc `supabase db query` DDL — schema must live in
     migration files so it survives a reset and reaches teammates.
4. **Verify** with the `supabase-local` skill's read path
   (`docker exec supabase_db_v1_hearted psql …`), not `supabase db query` (its pgx
   driver can't decode this schema's custom enum OIDs).

Repeat 1–4 for the second migration. After both have been applied, regenerate types
(§4.3): `bun run gen:types`.

> Pre-flight on this branch confirmed `account.handle`, `claim_handle`,
> `account_handle_key`, and `account_handle_format_check` do **not** yet exist —
> and **no migration files have been created yet**, so both are still to be authored
> on demand per the loop above.

## Checklist

### 4.1 — `account.handle` migration

- [ ] Create the file via `supabase migration new add_account_handle` (CLI-generated timestamp; never hand-place)
- [ ] New migration: `ALTER TABLE account ADD COLUMN handle TEXT` (nullable)
- [ ] Partial unique index `account_handle_key ON account (handle) WHERE handle IS NOT NULL`
- [ ] `account_handle_format_check` constraint: trimmed, lowercase, 1–30 chars, charset `^[a-z0-9._]+$`, no leading/trailing/consecutive periods (see §4.1 SQL)
- [ ] Confirm **no** RLS migration needed (`account_deny_all` already covers it)
- [ ] Reserved words / profanity stay out of the DB constraint (app/server concern)

### 4.2 — `claim_handle(UUID, TEXT)` RPC migration

- [ ] Create the file via `supabase migration new create_claim_handle_rpc` (CLI-generated timestamp; never hand-place)
- [ ] Create `public.claim_handle(p_account_id UUID, p_handle TEXT)` `RETURNS TABLE (status TEXT, owned_handle TEXT)`, `SECURITY DEFINER`, `SET search_path = public` (full body in §4.2)
- [ ] `FOR UPDATE` locks on the `account` and `user_preferences` rows
- [ ] Raise + abort on missing `account` or `user_preferences` row
- [ ] Return structured rows, **not** exception strings: `claimed` / `already_owned` / `not_ready`
- [ ] `not_ready` for first claim from a pre-claim step (`welcome`/`pick-color`/`install-extension`/`syncing`) **and** for invalid/unknown unfinished step tokens
- [ ] First claim canonicalizes unfinished `onboarding_step` → `flag-playlists` and clears `phase_job_ids` (incl. the `complete`-without-timestamp case)
- [ ] Same-handle re-entry never rewinds: advance only if persisted step is still `claim-handle`; otherwise leave later steps unchanged
- [ ] `already_owned` returns the existing different handle in `owned_handle`
- [ ] `REVOKE ALL` from `PUBLIC, anon, authenticated`; `GRANT EXECUTE` to `service_role` only
- [ ] SQL pre-claim guard mirrors `isOnboardingStepBefore(step, "claim-handle")` semantics (locked by integration tests in Task 15 → §14.5)

### 4.3 — Apply & follow-up

- [ ] Apply both with `supabase migration up --local` (**not** `db reset` / `db push` / ad-hoc `db query` DDL)
- [ ] Run `bun run gen:types`
- [ ] Confirm `account.handle` flows into `src/lib/data/database.types.ts`

## Files touched

`supabase/migrations/*` (two new migrations), `src/lib/data/database.types.ts` (regen).

## Dependencies

None (but the SQL pre-claim guard's intended semantics are mirrored by Task 08's
`isOnboardingStepBefore`; keep them aligned).

## Related tests

Task 15 → §14.5 (RPC / DB integration tests). These lock the SQL↔TS mirror.
