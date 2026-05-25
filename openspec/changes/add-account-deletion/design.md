## Context

Two identities back every user, linked but **not cascade-coupled** in either direction:

```
Better Auth: user ──cascade──▶ session, oauth_account
                  │ account.better_auth_user_id (FK, NO cascade either way)
App:          account ──cascade──▶ ~20 app tables (liked_song, playlist,
                                    job, match_*, billing, credits, …)
```

- A single `DELETE FROM account` cascades all personal app data (`src/lib/domains/library/accounts/queries.ts` owns the account row; the FKs are defined across `supabase/migrations/`).
- Deleting `account` does **not** remove the Better Auth `user`, and vice versa — both sides must be torn down explicitly.
- Auth is **Better Auth**, not Supabase Auth (`src/lib/platform/auth/auth.ts`). The `user.create.after` hook already provisions the app `account` + `account_billing` rows; deletion is the mirror image.
- All data access is service-role only (RLS is deny-all); the admin client is `createAdminSupabaseClient()` in `src/lib/data/client.ts`.
- **Storage:** none. **Sentry:** no PII (`sendDefaultPii:false`, no `setUser` — `src/lib/observability/sentry.client.ts`). **PostHog:** holds PII — `distinct_id = accountId` plus `spotify_id` / `spotify_display_name` person properties (`src/routes/_authenticated/route.tsx`).
- **Billing:** plans `quarterly`/`yearly` are live recurring Stripe subscriptions. There is **no Stripe-cancel code in this repo** — Stripe lives behind an external billing-service reached via `BILLING_SERVICE_URL`; the user-facing cancel path is the Stripe customer portal (`createPortalSession`, `src/lib/server/billing.functions.ts`). `account_billing` cascades off `account` and holds `stripe_customer_id` / `stripe_subscription_id`; `credit_transaction` is an immutable financial ledger that also cascades.
- **Scheduling:** there is **no** Cloudflare cron trigger (`wrangler.jsonc` has no `triggers`) and no pg_cron. A long-running Bun worker already runs a periodic sweep (`src/worker/sweep.ts` → `runSweepTick`, every 60s, admin Supabase access, tested in `src/worker/__tests__/sweep.test.ts`). This is the only existing recurring-work primitive.

The privacy policy (`public/legal/privacy.json`) already promises self-service deletion "from the app settings" and erasure of personal data on deletion — so the design must honor that promise and reconcile it with billing retention.

## Goals / Non-Goals

**Goals:**
- Self-service deletion from Settings that honors the existing privacy-policy promise.
- A 30-day recovery window so accidental/regretted deletions are reversible.
- Two-factor confirmation that works for both password and OAuth-only users.
- Complete erasure of personal data at purge, across DB, Better Auth, and PostHog.
- Retain legally-required financial records in a form decoupled from identity.
- No card keeps getting charged after deletion.

**Non-Goals:**
- In-app Stripe subscription cancellation (delegated to the Stripe portal).
- Scrubbing the customer record inside Stripe itself.
- Data export / portability (separate change).
- A generic background-job/cron framework — reuse the existing worker sweep.

## Decisions

### D1 — Soft-delete + 30-day grace, purged by the worker sweep (not Better Auth `deleteUser`)
Confirmation sets `account.deletion_requested_at = now()` and revokes sessions; the row stays alive in a `pending_deletion` state. The existing worker sweep gains a `purge_expired_accounts()` RPC that hard-deletes rows older than 30 days.

- **Why:** the grace-period decision rules out Better Auth's `deleteUser`, which is an immediate hard delete. The soft-delete state must live on *our* `account` table because that's what the 30-day clock and Restore screen read. Keeping the row alive during grace also keeps billing-webhook FKs resolvable.
- **Alternatives:** (a) Better Auth `deleteUser` immediately — rejected: no recovery window. (b) A new Cloudflare cron trigger or pg_cron for the purge — rejected: adds infrastructure when `runSweepTick` already runs continuously with admin access and a tested pattern. An idempotent `DELETE … WHERE deletion_requested_at < now() - interval '30 days'` is safe to run every tick.
- Better Auth's own `user` deletion is still called, but only at the *end* of purge (via `auth.api` / direct delete of the `user` row), cascading `session` + `oauth_account`.

### D2 — Two-factor confirmation: in-app type-to-confirm + email link
The Settings dialog requires typing a fixed phrase (with a copy button beside it); submitting sends a confirmation email; clicking the emailed link is what commits the request and starts the grace clock.

