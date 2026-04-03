# Monetization Plan v2 — Manual Selection + Unlimited Passes

> This document is the canonical source of truth for monetization, billing, entitlement, and onboarding monetization behavior in `v1_hearted/`.
> Legacy exploration artifacts — including `.pi/todos/*` monetization notes and older monetization plan docs — are superseded by this file and should not be used for implementation decisions.

## TL;DR

- **Free tier**: one-time onboarding allocation of up to 15 songs, auto-selected from the most recent liked songs
- **Song packs**: every pack purchase grants 500 purchased songs-to-explore plus up to 25 most-recent liked songs auto-unlocked at no charge
- **3-month unlimited**: current auto-processing behavior, no selection needed
- **Yearly unlimited**: same + priority queue 
- **Billing object**: per-account song unlock; purchased balance is spent on unlock requests, not cache misses or raw compute
- **Global cache**: affects COGS only, not user billing
- **Pipeline split**: audio features + genres run for all songs at no cost; LLM analysis + embedding + matching are gated by effective entitlement; the value boundary is Phase B analysis
- **Repo split**: `v1_hearted/` owns product enforcement; `v1_hearted_brand/` owns Stripe integration + billing writes

---

## Product Model

### Free Tier
- **15 songs** total
- unlocked after onboarding completion if the user stays free
- v1 selection policy: auto-select up to the 15 most recent liked songs; user does not manually pick free songs
- free is a **one-time onboarding allocation**, not a persistent general balance
- if the user has fewer than 15 currently liked songs at onboarding completion, only those songs are unlocked; unused free allocation is forfeited for v1
- songs stay unlocked forever for that account

### Song Pack — $5.99 / 500 songs + 25 instant unlocks
- one-time purchase, buy as many as needed
- each pack purchase grants **500 purchased songs-to-explore** into `credit_balance`
- each pack purchase also auto-unlocks up to **25** of the account's most-recent currently liked songs that are not already unlocked, at no charge and separate from the purchased balance
- user explicitly selects which songs to explore from the purchased balance
- songs never expire, stay unlocked forever
- 1 song = 1 exploration unlock
- if fewer than 25 currently liked songs that are still locked exist at purchase fulfillment time, only those songs are auto-unlocked; unused bonus does not carry forward

### 3-Month Unlimited — $14.99/quarter
- unlimited explorations while active
- current auto-processing behavior (full library)
- target: users who want to organize their library in a burst
- cancellable anytime, access continues through paid period
- ~$5/mo equivalent; yearly is clearly better value at $3.33/mo (saves ~$20/yr, ~4 months free)
- implemented in schema and billing service; **hidden behind `BILLING_OFFER_QUARTERLY_ENABLED` feature flag until confirmed**

### Backstage Pass (Yearly Unlimited) — $39.99/yr
- unlimited explorations while active
- current auto-processing behavior (full library)
- priority processing queue
- patron / best-value tier

### User-facing language
- "songs to explore" — never "credits"
- "Explore more songs" — not "buy credits"
- internal code uses `credit_balance` for purchased/manual-use balance

---

## Architecture Review Revisions

These revisions tighten the original plan so it fits the current repo architecture more cleanly and avoids hidden edge-case traps.

### 1. Add a dedicated billing domain boundary in `v1_hearted/`

Do **not** spread billing rules across onboarding, route loaders, and workflow modules.

Create a focused billing domain, e.g.:

- `src/lib/domains/billing/state.ts` — read model + derived access flags
- `src/lib/domains/billing/queries.ts` — Supabase reads/writes
- `src/lib/domains/billing/unlocks.ts` — unlock request orchestration
- `src/lib/domains/billing/offers.ts` — internal offer IDs, not Stripe price IDs

This keeps pricing logic out of `library-processing` and matches the repo's domain-first structure.

### 2. Separate raw billing facts from effective access

The app should not treat `plan !== 'free'` as the whole truth.

Use this distinction:

- **raw billing facts**: `plan`, `subscription_status`, `subscription_period_end`, `cancel_at_period_end`, `credit_balance`
- **effective access**: whether the account may run Phase B/C + matching for a song right now

Effective access to a song is:

- `true` if the song already has an `account_song_unlock` row
- `true` if the account currently has active unlimited access
- `false` otherwise

This is the key architectural correction for unlimited users: active unlimited access must work **before** unlock rows exist.

### 3. Keep the control plane pricing-neutral

`src/lib/workflows/library-processing/*` should stay pricing-neutral, consistent with `docs/library-processing/implementation-plan.md`.

- queue band resolution may read billing state via `resolveQueuePriority(...)`
- `src/lib/workflows/library-processing/queue-priority.ts` should remain a thin adapter over billing-derived queue bands; plan/offer mapping stays in `src/lib/domains/billing/*`
- scheduler state must not store pricing copy, balances, or Stripe refs
- unlock decisions happen before work is requested, not inside the scheduler state model

### 4. Keep preprod bootstrap separate from launch semantics

Because this project is still preprod, there is no production user migration to preserve.

That means:

- no grandfathering path is required for launch
- no historical unlock backfill is required for production users
- any existing local/staging accounts can be reset or reseeded instead of migrated

Keep test-account bootstrap logic separate from real product semantics so preprod convenience does not leak into production architecture.

### 5. Use internal offer IDs everywhere outside the billing service

The public app should send stable internal offer IDs such as:

- `song_pack_500`
- `unlimited_quarterly`
- `unlimited_yearly`

Only `v1_hearted_brand/` should know Stripe price IDs.

### 6. HMAC auth needs replay protection

All server-to-server HMAC in v1 — both app-to-billing and billing-service-to-app bridge calls — should include at minimum:

- request timestamp
- raw body hash
- short clock-skew window

Shared-secret HMAC without a timestamp is replayable.

### 7. Billing-driven work still belongs to the control plane

The existing `library-processing` architecture says all external follow-on inputs should become typed `LibraryProcessingChange` values.

That needs to stay true for billing-driven work.

For this plan, add a billing helper group alongside the existing change helpers:

- `BillingChanges.songsUnlocked(accountId, songIds)`
- `BillingChanges.unlimitedActivated(accountId)`

This keeps billing-triggered scheduling inside the same control-plane contract as sync, onboarding, and worker outcomes.

### 8. Do not split enrichment into a second workflow slice in v1

`library_processing_state` currently has one enrichment slice and one match-snapshot-refresh slice.

For v1 monetization, keep that shape.

Implementation strategy:

- keep one `enrichment` job type
- keep one enrichment workflow slice in `library_processing_state`
- make the enrichment selector and orchestrator billing-aware per song
- do **not** introduce a second durable workflow just for Phase A vs Phase B/C

This is the minimal change that fits the current control-plane design.

### 9. Read-model enforcement is a first-class billing concern

Pipeline gating is not sufficient by itself.

The app must also enforce billing at read time.

Rules:

- global shared artifacts (`song_analysis`, `song_embedding`, shared audio features, shared genres) do **not** imply account access
- liked-song read models must return account-visible state, not raw artifact existence
- `song_analysis` may exist globally for a locked song, but the read model must still return `locked` and must not expose that analysis text to the account
- `match_result` is account-scoped (via `match_context.account_id`), not a global shared artifact; it still requires billing-aware visibility filtering because stale match results can reference songs whose access was later revoked
- locked songs must not expose shared analysis text or match output
- dashboard/stats counts such as "analyzed" must be billing-aware
- existing user-facing read contracts must be rewritten accordingly, including liked songs page/stats loaders, analyzed-count/dashboard stats loaders, song suggestion loaders, and match/session detail loaders
- missing `item_status` is not enough to call a song `pending`; locked and pending are distinct states

This is the main architectural guardrail against cache accidentally leaking paid value.

Canonical read-model rule:

- `locked` = not entitled, regardless of shared cache state
- `pending` = entitled, but account-visible analysis not yet activated
- `analyzed` / `has_matches` / `acted` require entitlement

Read-time access filtering for match/session loaders:

- match result and suggestion loaders must filter by current entitlement at read time, not only by snapshot contents
- this ensures revoked songs disappear immediately from matching UI, without waiting for the next match snapshot refresh
- the canonical entitlement predicate (`unlock row with revoked_at IS NULL` OR `active unlimited access`) must be applied in both liked-song read models and match/session read models
- match snapshots (`match_context` / `match_result`) are append-only; revocations do **not** delete old snapshots — the latest context supersedes, and read-time filtering handles the gap

### 10. Credit billing is triggered by LLM analysis, not audio features

Phase A (audio features + genre tagging) runs for all songs at no cost.

