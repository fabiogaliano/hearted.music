## Why

The privacy policy makes specific, self-service promises that are currently false: the summary banner says "You can delete your account and personal data anytime," and the GDPR section directs users to "Delete your account anytime **from the app settings**." No deletion mechanism exists — not in the UI, not as a server function. That is a live GDPR Art. 17 (right to erasure) exposure the moment any user asks, and a contradiction of a binding policy representation. Shipping deletion closes that gap.

## What Changes

- **New self-service account deletion** in Settings, behind a danger zone, honoring the policy's "from the app settings" promise.
- **Two-factor confirmation**: an in-app type-to-confirm step (with a copy button for the phrase) plus an email confirmation link. The email link is the security gate and works identically for password and Google-OAuth users.
- **30-day grace period (soft delete)**: confirming moves the account to `pending_deletion` — sessions are revoked immediately and app access is blocked, but the account is recoverable via a Restore screen for 30 days before permanent purge.
- **Subscription gate**: deletion is blocked while a paid subscription is active or ending; the user is directed to the Stripe customer portal to cancel first. No new Stripe-cancellation code; Stripe remains source of truth.
- **Permanent purge** runs in the existing background worker sweep: it pseudonymizes and archives financial records, deletes the PostHog person, cascade-deletes all personal app data, and deletes the Better Auth user (cascading sessions + OAuth tokens).
- **Billing retention**: financial/transaction records are retained for tax/legal obligations (GDPR Art. 17(3)(b)) in a form decoupled from identity, rather than cascade-deleted with the account.
- **Legal copy updates**: disclose the 30-day recovery window and the billing-record retention carve-out in the privacy policy, terms, and FAQ; fill the unset `__EMAIL__` contact placeholder.

## Capabilities

### New Capabilities
- `account-deletion`: the full deletion lifecycle — request, two-factor confirmation (type-to-confirm + email link), the `pending_deletion` soft-delete state with a 30-day grace window, restore, the subscription block, and the permanent purge (financial-record retention/pseudonymization, PostHog person deletion, cascade delete of personal data, Better Auth user deletion).

### Modified Capabilities
- `auth`: session handling and access gain deletion-aware behavior — all sessions are revoked when deletion is confirmed, and while an account is in `pending_deletion`, authenticated access is routed to the Restore screen instead of the app.

## Impact

- **Specs**: new `account-deletion` spec; delta to `auth` spec.
- **Database** (`supabase/migrations/`): add `account.deletion_requested_at`; add a billing retention/archive table that is **not** cascade-linked to `account`.
- **Server functions** (`src/lib/server/`): `requestAccountDeletion` (subscription gate + send confirmation email), `confirmAccountDeletion` (token → set `deletion_requested_at`, revoke sessions), `restoreAccount` (clear it).
- **Background worker** (`src/worker/`): a `purge_expired_accounts()` Supabase RPC invoked from `runSweepTick`, fronted by archive + PostHog person delete + Better Auth user delete.
- **Email** (`src/lib/platform/email/`): a "confirm account deletion" template + sender with a signed, TTL'd token, mirroring the existing password-reset / verification senders.
- **UI** (`src/features/settings/`, routes): Settings danger-zone section with confirm dialog and `pending_deletion` banner + countdown; an email-link landing route; a Restore screen; auth-guard routing for `pending_deletion`.
- **Third parties**: PostHog person deletion by `accountId` (distinct_id). Sentry holds no PII (no action). Stripe customer PII scrub is noted as out of scope.
- **Legal**: `public/legal/privacy.json`, `terms.json`, `faq.json` copy updates and `__EMAIL__`.

### Out of scope
- Building in-app Stripe subscription cancellation (delegated to the Stripe portal).
- Scrubbing/anonymizing the customer record inside Stripe itself.
- Data export ("right to portability") — adjacent GDPR feature, separate change.