- **Why:** the email link is the real security gate — it works identically for Google-OAuth users (who have no password to re-enter) and prevents a hijacked live session from deleting the account. The type-to-confirm step adds deliberateness in-app.
- **Copy-button trade-off:** a copy button slightly weakens type-to-confirm's "prove you read it" intent, so the phrase is a deliberate sentence (e.g. `delete my account`) rather than the user's own email, and the email link remains the authenticating action. Accepted per product decision (lower friction on the in-app step, keyboard/accessibility-friendly).
- **Token:** signed, TTL'd, single-use, mirroring `sendPasswordResetEmail` / `sendVerificationEmail` (`src/lib/platform/email/`). Fail-safe: if the link is never clicked, nothing happens and the account stays active.

### D3 — Block deletion while a subscription is active/ending
`requestAccountDeletion` checks `BillingState`; if `subscriptionStatus` is `active` or `ending`, it refuses and the UI directs the user to the Stripe portal (`createPortalSession`) to cancel first.

- **Why:** there is no Stripe-cancel code in the app and Stripe is source of truth — deleting the local row never stops the charge, and a deleted account would receive `unlimited_activated` bridge events that FK-fail. Gating avoids building and maintaining a cancellation path while guaranteeing no orphaned billing.
- **Alternative:** auto-cancel via the billing-service during deletion — rejected for now: more coupling and failure modes; can be revisited.

### D4 — Retain + pseudonymize financial records (off the cascade)
At purge, copy the financial essentials (amounts, currency, dates, `stripe_customer_id`, `stripe_subscription_id`, invoice/event refs, plan) into a dedicated retention/archive table **with no `account_id` FK and no email/name** — a pseudonym key only — *before* the cascade wipes the live billing rows.

- **Why:** GDPR Art. 17(3)(b) carves out data needed to meet a legal obligation; tax/accounting law typically requires retaining transaction records for years. Cascade-deleting `credit_transaction` would destroy that. A separate, identity-decoupled archive satisfies both erasure and retention.
- **Alternative:** change billing FKs to `ON DELETE SET NULL` and null `account_id` — rejected: leaves retained rows interleaved with live data, messier to query and to reason about. A dedicated archive table is explicit.

### D5 — `pending_deletion` is auth-aware
When deletion is confirmed, all Better Auth sessions are revoked (signed out everywhere). Sign-in remains allowed, but the `_authenticated` guard routes a `pending_deletion` account to a Restore screen instead of the app. Restoring clears `deletion_requested_at`.

- **Why:** keeping sign-in open (rather than blocking it) is what makes the account recoverable and prevents same-email re-signup collisions during grace (the Better Auth `user` still exists, email is unique). This is the requirement delta against the `auth` spec.

## Risks / Trade-offs

- **Stray billing webhook during grace** → row is alive, FKs resolve; bridge handlers operate normally or no-op for `pending_deletion`. Low risk by design.
- **Purge runs every 60s** → use an idempotent `DELETE … WHERE` query; concurrent ticks are safe. Optionally guard to once/day, but not required.
- **Copy button lowers type-to-confirm friction** → mitigated by the email link being the true gate (D2).
- **Stripe still holds the customer email after purge** → out of scope; flagged for a follow-up billing-service scrub. The local copy is gone; Stripe retains invoices for tax.
- **Partial purge failure** (e.g. PostHog API down) → purge steps are ordered so the DB cascade is last; PostHog deletion is best-effort via `waitUntil` and retried on the next sweep tick since `deletion_requested_at` is only cleared by a successful purge. Make PostHog-delete idempotent and non-fatal.
- **Policy/feature mismatch** → privacy/terms/FAQ must ship in the same change disclosing the 30-day window and billing-retention carve-out, plus filling `__EMAIL__`.

## Migration Plan

1. **DB migration:** add `account.deletion_requested_at TIMESTAMPTZ NULL`; create the billing retention/archive table (no `account_id` FK); add the `purge_expired_accounts()` RPC. Backward-compatible — null `deletion_requested_at` means "active."
2. **Ship server + worker + email + UI** behind the existing surfaces; the sweep change is additive to `runSweepTick`.
3. **Ship legal copy** (`privacy.json`, `terms.json`, `faq.json`, `__EMAIL__`) in the same release.
4. **Rollback:** the feature is additive. Removing the UI entry point disables new deletion requests; the migration column/table can remain harmlessly. Accounts already in `pending_deletion` should be drained (purged or restored) before removing the worker sweep step.

## Open Questions

- Exact retention period for the financial archive (driven by applicable tax jurisdiction) — placeholder is "as legally required," distinct from the 30-day personal-data grace.
- Confirmation phrase wording for type-to-confirm (`delete my account` vs. a brand-voiced alternative).
- Whether to also delete the Stripe customer (vs. only cancel) once a billing-service scrub path exists.
- Whether to scrub the `waitlist` email on purge (completeness vs. leaving marketing signups untouched).