The credit unit is one LLM analysis run (Phase B):

- lyrical LLM path → 1 credit
- instrumental-track LLM path (for songs without lyrics / high instrumentalness) → 1 credit
- Phase A only, no LLM run → **0 credits**

Both LLM paths cost the same. The distinction is the prompt used, not whether a credit is charged.

Canonical accounting language:

- the **value boundary** is Phase B analysis
- for pack users, purchased balance is deducted at successful unlock request time, not when the worker later starts Phase B
- Phase A-only work never spends purchased balance

Corollary: a locked song that only has Phase A data consumes no credit and produces no account-visible analysis.

---

## Onboarding Flow

Canonical onboarding sequence:

1. welcome *(existing, unchanged)*
2. pick-color *(existing, unchanged)*
3. install-extension *(existing, unchanged)*
4. syncing *(existing, unchanged)*
5. flag-playlists *(existing, unchanged)*
6. song-showcase *(new)*
7. match-showcase *(new)*
8. plan-selection *(new)*
9. ready *(existing, copy/semantics updated — see note below)*
10. complete *(existing, unchanged)*

Notes:

- steps 1–5 and 10 already exist and are preserved; steps 6–8 are additions, step 9 needs updated copy
- the current `ReadyStep` copy assumes full-library processing for all users ("Going through every song. An email's on its way when it's ready."); this must be updated to reflect billing-aware behavior (free: 15 songs, pack: selected songs, unlimited: full library)
- the guided showcase uses a pre-seeded demo song and dedicated onboarding matching path, not the user's real liked-song pipeline as the primary first-value experience
- the demo song is completely outside monetization: no unlock row, no credit use, no replacement-credit semantics
- plan selection happens after the user has seen both song analysis and match output
- monetization logic begins only after that guided flow: free users get auto-allocation, pack buyers receive the pack offer plus bonus unlocks, and unlimited users begin full-library processing through active entitlement

### After onboarding completes

**If user stays free:**
- system auto-unlocks up to 15 most recent liked songs
- onboarding/free allocation does **not** use purchased `credit_balance`
- if fewer than 15 songs are currently liked at onboarding completion, only those songs are unlocked; no unused free allocation carries forward in v1
- Phase B/C + matching processes those songs in background
- user sees results as they complete

**If user buys a pack:**
- the pack grants 500 purchased songs-to-explore into `credit_balance`
- the pack also auto-unlocks up to 25 most-recent currently liked songs that are not already unlocked, without spending purchased balance
- after the bonus auto-unlocks, the user manually selects additional songs from the purchased balance
- the bonus auto-unlocks and the purchased balance are both part of the pack entitlement; refunds/chargebacks reverse both

**If user upgrades to unlimited:**
- skip auto-allocation
- full library processing begins through active unlimited entitlement
- `credit_balance` is preserved while unlimited is active and becomes usable again if unlimited later ends

### Billing availability during onboarding

- no pack or unlimited purchase entry points are shown before the onboarding upgrade step
- billing UI becomes available after the guided first-result / first-match path demonstrates value

### Why this flow works
- user experiences the full product value before seeing a price
- 1-song guided experience is the "aha moment"
- upgrade prompt comes after value is demonstrated
- no friction for free users who want to continue exploring

---

## Architecture

### High-level

```
User → v1_hearted (Cloudflare Workers)
         │
         ├── reads billing state from Supabase
         ├── enforces unlock rules
         ├── enqueues gated work
         │
         ├── calls v1_hearted_brand for checkout/portal
         │         │
         │         └── billing.hearted.music (VPS via Coolify)
         │                 ├── Stripe Checkout sessions
         │                 ├── Stripe Customer Portal sessions
         │                 ├── Stripe webhook handling
         │                 └── billing writes to Supabase
         │
         └── background worker (Bun on VPS)
                 ├── Phase A enrichment (all songs, no billing gate)
                 └── Phase B/C enrichment (effective entitlement only)
```

### Repo boundary

#### `v1_hearted/` (public) owns
- billing state reads from Supabase
- song unlock enforcement
- credit deduction (atomic RPCs)
- free auto-allocation logic
- onboarding flow integration with the song-showcase / match-showcase / plan-selection sequence
- song selection UI for pack users
- paywall / upgrade UI
- balance display
- queue priority resolution
- pipeline gating (Phase A vs Phase B/C)
- app-to-billing-service bridge (server functions)

#### `v1_hearted_brand/` (private) owns
- Stripe SDK integration
- checkout session creation
- customer portal session creation
- webhook verification + handling
- fulfillment writes to Supabase (credit grants, subscription activation)
- offer catalog / pricing mapping
- anti-abuse thresholds
- operational billing docs
- HMAC auth for app-to-service calls

### What stays in Supabase (shared)
- billing tables (schema owned by `v1_hearted/` migrations)
- billing RPCs (atomic operations)
- billing state is the single source of truth
- both repos read/write via service role

---

## Schema

### `account_billing`

One row per account in every deployment.

```sql
CREATE TABLE account_billing (
  account_id    UUID PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
  plan          TEXT NOT NULL DEFAULT 'free'
                  CHECK (plan IN ('free', 'quarterly', 'yearly')),
  credit_balance INTEGER NOT NULL DEFAULT 0
                  CHECK (credit_balance >= 0),

  -- Stripe refs (null until first interaction)
  stripe_customer_id       TEXT UNIQUE,
  stripe_subscription_id   TEXT UNIQUE,
  subscription_status      TEXT NOT NULL DEFAULT 'none'
                  CHECK (subscription_status IN (
                    'none', 'active', 'past_due',
                    'canceled', 'unpaid', 'incomplete', 'incomplete_expired'
                  )),
  subscription_period_end  TIMESTAMPTZ,
  cancel_at_period_end     BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Notes:
- every account gets an `account_billing` row in every deployment; missing row is an invariant violation, not a valid entitlement mode
- `plan` reflects the current paid offer, not the full access decision by itself
- `credit_balance` = purchased/manual-use songs available to explore
- effective unlimited access is derived from `plan` + `subscription_status` + `subscription_period_end`
- when subscription ends, `plan` reverts to `free`; `credit_balance` preserved
- unlimited users don't spend credits; balance sits untouched
- `cancel_at_period_end` is needed for correct UI and portal state reflection

### `account_song_unlock`

Tracks which songs are unlocked per account, with explicit revocation support for refunds/chargebacks.

```sql
CREATE TABLE account_song_unlock (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  song_id     UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  source      TEXT NOT NULL
                CHECK (source IN (
                  'free_auto', 'pack', 'unlimited', 'admin'
                )),
  granted_stripe_event_id TEXT,
  granted_stripe_subscription_id TEXT,
  granted_subscription_period_end TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  revoked_reason TEXT
                CHECK (revoked_reason IN (
                  'refund', 'chargeback', 'admin'
                )),
  revoked_stripe_event_id TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(account_id, song_id)
);

CREATE INDEX idx_account_song_unlock_account
  ON account_song_unlock(account_id);
