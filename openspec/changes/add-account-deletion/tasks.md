## 1. Database & Retention Schema

- [ ] 1.1 Add migration in `supabase/migrations/` adding `account.deletion_requested_at TIMESTAMPTZ NULL` (null = active). Confirm RLS stays deny-all.
- [ ] 1.2 In the same or a paired migration, create a financial retention/archive table with no `account_id` FK, no email, no display name — only pseudonym key, amounts, currency, dates, `stripe_customer_id`, `stripe_subscription_id`, invoice/event refs, plan.
- [ ] 1.3 Add a `purge_expired_accounts()` Supabase RPC (security definer) that, per eligible account (`deletion_requested_at < now() - interval '30 days'`): inserts pseudonymized financial archive rows, then `DELETE FROM account` (cascades app data). Returns the set of purged account IDs + Better Auth user IDs so the worker can finish external/auth deletion. Idempotent.
- [ ] 1.4 Run `supabase` migration locally and verify schema (column, table, RPC) via the `supabase-local` workflow.

## 2. Domain & Account Queries

- [ ] 2.1 In `src/lib/domains/library/accounts/queries.ts`, add `markAccountPendingDeletion`, `restoreAccount`, and `getAccountByBetterAuthUserId` (or reuse) returning `Result`.
- [ ] 2.2 Add an `isPendingDeletion` helper / surface `deletion_requested_at` through the account read used by `auth.server.ts` so the auth guard can see it.
- [ ] 2.3 Add a billing-archive write function (used by the worker) under `src/lib/domains/billing/` that maps live billing rows to the pseudonymized retention shape.

## 3. Confirmation Email

- [ ] 3.1 Add `src/lib/platform/email/send-account-deletion-email.ts` mirroring `send-password-reset-email.ts` (signed, single-use, TTL'd token; brand-voiced copy).
- [ ] 3.2 Define the deletion-confirmation token (sign + verify + single-use consumption), reusing existing token/secret infrastructure.

## 4. Server Functions

- [ ] 4.1 Add `requestAccountDeletion` in `src/lib/server/settings.functions.ts` (or a new `account.functions.ts`): require auth; read `BillingState`; if `subscriptionStatus` is `active`/`ending`, return a typed "subscription active" error; otherwise issue token and send the email.
- [ ] 4.2 Add `confirmAccountDeletion`: verify + consume token; set `deletion_requested_at`; revoke all Better Auth sessions for the user (`auth.api`); return success state with recovery deadline.
- [ ] 4.3 Add `restoreAccount`: require auth on a `pending_deletion` account; clear `deletion_requested_at`.

## 5. Background Purge (Worker Sweep)

- [ ] 5.1 In `src/worker/sweep.ts`, add a purge step to `runSweepTick`: call `purge_expired_accounts()`, then per returned account best-effort delete the PostHog person (distinct_id = accountId) and delete the Better Auth `user` (cascading sessions/oauth). Follow the existing `Result` error-handling pattern.
- [ ] 5.2 Make PostHog person deletion idempotent and non-fatal; ensure `deletion_requested_at` is only cleared by full success so failures retry next tick.
- [ ] 5.3 Add config (interval/threshold) alongside `src/worker/config.ts` if a per-day guard is wanted; otherwise rely on the idempotent query.

## 6. Auth Guard Routing

- [ ] 6.1 In the `_authenticated` route guard (`src/routes/_authenticated/route.tsx` / `auth.server.ts`), route `pending_deletion` accounts to the restore screen instead of the app.
- [ ] 6.2 Verify revoked-session behavior: a revoked cookie is treated as unauthenticated.

## 7. UI — Settings Danger Zone, Confirm Dialog, Restore

- [ ] 7.1 Add a danger-zone `SettingsSection` (no index) in `src/features/settings/SettingsPage.tsx` with a "Delete account" action, visually separated.
- [ ] 7.2 Build the confirmation dialog: type-to-confirm phrase input + copy button; confirm disabled until exact match; on submit call `requestAccountDeletion`.
- [ ] 7.3 Handle the subscription-active response: show explanation + link to the Stripe portal (`createPortalSession`).
- [ ] 7.4 Add the email-link landing route that calls `confirmAccountDeletion` and shows the scheduled-deletion confirmation with recovery deadline.
- [ ] 7.5 Build the account-restore screen (shown to `pending_deletion` users) with a Restore action calling `restoreAccount`, plus a `pending_deletion` banner/countdown.

## 8. Legal Copy

- [ ] 8.1 Update `public/legal/privacy.json`: disclose the 30-day recovery window and the billing-record retention carve-out (Art. 17(3)(b)); reconcile the "anytime" wording.
- [ ] 8.2 Update `public/legal/terms.json` and `public/legal/faq.json` to match.
- [ ] 8.3 Replace the `__EMAIL__` placeholder across legal JSON with the real contact address.

## 9. Tests & Verification

- [ ] 9.1 Unit/integration tests for server functions: subscription gate, token issue/verify/single-use, pending-deletion transition, restore (`tests/` or co-located `__tests__/`).
- [ ] 9.2 Worker purge test extending `src/worker/__tests__/sweep.test.ts`: <30d untouched, >30d purged, archive written without identity, PostHog failure non-fatal + retried, idempotent re-run.
- [ ] 9.3 Auth guard test: `pending_deletion` routes to restore; revoked session unauthenticated; same-email sign-in matches existing user.
- [ ] 9.4 `bun run test` green; `openspec validate add-account-deletion --strict` passes.