```

Notes:
- source tracks how the unlock happened (for analytics + support)
- `granted_stripe_subscription_id` and `granted_subscription_period_end` are the reversal key for unlimited-period refunds/chargebacks (all unlocks in a period share the same values)
- `granted_stripe_event_id` is the reversal key for pack refunds/chargebacks (one event = one pack); for unlimited unlock rows it is optional audit metadata, not a reversal key
- active unlimited access is dynamic; unlock rows are still written as songs reach account-visible analysis during active unlimited access so access survives cancellation without mass pre-materialization
- `admin` is reserved for manual support actions or goodwill adjustments
- unique constraint prevents double-unlock / double-charge
- if a previously revoked song is unlocked again, v1 reuses the existing row by clearing revocation fields and updating `source` to the new active provenance
- unlocks persist independently of current liked-state; if a song is later unliked and then re-liked, the prior active unlock becomes effective again without spending additional purchased balance
- v1 does not add a separate UI for currently unliked songs; the prior unlock matters only if the song is later re-liked in Spotify and returns on a future sync
- effective access from an unlock row requires `revoked_at IS NULL`
- refunded/chargebacked pack usage can revoke pack-funded unlocks without deleting history

### `credit_transaction`

Immutable balance ledger.

```sql
CREATE TABLE credit_transaction (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  amount          INTEGER NOT NULL,
  balance_after   INTEGER NOT NULL,
  reason          TEXT NOT NULL
                    CHECK (reason IN (
                      'song_unlock',
                      'pack_purchase',
                      'replacement_grant',
                      'refund',
                      'chargeback_reversal',
                      'admin_adjustment'
                    )),
  stripe_event_id TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_txn_account
  ON credit_transaction(account_id, created_at DESC);
```

Suggested metadata payloads:
- `song_unlock` → `{ source, songIds, requestedCount, netNewCount }`
- `pack_purchase` → `{ offerId, checkoutSessionId, stripeEventId }`
- `replacement_grant` → `{ trigger: 'processing_failure', relatedSongId }`
- `refund` / `chargeback_reversal` → `{ refundedCredits, revokedSongIds, stripeEventId }`
- `admin_adjustment` → `{ actor, reason }`

### `billing_webhook_event`

Idempotent Stripe event processing.

```sql
CREATE TABLE billing_webhook_event (
  stripe_event_id TEXT PRIMARY KEY,
  event_type      TEXT NOT NULL,
  status          TEXT NOT NULL
                    CHECK (status IN ('processing', 'processed', 'failed')),
  error_message   TEXT,
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Notes:
- `processed` events are safe to ignore on duplicate delivery
- `failed` events must be retryable; do not permanently skip solely because the row already exists

### `billing_activation`

Durable billing-lifecycle activation markers for control-plane integration.

```sql
CREATE TABLE billing_activation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
        CHECK (kind IN ('unlimited_period_activated')),
  stripe_subscription_id TEXT NOT NULL,
  subscription_period_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(account_id, kind, stripe_subscription_id, subscription_period_end)
);
```

Notes:
- this table keeps durable orchestration markers out of `account_billing`, which remains focused on current billing facts
- `stripe_subscription_id` and `subscription_period_end` are NOT NULL because PostgreSQL treats NULLs as always distinct in UNIQUE constraints; nullable columns would silently break the idempotency guarantee
- for v1, `unlimited_activated` should be emitted at most once per `(account_id, stripe_subscription_id, subscription_period_end)`
- `v1_hearted/` should check/insert this marker transactionally before emitting `BillingChanges.unlimitedActivated(...)`

### `billing_bridge_event`

Durable app-side idempotency store for billing-service → app bridge calls.

```sql
CREATE TABLE billing_bridge_event (
  stripe_event_id TEXT PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  event_kind TEXT NOT NULL
               CHECK (event_kind IN (
                 'pack_fulfilled',
                 'unlimited_activated',
                 'pack_reversed',
                 'unlimited_period_reversed',
                 'subscription_deactivated'
               )),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Notes:
- v1_hearted inserts into this table before emitting control-plane changes for any bridge call
- duplicate bridge deliveries for the same `stripe_event_id` are no-ops: `INSERT ... ON CONFLICT DO NOTHING` and check whether the insert succeeded before proceeding
- this is the app-side complement to `billing_webhook_event` (which is billing-service-side / webhook-oriented)
- all billing-driven control-plane triggers (packs, unlimited, revocations) flow through this table

### RLS for new billing tables

All new billing tables should follow the repo's existing pattern:

- enable RLS
- deny direct anon/authenticated access
- rely on `service_role` bypass from trusted server code in both repos
- keep `billing_webhook_event` service-only
- keep `billing_bridge_event` service-only (written by v1_hearted server code only)

### Security for new billing RPCs

All new `SECURITY DEFINER` billing functions must pin `search_path = public` at creation time (e.g. `SET search_path = public` in the function definition). This matches the existing repo convention established in `supabase/migrations/20260330000001_fix_function_search_paths.sql` and prevents search-path injection. Do not rely on a separate retroactive hardening migration for new functions.

### Existing table: `song_analysis`

Add measurement columns (separate migration):

```sql
ALTER TABLE song_analysis ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE song_analysis ADD COLUMN IF NOT EXISTS input_tokens INTEGER;
ALTER TABLE song_analysis ADD COLUMN IF NOT EXISTS output_tokens INTEGER;
ALTER TABLE song_analysis ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10, 8);
```

Existing `tokens_used` and `cost_cents` columns preserved for backward compatibility.

Notes:
- these columns are for operational COGS visibility, not per-user billing
- new writes should populate the richer columns when available
- billing decisions must never depend on `song_analysis` cost fields

---

## Key RPCs

Atomic operations that both repos can call via Supabase service role.

### `unlock_songs_for_account`

```sql
-- Atomically: validate ownership/current-library membership, dedupe input,
-- ignore already-unlocked songs, check balance for only net-new unlocks,
-- deduct once, insert unlock rows, write ledger
-- Contract: all-or-nothing for net-new unlocks (no partial fulfillment)
-- Used by: pack song selection
CREATE FUNCTION unlock_songs_for_account(
  p_account_id UUID,
  p_song_ids UUID[],
  p_source TEXT
) RETURNS TABLE (
  newly_unlocked_song_ids UUID[],
  already_unlocked_song_ids UUID[],
  remaining_balance INTEGER
)
```

### `insert_song_unlocks_without_charge`

```sql
-- Insert unlock rows without deducting purchased balance
-- Used by: free auto-allocation, pack bonus auto-unlocks, admin fixes
-- Returns: unlocked song IDs
CREATE FUNCTION insert_song_unlocks_without_charge(
  p_account_id UUID,
  p_song_ids UUID[],
  p_source TEXT
) RETURNS UUID[]
```

### `activate_unlimited_songs`

```sql
-- Account-activation RPC for unlimited users.
-- Atomically:
--   1. upsert item_status for songs that are now account-visible
--   2. insert missing unlimited unlock rows with subscription provenance
-- Used by: enrichment orchestrator account-activation step for unlimited users
-- Returns: newly unlocked song IDs
CREATE FUNCTION activate_unlimited_songs(
  p_account_id UUID,
  p_song_ids UUID[],
  p_stripe_subscription_id TEXT,
  p_subscription_period_end TIMESTAMPTZ
) RETURNS UUID[]
```

Notes:
- carries subscription provenance so `account_song_unlock` rows have the `granted_stripe_subscription_id` and `granted_subscription_period_end` needed for deterministic period-level refund/chargeback reversal
- `granted_stripe_event_id` is not required here; `(subscription_id, period_end)` is the reversal key for unlimited periods
- does NOT deduct purchased balance
- sets `source='unlimited'` on all created unlock rows
- this is distinct from `insert_song_unlocks_without_charge`, which is for free/pack/admin paths that don't need subscription provenance

### `reverse_unlimited_period_entitlement`

```sql
-- Reverse unlimited-period entitlement after refund/chargeback.
-- Revokes all active source='unlimited' unlock rows whose
-- granted_stripe_subscription_id and granted_subscription_period_end
-- match the refunded period.
-- Contract: only source='unlimited' rows for the matching period are revoked;
--           free_auto/pack/admin unlocks are never touched.
CREATE FUNCTION reverse_unlimited_period_entitlement(
  p_account_id UUID,
  p_stripe_subscription_id TEXT,
  p_subscription_period_end TIMESTAMPTZ,
  p_reason TEXT,
  p_stripe_event_id TEXT
) RETURNS TABLE (
  revoked_song_ids UUID[]
)
```

Notes:
- `p_stripe_event_id` is recorded as `revoked_stripe_event_id` on the revoked rows (audit trail for why revocation happened)
- reversal key is `(p_stripe_subscription_id, p_subscription_period_end)`, not the grant-time event ID
- idempotent: rows already revoked for this period are skipped

### `grant_credits`

```sql
-- Add credits to balance, write ledger row
-- Used by: replacement grant, admin adjustment
CREATE FUNCTION grant_credits(
  p_account_id UUID,
  p_amount INTEGER,
  p_reason TEXT,
  p_stripe_event_id TEXT DEFAULT NULL
) RETURNS INTEGER  -- new balance
```

### `fulfill_pack_purchase`

```sql
-- Fulfill the canonical pack offer atomically.
-- Order of operations:
--   1. grant purchased balance (500)
--   2. auto-unlock up to 25 most-recent currently liked songs that are not
--      already unlocked, without
--      deducting purchased balance
--   3. return the bonus unlock song IDs so the public app can emit
--      BillingChanges.songsUnlocked(...)
CREATE FUNCTION fulfill_pack_purchase(
  p_account_id UUID,
  p_purchased_credits INTEGER,
  p_bonus_unlock_count INTEGER,
  p_offer_id TEXT,
  p_stripe_event_id TEXT
) RETURNS TABLE (
  new_balance INTEGER,
  bonus_unlocked_song_ids UUID[]
)
```

### `reverse_pack_entitlement`

```sql
-- Reverse pack entitlement after refund/chargeback.
-- Order of operations:
--   1. subtract refunded credits from current purchased balance
--   2. if refunded amount exceeds current balance, revoke newest active pack unlocks
-- Contract: free_auto/unlimited unlocks are never revoked by this RPC;
--           pack-funded bonus unlocks are revocable because they are part of
--           the pack entitlement
CREATE FUNCTION reverse_pack_entitlement(
  p_account_id UUID,
  p_refunded_credits INTEGER,
  p_reason TEXT,
  p_stripe_event_id TEXT
) RETURNS TABLE (
  remaining_balance INTEGER,
  revoked_song_ids UUID[]
)
```

### `activate_subscription`

```sql
-- Set plan + Stripe refs + lifecycle state
CREATE FUNCTION activate_subscription(
  p_account_id UUID,
  p_plan TEXT,
  p_stripe_subscription_id TEXT,
  p_stripe_customer_id TEXT,
  p_period_end TIMESTAMPTZ
) RETURNS VOID
```

### `deactivate_subscription`

```sql
-- Revert plan to 'free', preserve credit_balance
CREATE FUNCTION deactivate_subscription(
  p_account_id UUID
) RETURNS VOID
```

### `update_subscription_state`

```sql
-- Update non-activation subscription lifecycle fields without changing
-- purchased balance.
-- Used by: invoice.payment_failed, customer.subscription.updated,
-- uncancel, renewal-period-end refreshes
CREATE FUNCTION update_subscription_state(
  p_account_id UUID,
  p_subscription_status TEXT,
  p_period_end TIMESTAMPTZ,
  p_cancel_at_period_end BOOLEAN
) RETURNS VOID
```

### `reprioritize_pending_jobs_for_account`

```sql
-- Resolve the current queue band from billing state and update all pending
-- library-processing jobs for the account.
-- Used by: any billing state change that could affect queue band
-- Trigger conditions:
--   - yearly activation → priority
--   - quarterly activation → standard
--   - pack purchase on a free account (balance 0 → positive) → standard
--   - subscription deactivation → resolve from remaining state
--     (positive purchased balance → standard, otherwise → low)
CREATE FUNCTION reprioritize_pending_jobs_for_account(
  p_account_id UUID
) RETURNS INTEGER  -- number of jobs updated
```

Notes:
- resolves the queue band from current `account_billing` state internally, rather than accepting a priority parameter; this keeps the mapping in one place
- updates `queue_priority` on all `status = 'pending'` jobs for the account (both enrichment and match_snapshot_refresh)
- no-ops if no pending jobs exist
- does not affect jobs already in `claimed` or `running` status

### RPC guardrails

- fallback/self-healing row creation must not create accidental purchased balance
- replacement credits for terminal processing failures should use `replacement_grant`
- unlock request validation should reject malformed, non-owned, or no-longer-liked song IDs for the request as a whole
- unlock request input should be capped in v1 (recommended: max 500 song IDs per request)
- pack purchase fulfillment must stay idempotent at the Stripe-event level
- any authenticated billing-service → app bridge that reports fulfillment or revocation outcomes must also be idempotent on `stripe_event_id`
- duplicate bridge deliveries must not emit duplicate `songs_unlocked`, `unlimited_activated`, or revocation side effects
- refund/chargeback reversal must revoke newest active `source='pack'` unlocks first after purchased balance is exhausted
- full pack refund reversal must account for the whole pack entitlement, not only purchased balance (for the canonical pack offer, that means reversing 500 purchased credits plus the 25 pack-funded bonus unlocks)
- all balance-mutating RPCs must lock `account_billing` with `SELECT ... FOR UPDATE` before reading `credit_balance`

---

## Billing → Library Processing Integration

### New control-plane change variants

Add billing-shaped change variants to the `LibraryProcessingChange` union:

```ts
| {
    kind: "songs_unlocked";
    accountId: string;
    songIds: string[];
  }
| {
    kind: "unlimited_activated";
    accountId: string;
  }
| {
    kind: "candidate_access_revoked";
    accountId: string;
  }
```

Design rationale:

- positive events stay specific: `songs_unlocked` carries IDs (needed for enrichment scheduling), `unlimited_activated` is account-wide
- the negative event is simple: `candidate_access_revoked` only means "candidate set shrank, refresh snapshot" — it does not carry song IDs, refund reasons, or Stripe refs
- the control plane never learns *why* access changed, only *that* it changed
- if `library-processing` starts referencing refunds, chargebacks, or Stripe subscription IDs, the boundary has been crossed

Grouped source helpers should expand to include:

- `BillingChanges.songsUnlocked(...)`
- `BillingChanges.unlimitedActivated(...)`
- `BillingChanges.candidateAccessRevoked(...)`

### When these changes are emitted

- free auto-allocation → emit `songs_unlocked`
- pack purchase bonus unlock fulfillment → emit `songs_unlocked`
- manual finite-user selection → emit `songs_unlocked`
- first transition into a newly active unlimited subscription period should emit `unlimited_activated`; the billing service triggers this via the same bridge pattern as pack fulfillment, and `v1_hearted/` records it durably in `billing_activation` and `billing_bridge_event`
- pack refund/chargeback reversal or unlimited-period refund that actually removed access → emit `candidate_access_revoked`; the billing domain in `v1_hearted/` determines whether access was actually removed before emitting — the control plane never sees billing details
- `candidate_access_revoked` triggers match snapshot refresh only, not enrichment; the reconciler treats it as "candidate set shrank"

### Repo-boundary rule

`v1_hearted_brand/` owns Stripe fulfillment and writes raw billing facts.

`v1_hearted/` owns control-plane integration.

That means:

- the billing service does **not** import or run `applyLibraryProcessingChange(...)`
- `songs_unlocked` is emitted directly in `v1_hearted/` after successful unlock RPCs (manual selection, free auto-allocation)
- all billing-service-driven control-plane triggers (pack fulfillment, unlimited activation, revocations) use **one bridge pattern**: the billing service calls an authenticated bridge endpoint in `v1_hearted/` after writing raw billing facts
- the bridge uses HMAC + timestamp + raw-body-hash + replay-window authentication
- `v1_hearted/` claims each bridge call in `billing_bridge_event` before emitting control-plane changes; duplicate deliveries for the same `stripe_event_id` are no-ops
- for pack fulfillment, the bridge carries `bonus_unlocked_song_ids` so `v1_hearted/` can emit `BillingChanges.songsUnlocked(...)`
- for unlimited activation, the bridge carries `stripe_subscription_id` and `subscription_period_end` so `v1_hearted/` can insert the `billing_activation` marker and emit `BillingChanges.unlimitedActivated(...)`
- for revocations, the bridge carries the reversal outcome; the billing domain in `v1_hearted/` determines whether the revocation actually removed access, then emits `BillingChanges.candidateAccessRevoked(...)` — the control plane only sees the invalidation signal, never the billing details

This keeps the repo boundary clean, uses one ingress model for all billing-driven triggers, and gives replay/idempotency a real storage boundary.

---

## Pipeline Changes

### Current pipeline stages
1. **audio_features** — ReccoBeats API (Phase A)
2. **genre_tagging** — Last.fm API (Phase A)
3. **song_analysis** — LLM via AI SDK (Phase B)
4. **song_embedding** — embedding model (Phase C)
5. **account_activation** — account-scoped content-ready + unlock persistence
6. **matching** — vector similarity + scoring (separate workflow)

### New behavior

#### Phase A (unbounded, no billing gate)
- audio features + genre tagging run for ALL liked songs
- selector returns per-song stage work, not a coarse tier

#### Phase B/C (gated by effective entitlement)
- LLM analysis + embedding only run when the song currently has effective entitlement
- entitlement remains `unlock row OR active unlimited access`; billing-disabled mode is an explicit deployment-level bypass and must never be inferred from missing `account_billing` rows
- these remain shared artifact stages; they do not themselves finalize account-visible state

#### Account activation (account-scoped, after shared stages)
- after shared stages run, the orchestrator performs an explicit account activation step for the selected songs
- this step is driven by current DB truth, not by "which songs ran B/C in this chunk"
- activation responsibilities:
  - create/update `item_status` only for songs that are now account-visible for this account
  - persist `account_song_unlock` rows with `source='unlimited'` for unlimited users whose songs have become account-visible but are not yet durably unlocked
- account-visible threshold = `is_account_song_entitled(...) = true` **and** `song_analysis` exists
- this intentionally does **not** wait for embedding; analysis is the paid, user-visible value and should survive later cancellation once shown

#### Matching (gated by effective entitlement)
- match snapshot refresh only considers entitled + fully-enriched songs
- `select_data_enriched_liked_song_ids` should be replaced or extended so it filters by the same entitlement predicate as Phase B/C
- candidate eligibility remains stricter than content visibility: audio features + genres + analysis + embedding + entitlement

### Pipeline split implementation strategy

Use **one enrichment workflow** with an explicit **per-song work plan** and a first-class account activation stage.

- keep the current `enrichment` job type
- keep one `enrichment` slice in `library_processing_state`
- the selector returns exact per-song stage flags, not `lightweight | full | both`
- the orchestrator runs each shared stage against the exact sub-batch that still needs it
- the orchestrator then runs `account_activation` for the selected songs based on post-stage DB truth
- stage runners remain idempotent; activation is the account-scoped reconciliation step
- enrichment progress totals are derived from the actual planned stage flags for the selected songs, not from `songs * 4`
- `newCandidatesAvailable` is computed from before/after candidate snapshots across the whole selected set, not only songs that ran analysis/embedding in this chunk
- billing-driven changes (`songs_unlocked`, `unlimited_activated`) still invalidate refresh directly because some songs may already be candidate-ready from shared cache before any new B/C work runs

This avoids introducing a second workflow slice, second active-job pointer, or second freshness cycle.

### `item_status` semantics under billing

Current code writes `item_status` after full enrichment finishes, and the current liked-songs read models treat `item_status` absence as `pending`.

Under billing:

- `item_status` should mean **account-visible content has been activated for this account**
- row existence supports newness/account-scoped activation, not entitlement or display-state derivation by itself
- songs that only completed Phase A should **not** get `item_status`
- locked songs are **not** the same thing as pending songs
- missing `item_status` is only a scheduling reason through the activation stage for entitled songs; it is not a standalone top-level requeue reason
- existing generic pipeline-completion writes to `item_status` must be replaced; in billing-enabled mode, `item_status` is written only by the account-activation step

Implication:

- liked-song read models (`get_liked_songs_page`, stats, filters) must become billing-aware and expose a distinct locked/explorable state instead of treating every missing `item_status` row as pending work

### Selector contract

When billing enforcement is enabled, replace the current full-pipeline selector shape with a billing-aware contract.

Recommended selector shape:

```sql
CREATE FUNCTION select_liked_song_ids_needing_enrichment_work(
  p_account_id UUID,
  p_limit INTEGER
) RETURNS TABLE (
  song_id UUID,
  needs_audio_features BOOLEAN,
  needs_genre_tagging BOOLEAN,
  needs_analysis BOOLEAN,
  needs_embedding BOOLEAN,
  needs_content_activation BOOLEAN
)
```

Rules:

- `needs_audio_features = true` when shared audio features are missing
- `needs_genre_tagging = true` when shared genres are missing
- `needs_analysis = true` when the song is entitled and shared analysis is missing
- `needs_embedding = true` when the song is entitled and shared embedding is missing
- `needs_content_activation = true` when the song is entitled, analysis exists, and the account-scoped ready/new row is still missing
- a song is returned when **any** stage flag is true
- missing `item_status` is **not** a standalone selector reason for non-entitled songs
- terminal failures stay excluded as they are in the current selector path
- ordering stays most-recent-liked first for v1

Implementation note:

- `is_account_song_entitled(...)` remains the semantic source of truth for entitlement
- billing-disabled mode should be passed into billing-aware SQL explicitly, preferably as a boolean function/RPC parameter such as `p_billing_enabled`; SQL must not infer billing mode from row absence
- the selector may still compute account-level billing facts once per query internally for efficiency, as long as it preserves the exact entitlement semantics

For match refresh candidates, add a billing-aware candidate selector such as:

```sql
CREATE FUNCTION select_entitled_data_enriched_liked_song_ids(
  p_account_id UUID
) RETURNS TABLE(song_id UUID)
```

Rules:

- require all 4 shared artifacts
- require effective entitlement (`unlock row OR active unlimited access`)
- do not require account-scoped `item_status`

In other words, the current selectors are not just renamed — their meaning changes.

### Implementation approach

Use one orchestrator pass with explicit sub-batches per stage:

1. load the work plan for the next selected songs
2. snapshot candidate eligibility for those selected songs before running stages
3. run `audio_features` on songs with `needs_audio_features`
4. run `genre_tagging` on songs with `needs_genre_tagging`
5. run `song_analysis` on songs with `needs_analysis`
6. run `song_embedding` on songs with `needs_embedding`
7. run `account_activation` by re-querying the selected song IDs and reconciling:
   - which songs are now account-visible
   - which of those still need `item_status`
   - which unlimited songs still need durable unlock rows
8. snapshot candidate eligibility again and compute `newCandidatesAvailable` from the delta

Why this shape is preferred:

- it matches the real execution graph: shared artifact production first, account-scoped activation second
- it avoids conflating "needs analysis/embedding" with "needs account activation"
- it correctly handles cached shared artifacts, where a Phase-A-only chunk can still create new match candidates
- it preserves one durable workflow without hiding account-scoped state changes in ad hoc post-processing

Trigger chain in v1:

- unlock succeeds
  → emit `BillingChanges.songsUnlocked(...)`
  → `applyLibraryProcessingChange(...)`
  → control plane ensures enrichment / refresh work as needed

- unlimited becomes active
  → billing service calls bridge endpoint in v1_hearted
  → v1_hearted claims event in `billing_bridge_event`, inserts `billing_activation` marker
  → emit `BillingChanges.unlimitedActivated(...)`
  → `applyLibraryProcessingChange(...)`
  → control plane ensures enrichment / refresh work as needed

### Key files affected
- `src/lib/domains/billing/*` — billing state, entitlement helpers, unlock orchestration
- `src/lib/workflows/library-processing/changes/billing.ts` — billing source helpers
- `src/lib/workflows/library-processing/types.ts` — new billing change variants
- `src/lib/workflows/library-processing/reconciler.ts` — billing-aware staleness rules
- `src/lib/workflows/enrichment-pipeline/batch.ts` — work-plan selector + candidate snapshot helpers
- `src/lib/workflows/enrichment-pipeline/orchestrator.ts` — stage sub-batching + account activation
- `src/lib/workflows/enrichment-pipeline/progress.ts` — totals derived from planned stage work, including activation
- `src/lib/workflows/match-snapshot-refresh/orchestrator.ts` — candidate filter
- `src/lib/workflows/library-processing/queue-priority.ts` — resolve from billing
- `src/lib/server/liked-songs.functions.ts` + liked-song SQL read models — locked vs pending semantics
- `src/lib/server/matching.functions.ts` + matching/session loaders — billing-aware suggestion and match visibility
- `src/lib/server/dashboard.functions.ts` + analyzed-count/stats SQL — billing-aware dashboard counts and previews
- `supabase/migrations/` — new selectors

### Unlimited users
Unlimited should **not** rely on pre-writing unlock rows for the whole library.

Instead:
- active unlimited access authorizes full processing dynamically
- all liked songs remain eligible for full pipeline while unlimited is active
- unlock rows are written when songs reach account-visible analysis during active unlimited access (for post-cancel durability)
- newly synced songs while unlimited is active are also eligible immediately

---

## Billing Service (`v1_hearted_brand/`)

### Stack
- Bun HTTP server (`Bun.serve()`)
- Hono or manual routing
- Stripe SDK
- Supabase JS client (service role)
- deployed via Coolify on VPS
- reachable at `billing.hearted.music`

### Endpoints

| Method | Path                  | Purpose                                                        |
| ------ | --------------------- | -------------------------------------------------------------- |
| POST   | `/checkout/pack`      | create Checkout session for song pack                          |
| POST   | `/checkout/unlimited` | create Checkout session for subscription (quarterly or yearly) |
| POST   | `/portal/session`     | create Stripe Customer Portal session                          |
| POST   | `/webhooks/stripe`    | receive + verify + fulfill Stripe events                       |
| GET    | `/health`             | health check                                                   |

### Auth
- app-to-billing: HMAC shared secret + timestamped request signature in headers
- billing-service-to-app bridge: same HMAC shared secret pattern with timestamped request signature and replay protection
- webhook endpoint: Stripe signature verification (not HMAC)

### Webhook events to handle

| Event                                            | Action                                                                                                                                                                                                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkout.session.completed` (mode=payment)      | call `fulfill_pack_purchase` RPC, then call app bridge with fulfillment outcome                                                                                                                                                                           |
| `checkout.session.completed` (mode=subscription) | store customer/subscription mapping                                                                                                                                                                                                                       |
| `invoice.paid`                                   | call `activate_subscription` RPC (initial) or `update_subscription_state` (renewal), then call app bridge for unlimited activation on initial                                                                                                             |
| `invoice.payment_failed`                         | call `update_subscription_state` to reflect `past_due` / payment-problem state                                                                                                                                                                            |
| `customer.subscription.updated`                  | call `update_subscription_state` for cancel/uncancel/status changes                                                                                                                                                                                       |
| `customer.subscription.deleted`                  | call `deactivate_subscription` RPC                                                                                                                                                                                                                        |
| `charge.refunded` / `charge.dispute.created`     | for pack purchases: call `reverse_pack_entitlement`, then call app bridge with reversal outcome; for unlimited periods: call `reverse_unlimited_period_entitlement`, then call app bridge with reversal outcome; create admin task for anything ambiguous |

### Subscription fulfillment strategy
- `checkout.session.completed` (payment): fulfill the canonical pack offer via `fulfill_pack_purchase(...)`
- `checkout.session.completed` (subscription): store Stripe refs, do NOT grant access
- `invoice.paid` + subscription active: grant access on initial purchase (`activate_subscription`) and refresh lifecycle fields on renewal (`update_subscription_state`)
- this avoids double-granting on initial subscription
- renewals: `invoice.paid` with `billing_reason=subscription_cycle` confirms continued access
- accept `customer.subscription.updated` with `cancel_at_period_end = false` as the uncancel path
- use `billing_webhook_event` table for idempotency on all handlers

### Metadata strategy
- `metadata` on Checkout Session: `{ account_id }` (available in `checkout.session.completed`)
- `subscription_data.metadata` on subscription Checkout: `{ account_id }` (available via subscription on `invoice.paid` events at `subscription_details.metadata`)
- public app sends internal offer IDs; billing service resolves Stripe product/price IDs server-side
- when `account_billing.stripe_customer_id` already exists, Checkout creation should reuse it instead of creating a new Stripe customer

### Customer Portal config (MVP)
- cancel subscription: enabled
- payment method update: enabled
- plan switching: **disabled** (avoid proration/downgrade complexity for v1)
- quarterly ↔ yearly switching is an accepted v1 limitation; user re-subscribes after the active term ends

---

## Public App Changes (`v1_hearted/`)

### New server functions
- `getBillingState(accountId)` — reads `account_billing`, returns plan/balance/flags
- `requestSongUnlock({ songIds })` — validates balance, calls `unlock_songs_for_account` RPC, triggers processing
- `createCheckoutSession({ offer })` — bridge to billing service
- `createPortalSession()` — bridge to billing service

### New env vars
- `BILLING_ENABLED` — feature flag (default: false)
- `BILLING_SERVICE_URL` — e.g. `https://billing.hearted.music`
- `BILLING_SHARED_SECRET` — HMAC key for app-to-service auth

### Billing-disabled mode
- all songs processed freely (current behavior)
- no paywall, no balance display
- self-hosted / dev environments work without billing
- `account_billing` rows still exist; billing-disabled mode is controlled explicitly by deployment config, not by row absence
- SQL entitlement/read-model helpers must receive an explicit billing-enabled input, preferably as a boolean function/RPC parameter such as `p_billing_enabled`

### Billing state read model

```ts
type BillingPlan = "free" | "quarterly" | "yearly";

interface BillingState {
  plan: BillingPlan;
  creditBalance: number;
  subscriptionStatus: "none" | "active" | "ending" | "past_due";
  cancelAtPeriodEnd: boolean;
  hasUnlimitedAccess: boolean;
  queueBand: QueueBand;
}
```

Read-model mapping:

- Stripe `active` + `cancel_at_period_end = false` → `active`
- Stripe `active` + `cancel_at_period_end = true` → `ending`
- Stripe `past_due` or `unpaid` → `past_due`
- everything else → `none`

Entitlement rule for v1:

- only `subscription_status = 'active'` grants unlimited access
- `past_due` and `unpaid` do **not** grant unlimited access
- when a subscription becomes `past_due` or `unpaid`, the account keeps access only to songs already unlocked for that account

Explicit product decision for v1:

- `creditBalance` is preserved while unlimited is active
- credits are **not** converted into subscription time
- UI should explain that unused songs-to-explore remain available if unlimited later ends
- in billing-enabled mode, `creditBalance` means purchased/manual-use balance only

### Queue priority mapping
- `free` (no purchased balance) → `low`
- any non-unlimited account with positive purchased balance → `standard`
- `quarterly` → `standard`
- `yearly` → `priority`
- relevant billing changes should also reprioritize existing **pending** library-processing jobs, not only newly ensured jobs
- v1 does this through `reprioritize_pending_jobs_for_account(account_id)` which resolves the current band from billing state and updates all pending jobs
- the bridge ingress handler in `v1_hearted/` should call this after processing any billing-driven trigger that could change the queue band

Implementation boundary:

- billing domain derives the queue band from billing facts / entitlement state
- `src/lib/workflows/library-processing/queue-priority.ts` remains the scheduler-facing adapter only

### UI surfaces
- sidebar: plan label + balance display
- song selection UI: drag-to-select list from full liked songs library, most-recent ordered (see hearted-design skill for interaction pattern)
- paywall: "Out of explorations. Explore more songs." with pricing — shown at onboarding upgrade step and in-app when purchased balance hits 0
- settings/billing: plan info + manage subscription + buy packs
- onboarding: song-showcase + match-showcase + plan-selection flow
- liked songs page: explicit locked / exploring / analyzed states instead of collapsing everything without `item_status` into pending

### Billing row creation
- Better Auth `databaseHooks.user.create.after` ensures billing row exists in every deployment
- fallback: `getBillingState` creates row if missing (self-healing on read)
- idempotent: `INSERT ... ON CONFLICT DO NOTHING`
- fallback creation must not also grant purchased balance
- missing row in steady state is a bug to repair, not a valid billing-disabled signal

### Preprod bootstrap
- add idempotent setup for local/staging accounts that need `account_billing` rows
- if seeded/test accounts need purchased balance, grant it explicitly as test data rather than implying launch behavior
- if seeded/test accounts need free onboarding access, seed unlock rows explicitly rather than implying a persistent signup balance
- prefer reset/reseed scripts over historical backfill logic

### Quarterly unlimited COGS sanity check

`v1_hearted_brand/brand/pricing-strategy.md` still models the older monthly tier. Quarterly unlimited needs its own explicit sanity check before launch.

Using the current pricing-strategy assumptions:

- fresh analysis COGS ≈ `$0.0025 / song`
- 30% cache rate
- 5,000 liked songs → ~3,500 fresh analyses
- first-burst quarterly COGS ≈ `$8.75`

Implication:

- a `$12` quarterly tier leaves only about `$3.25` contribution on a worst-case first burst
- a `$15` quarterly tier leaves about `$6.25`

That is materially tighter than the yearly tier, so quarterly pricing should be treated as an economic decision, not just a copy decision.

---

## Stripe Product Catalog

### Product 1: Song Pack
- **Name:** 500 Songs + 25 Instant Unlocks
- **Type:** one-time
- **Price:** $5.99
- **Checkout mode:** `payment`
- **Metadata:** `{ account_id }`

### Product 2: 3-Month Unlimited
- **Name:** 3-Month Unlimited
- **Type:** recurring (every 3 months)
- **Price:** $14.99/quarter (~$5/mo; feature-flagged off by default)
- **Checkout mode:** `subscription`
- **subscription_data.metadata:** `{ account_id }`

### Product 3: Yearly Unlimited
- **Name:** Yearly Unlimited (Backstage Pass)
- **Type:** recurring (yearly)
- **Price:** $39.99/yr
- **Checkout mode:** `subscription`
- **subscription_data.metadata:** `{ account_id }`

---

## Key Flows

### Flow 1 — New user onboarding

```
signup
  → account created
  → account_billing row created (plan=free, credit_balance=0)

onboarding
  → install extension
  → sync library
  → pick target playlists
  → guided song-showcase uses the pre-seeded demo song + dedicated onboarding matching path
  → user sees song-showcase, then match-showcase, then plan-selection

if user stays free:
  → insert_song_unlocks_without_charge(up to 15 recent liked songs, source='free_auto')
  → applyLibraryProcessingChange(BillingChanges.songsUnlocked(...))
  → enrichment jobs enqueued; shared stages + account activation run as eligible
  → results appear as processing completes

if user has fewer than 15 liked songs at onboarding completion:
  → only currently liked songs are unlocked
  → no residual free allocation carries forward in v1

if user buys a pack:
  → checkout flow → canonical pack fulfilled
  → credit_balance += 500
  → up to 25 most-recent currently liked songs that are not already unlocked are auto-unlocked with source='pack' without spending purchased balance
  → BillingChanges.songsUnlocked(...) emitted for the bonus auto-unlocks
  → user manually selects additional songs from purchased balance

if user upgrades to unlimited:
  → checkout flow → subscription activated
  → full library processing begins through active unlimited entitlement
  → credit_balance preserved (unused while unlimited)
```

### Flow 2 — Pack purchase

```
user runs out of songs to explore
  → paywall: "Explore more songs"
  → user clicks "500 Songs + 25 Instant Unlocks — $5.99"
  → server function calls billing service
  → billing service creates Stripe Checkout (mode=payment)
  → user completes payment on Stripe

webhook: checkout.session.completed (mode=payment)
  → billing service verifies signature
  → checks billing_webhook_event for idempotency
  → calls fulfill_pack_purchase(account_id, 500, 25, offer_id, event_id)
  → credit_balance += 500
  → up to 25 most-recent currently liked songs that are not already unlocked are auto-unlocked with source='pack'
  → billing service reports bonus_unlocked_song_ids to a narrow authenticated bridge in v1_hearted
  → v1_hearted emits BillingChanges.songsUnlocked(...)

user returns to app
  → sees updated balance and any bonus auto-unlocked songs
  → selects additional songs to explore
  → requestSongUnlock({ songIds })
  → unlock_songs_for_account(songIds, source='pack')
  → applyLibraryProcessingChange(BillingChanges.songsUnlocked(...))
  → enrichment jobs enqueued; entitled shared stages + account activation run as eligible
  → results appear as processing completes
```

### Flow 3 — Unlimited subscription

```
user clicks "3-Month Unlimited" or "Yearly Unlimited"
  → server function calls billing service
  → billing service creates Stripe Checkout (mode=subscription)
  → user completes payment on Stripe

webhook: checkout.session.completed (mode=subscription)
  → billing service stores customer/subscription refs
  → does NOT activate yet

webhook: invoice.paid (billing_reason=subscription_create)
  → billing service verifies event
  → calls activate_subscription(account_id, plan, ...)
  → plan set to 'quarterly' or 'yearly'
  → billing service calls bridge endpoint in v1_hearted with stripe_event_id, account_id, stripe_subscription_id, subscription_period_end
  → v1_hearted claims event in billing_bridge_event (duplicate → no-op)
  → v1_hearted inserts billing_activation marker
  → v1_hearted emits BillingChanges.unlimitedActivated(account_id)
  → full library processing triggered through control-plane scheduling
  → songs get unlock rows with source='unlimited' when they reach account-visible analysis during active unlimited access
```

### Flow 4 — Subscription renewal

```
webhook: invoice.paid (billing_reason=subscription_cycle)
  → billing service verifies event
  → confirms subscription still active
  → calls update_subscription_state(account_id, ...)
  → no other action needed (user already has unlimited access)
```

### Flow 5 — Subscription cancellation

```
user opens Customer Portal → cancels
  → Stripe sets cancel_at_period_end = true

webhook: customer.subscription.updated
  → billing service calls update_subscription_state(account_id, ...)
  → user keeps access through period end

when period ends:
webhook: customer.subscription.deleted
  → billing service calls deactivate_subscription(account_id)
  → plan reverts to 'free'
  → credit_balance preserved
  → previously unlocked songs stay unlocked (account_song_unlock rows persist)
  → new songs require credits

if unlimited access ends while jobs are already running:
  → already-claimed jobs may finish shared/background stages
  → no new unlimited-authorized full-processing jobs are scheduled after deactivation
  → when a song reaches account activation, the app re-checks whether the account is still entitled at that moment
  → if entitlement was lost before activation, the song does not become visible, does not get an unlimited unlock row, and does not expose analysis or matches
  → only songs whose account-visible activation completed before the cutoff keep their unlock rows

if user reverses cancellation before period end:
webhook: customer.subscription.updated
  → billing service calls update_subscription_state(account_id, ...)
  → access continues without interruption
```

### Flow 6 — Finite user selects songs (post-onboarding)

```
user navigates to liked songs list
  → sees songs with Phase A data (audio features, genres)
  → songs without analysis show "locked" / "explore" state
  → user selects songs to explore
  → confirms: "Explore 12 songs? (12 songs to explore remaining)"

requestSongUnlock({ songIds })
  → calls unlock_songs_for_account(songIds, source='pack')
  → dedupes already-unlocked songs without double-charging
  → if insufficient balance: return error, show paywall
  → if sufficient: deduct, insert unlock rows, write ledger entries
  → applyLibraryProcessingChange(BillingChanges.songsUnlocked(...))
  → trigger enrichment work for those songs; entitled shared stages + account activation run as eligible
  → results appear as they complete
```

---

## Edge Cases & Risks

### 1. Onboarding match showcase takes too long to process
The demo song analysis is pre-seeded, but the onboarding match showcase can still take time.

Mitigation:
- show progress UI (existing polling pattern)
- use high priority for the onboarding matching path
- if the match showcase is still pending, continue to the match screen with a processing state instead of blocking monetization
- because the demo song is outside monetization, this path never issues unlock rows or replacement credits

### 2. Matching sparsity for small unlocked libraries
15 free songs or a small early pack selection may produce thin suggestions.

Mitigation:
- acceptable for v1; demonstrates value even with sparse results
- upgrade prompt naturally follows: "want matches for your whole library?"

### 3. Unlimited user cancels after processing large library
All processed songs stay unlocked via `account_song_unlock` rows.
Only newly synced songs after cancellation require credits.

This is the intended behavior — fair to the user.

Normal subscription end/cancellation is **not** a revocation path; revocation is reserved for refund, chargeback, or admin intervention.

If a paid subscription period is refunded or successfully disputed, songs that became account-visible from that refunded subscription period are revoked and return to locked state.

### 4. User returns from checkout before webhook fulfills
Balance may not be updated yet.

Mitigation:
- checkout success page polls billing state
- stop active polling after a short window (e.g. ~30–60s)
- fall back to a durable message: "Your purchase is being processed. Your songs to explore will appear shortly."
- show "processing your purchase" until balance updates
- Stripe webhook retry (up to 3 days) handles delivery failures

### 5. Concurrent unlock requests for same song
`UNIQUE(account_id, song_id)` on `account_song_unlock` prevents double-unlock.
RPC should handle conflict gracefully (no double deduction).

### 6. Internal reprocessing after model/prompt changes
If you re-run analyses for quality improvement, users should NOT be re-charged.
`account_song_unlock` persists regardless of reprocessing.
Pipeline re-creates `song_analysis` rows; unlock status is separate.

### 7. Unlimited user buys a pack
Credits sit unused while unlimited is active.
If subscription ends, credits become available.
Not worth preventing in v1.

### 8. Webhook double delivery
`billing_webhook_event` table with stripe_event_id primary key.
Insert with status='processing' before fulfillment.
If row already exists with `processed`, skip. If it exists with `failed`, allow safe retry.

The same rule applies to the billing-service → app bridge: `v1_hearted/` claims each bridge call in `billing_bridge_event` before emitting control-plane changes; duplicate deliveries for the same `stripe_event_id` are no-ops.

### 9. Refund / chargeback reversal
Refunds / disputes are not part of the normal self-serve product flow, but v1 still needs deterministic handling.

Mitigation:
- song packs are sold as final / non-refundable in normal self-serve policy, but Stripe refunds/disputes can still happen operationally
- for confirmed pack refunds/chargebacks, reverse the full pack entitlement in this order:
  1. subtract remaining unused purchased balance
  2. if needed, revoke newest active `source='pack'` unlocks until the refunded entitlement is fully reversed
- for the canonical pack offer, a full refund reverses the whole 525-song entitlement footprint (500 purchased balance + 25 pack-funded bonus unlocks)
- do **not** revoke `free_auto` or `unlimited` unlocks through pack refund logic
- do revoke pack-funded bonus unlocks because they are part of the pack entitlement
- if a paid unlimited subscription period is refunded or successfully disputed, songs that became account-visible from that refunded subscription period are revoked and return to locked state
- unlimited-period revocation must use `(granted_stripe_subscription_id, granted_subscription_period_end)` stored on `account_song_unlock` as the reversal key, rather than relying on row creation time or `granted_stripe_event_id`
- revoked songs return to locked state unless repurchased later or re-unlocked through a later active entitlement
- ambiguous cases still create an admin/support task

### 10. Free signup abuse (multiple accounts)
Better Auth uses Google OAuth. Multiple Google accounts = multiple free allocations.
Acceptable risk for v1. Monitor signup rate.

### 11. Phase A runs for all songs — cost concern
Audio features (ReccoBeats) and genre tagging (Last.fm) are free APIs.
No billing concern. Only LLM + embedding have meaningful cost.

### 12. Selector ordering for free auto-allocation
Most recent liked songs selected first.
Could be refined later (e.g., prioritize songs in target playlists).
Acceptable for v1.

### 13. Preprod data can hide launch assumptions
Because current accounts are preprod/staging accounts, it is easy to accidentally design around seeded data instead of clean first-user behavior.

Mitigation:
- validate flows from a fresh empty account
- also validate with a reseeded account that has sync data but no billing history

### 14. Unlimited activation can silently process nothing if selectors only read unlock rows
This is the biggest architectural trap in the original draft.

Mitigation:
- selectors must authorize Phase B/C through `unlock row OR active unlimited`
- do not model unlimited purely as a background unlock-writer

### 15. Partial overlap or invalid unlock requests
Users can submit a selection that mixes already-unlocked songs and locked songs, or send malformed/stale payloads.

Mitigation:
- dedupe input in the RPC
- charge only for net-new unlocks
- keep the operation all-or-nothing for the net-new subset
- malformed UUIDs, non-owned songs, or songs that are no longer currently liked should fail the whole request
- duplicate song IDs should be deduped silently
- already-unlocked songs should be returned separately without double-charging

### 16. New songs synced while unlimited is active
If the user keeps syncing during an active unlimited period, those songs should continue to process without manual selection.

Mitigation:
- entitlement selector reads current billing state, not only historical unlock rows

### 17. Failed payment / past_due state
`invoice.paid` is not the only lifecycle event that matters.

Mitigation:
- treat `past_due` and `unpaid` as not entitled for unlimited access
- keep access only to songs already unlocked for that account while that state is active
- stop scheduling new unlimited-authorized work while that state is active
- update lifecycle fields through `update_subscription_state(...)` so app/UI reads stay canonical
- expose that state in `BillingState` so UI copy is accurate

### 18. Target-playlist song enrichment must stay outside billing
Current match refresh can enrich target-playlist songs that are not liked songs.

Mitigation:
- keep target-playlist profiling/lightweight enrichment ungated
- only gate liked-song full enrichment + matching candidate eligibility

### 19. Replayable server-to-server billing requests
Simple shared-secret HMAC without freshness checks can be replayed.

Mitigation:
- apply the same replay-protected HMAC pattern to both app-to-billing and billing-service-to-app bridge calls
- signed timestamp header
- narrow replay window
- reject stale requests

### 20. Current public/legal copy is already inconsistent with this plan
This repo already contains stale monetization copy in shipped JSON docs.

Mitigation:
- update public legal/FAQ copy before launch, not after

### 21. Un-cancel before period end
Stripe can send `customer.subscription.updated` when a user reverses cancellation.

Mitigation:
- handle `cancel_at_period_end = false`
- clear cancellation-pending UI state immediately

### 22. Plan switching is intentionally unsupported in v1
With Customer Portal switching disabled, quarterly → yearly is not seamless.

Mitigation:
- document this as an accepted limitation
- revisit only if it becomes a material support burden

### 23. Locked songs can be misclassified as pending in current read models
Current SQL read models treat missing `item_status` as pending processing.

Mitigation:
- add billing-aware liked-song read-model state
- distinguish locked from pending from analyzed

### 24. Webhook winner detection must be explicit
`INSERT ... ON CONFLICT DO NOTHING` alone is not enough to know whether this worker should process the event.

Mitigation:
- use an insert pattern that tells the worker whether it won ownership of the event row before fulfillment proceeds

### 25. Terminal processing failure after unlock
Some songs may be valid unlock requests but still fail to produce a usable result.

Mitigation:
- missing lyrics alone is **not** a failure path; instrumental / lyric-light songs use the instrumental analysis path when possible
- if a purchased song reaches a terminal failure and cannot produce account-visible analysis, the user should not lose purchased balance net-net
- if analysis exists but a later embedding/matching step fails, the user has still received the core paid value; handle the downstream failure separately without clawing back access
- v1 policy: preserve unlock history, mark the song as failed/unavailable where appropriate, and issue a `replacement_grant` only when account-visible analysis could not be produced

---

## Delivery Phases

### Phase 0 — decisions + setup
- ~~finalize free tier size~~ → 15 songs
- ~~finalize 3-month unlimited price~~ → $14.99/quarter, feature-flagged
- create Stripe test-mode products (pack $5.99, quarterly $14.99, yearly $39.99)
- ensure Coolify + domain setup for billing service
- canonicalize brand docs (retire old pricing/credit references)
- freeze canonical public domain as `hearted.music` (`liked.music` may redirect/alias but is not the primary brand domain)
- add `BILLING_OFFER_QUARTERLY_ENABLED` env var (default: false)

### Phase 1 — billing foundation (`v1_hearted/`)
- introduce `src/lib/domains/billing/*` boundary
- billing schema migration (account_billing, account_song_unlock, credit_transaction, billing_webhook_event, billing_activation, billing_bridge_event)
- RLS enable + deny-all policies for all new billing tables
- billing RPCs (`unlock_songs_for_account`, `insert_song_unlocks_without_charge`, `activate_unlimited_songs`, `grant_credits`, `fulfill_pack_purchase`, `activate_subscription`, `update_subscription_state`, `deactivate_subscription`, `reverse_pack_entitlement`, `reverse_unlimited_period_entitlement`, `reprioritize_pending_jobs_for_account`)
- billing row creation on account creation in every deployment + preprod bootstrap path
- reset/reseed path for local and staging accounts
- billing state read model + feature flag
- song_analysis measurement columns

### Phase 2 — pipeline gating (`v1_hearted/`)
- add `BillingChanges.*` helpers and extend `LibraryProcessingChange`
- split enrichment: Phase A unbounded, Phase B/C gated by effective entitlement
- keep one enrichment workflow/job type with conditional per-song stages plus explicit account activation
- new selector contract: stage-level work-plan flags (`needs_audio_features`, `needs_genre_tagging`, `needs_analysis`, `needs_embedding`, `needs_content_activation`)
- match snapshot refresh: filter candidates to entitled songs
- liked-song read-model changes for locked vs pending semantics
- queue priority from billing state (resolveQueuePriority)
- reprioritize pending jobs on billing state changes via `reprioritize_pending_jobs_for_account`
- billing-disabled mode: all songs processed freely through an explicit deployment bypass, passed into billing-aware SQL as an explicit input such as `p_billing_enabled`, not inferred from row absence

### Phase 3 — billing service + app bridge
- scaffold Bun HTTP server + Hono routing (`v1_hearted_brand/`)
- HMAC auth middleware with replay protection
- health endpoint
- checkout session endpoints (pack + unlimited)
- customer portal session endpoint
- Stripe webhook endpoint with signature verification
- fulfillment handlers (`fulfill_pack_purchase`, `activate_subscription`, `update_subscription_state`, `deactivate_subscription`)
- explicit `past_due` / refund / dispute handling, including pack-entitlement reversal
- Stripe customer reuse policy
- webhook ownership race handling
- idempotency via billing_webhook_event
- Dockerfile + Coolify deploy config
- billing bridge ingress endpoint in `v1_hearted/` (receives pack fulfillment, unlimited activation, revocation outcomes from billing service)
- `billing_bridge_event`-based idempotency for all bridge calls
- server function bridges in `v1_hearted/` (createCheckoutSession, createPortalSession)

### Phase 4 — onboarding flow (`v1_hearted/`)
- song-showcase + match-showcase + plan-selection steps
- dedicated onboarding matching path for the showcase flow
- free auto-allocation on onboarding completion (if user stays free)
- pack fulfillment branch: 500 purchased credits + 25 pack-funded auto-unlocks
- onboarding state-machine expansion: add `song-showcase`, `match-showcase`, `plan-selection` to `ONBOARDING_STEPS` enum; update route loader, step persistence, and new step components
- update `ReadyStep` copy to reflect billing-aware behavior (free/pack/unlimited variants)
- explicit queue-priority override to `priority` only where the onboarding showcase flow still needs it
- post-checkout polling/success state for onboarding plan-selection

### Phase 5 — public UI (`v1_hearted/`)
- balance display in sidebar/shell
- song selection UI for pack users
- paywall / upgrade CTA
- settings/billing page
- manage subscription (portal launch)

### Phase 6 — hardening + launch
- end-to-end Stripe test mode validation
- webhook idempotency verification
- fresh-account bootstrap validation
- unlock RPC race-condition validation
- failed payment / refund runbook
- cost measurement instrumentation
- launch validation checklist
