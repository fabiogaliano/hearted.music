# Monetization Decisions & Invariants

> **Purpose:** Locked constraints for parallel implementation. Every rule below is derived from `docs/MONETIZATION_V2_PLAN.md`, `docs/monetization/TERMINOLOGY.md`, and `docs/monetization/CURRENT_STATE_AUDIT.md`. These are not suggestions — they are invariants that story authors must not reinterpret.
>
> **Scope:** This document captures *what is decided*. It does not repeat implementation detail (schema DDL, RPC signatures, UI component trees). Refer to the V2 plan for those.

---

## 1. Product Invariants

### Free tier

| Rule | Detail |
|---|---|
| Allocation size | 15 songs, one-time |
| Selection policy | Auto-select up to 15 most-recent liked songs at onboarding completion |
| Unused allocation | Forfeited in v1 if the user has fewer than 15 liked songs; no carryforward |
| Source | `free_auto` — never deducts purchased balance |
| Durability | Unlocks persist forever; normal subscription changes never revoke `free_auto` unlocks |

### Song packs

| Rule | Detail |
|---|---|
| Canonical offer | `song_pack_500`: 500 purchased songs + up to 25 pack bonus unlocks, $5.99 |
| Purchased balance | 500 credits into `credit_balance` via a `pack_credit_lot` row |
| Pack bonus unlocks | Up to 25 most-recent currently liked songs not already unlocked; `source='pack'`; do not deduct purchased balance; reversed on pack refund |
| Selection model | User explicitly selects which songs to explore from purchased balance |
| Unlock durability | Unlocks persist forever unless revoked by refund/chargeback |
| Unavailable while unlimited active | Pack purchase entry points are hidden/disabled when the account has active unlimited access |

### Unlimited plans

| Rule | Detail |
|---|---|
| Quarterly | `unlimited_quarterly`, $14.99/quarter; hidden behind `QUARTERLY_PLAN_ENABLED` flag (default: false) |
| Yearly (Backstage Pass) | `unlimited_yearly`, $39.99/yr; includes priority queue |
| Access model | Full-library auto-processing; no manual song selection needed |
| Unlock persistence | Unlock rows (`source='unlimited'`) are written when songs reach account-visible analysis during active access — access survives cancellation for those songs |
| Normal cancellation | Access through paid period end; previously unlocked songs stay unlocked; no revocation |
| Refund/chargeback | Songs unlocked during the refunded period are revoked; reversal key is `(granted_stripe_subscription_id, granted_subscription_period_end)` |

### Pack-to-unlimited conversion / discount

| Rule | Detail |
|---|---|
| Trigger | User upgrades from pack usage to unlimited |
| Mechanism | Unused purchased pack value (from `pack_credit_lot` rows, not `credit_balance` alone) becomes a one-time proportional discount on the initial unlimited invoice |
| Lifecycle | `pending` → `applied` (on `invoice.paid`) or `released` (on checkout expiry/abandonment) or `reversed` (on initial invoice refund/dispute) |
| At most one pending | One `pending` conversion per account at a time |
| Existing pack unlocks | `source='pack'` unlocks are permanent; never reclassified as unlimited |
| Normal subscription end | Does not restore converted pack value |
| Refund of initial invoice | Restores the converted purchased pack value |

### Queue bands

| Account state | Band |
|---|---|
| Free, no purchased balance | `low` |
| Any non-unlimited account with positive purchased balance | `standard` |
| Quarterly unlimited | `standard` |
| Yearly unlimited | `priority` |
| `self_hosted` unlimited | `priority` |

---

## 2. Architecture Invariants

### Repo boundary

| Responsibility | Owner |
|---|---|
| Billing state reads, unlock enforcement, credit deduction, free allocation, pipeline gating, queue priority, control-plane integration, app-to-billing bridge, billing-aware read models | `v1_hearted/` |
| Stripe SDK, checkout/portal sessions, webhook handling, fulfillment writes, offer catalog, HMAC auth, anti-abuse | `v1_hearted_brand/` |

The billing service (`v1_hearted_brand/`) never imports or runs `applyLibraryProcessingChange(...)`. Control-plane reactions happen exclusively in `v1_hearted/`.

### Internal offer IDs only outside billing service

The public app sends stable offer IDs (`song_pack_500`, `unlimited_quarterly`, `unlimited_yearly`). Only `v1_hearted_brand/` resolves Stripe price IDs. Stripe-specific identifiers are opaque audit columns in shared schema.

### Effective entitlement predicate

A song is entitled for an account when **either**:
- an `account_song_unlock` row exists with `revoked_at IS NULL`, **or**
- the account has active unlimited access (`unlimited_access_source IS NOT NULL` with valid lifecycle state)

This is the single canonical predicate. It must be used in:
- enrichment selectors (Phase B/C gating)
- content activation
- liked-song read models
- match/session read models
- dashboard stats

`past_due` and `unpaid` subscription statuses do **not** grant unlimited access for `subscription`-sourced accounts.

### Control-plane responsibility

- The control plane (`library-processing`) stays pricing-neutral
- Billing-driven work enters via typed `LibraryProcessingChange` variants: `songs_unlocked`, `unlimited_activated`, `candidate_access_revoked`
- The control plane never learns *why* access changed, only *that* it changed
- If `library-processing` code references refunds, chargebacks, or Stripe IDs, the boundary has been crossed

### Bridge pattern

All billing-service → app triggers use one bridge pattern:
- HMAC + timestamp + body-hash + replay-window authentication
- `billing_bridge_event` table for app-side idempotency (keyed on `stripe_event_id`)
- Duplicate deliveries are no-ops: `INSERT ... ON CONFLICT DO NOTHING`, check whether insert succeeded before proceeding

### Checkout idempotency

- Public app generates one `checkout_attempt_id` (UUID) per specific checkout intent / offer choice
- Reused across retries of same intent; new UUID if offer changes
- Billing service forwards it as Stripe `idempotency_key` on `checkout.sessions.create(...)`
- `checkout_attempt_id` must be part of the signed request body

---

## 3. Data Model Invariants

### Billing source of truth

- `account_billing` is the single source of billing facts per account
- Every account gets an `account_billing` row in every deployment; missing row is an invariant violation, not a valid mode signal
- `credit_balance` = aggregate (spendable + reserved); spendable = `credit_balance` minus credits reserved by pending conversions
- Upgrade discount eligibility is derived from `pack_credit_lot` rows, never inferred from `credit_balance` alone

### Unlock durability

- `account_song_unlock` rows persist independently of liked-state; if a song is unliked then re-liked, the prior active unlock applies without spending additional balance
- `UNIQUE(account_id, song_id)` prevents double-unlock / double-charge
- If a previously revoked song is unlocked again, v1 reuses the existing row (clear revocation fields, update `source`)
- `source` values: `free_auto | pack | unlimited | self_hosted | admin`

### Self-hosted / provider-disabled access

- When `BILLING_ENABLED=false`, account provisioning grants explicit `self_hosted` unlimited access via `unlimited_access_source = 'self_hosted'`
- SQL never infers deployment mode from missing rows or absent billing state
- `self_hosted` is orthogonal to `plan`; those accounts may keep `plan='free'` and `credit_balance=0`
- One canonical entitlement predicate handles all modes; no deployment-mode bypass through RPCs

### Ledger immutability

- `credit_transaction` is append-only; every balance mutation writes a ledger row with `balance_after`
- `pack_credit_lot` tracks per-lot purchased value; operational/admin grants must not create lot rows (prevents accidental upgrade-conversion eligibility)

### Locking discipline

- All balance-mutating RPCs lock `account_billing` with `SELECT ... FOR UPDATE` before reading `credit_balance`
- Conversion RPCs also lock participating `pack_credit_lot` / `subscription_credit_conversion` rows

---

## 4. Read-Model Invariants

### Locked vs pending semantics

| State | Meaning |
|---|---|
| `locked` | Not entitled, regardless of shared cache state |
| `pending` | Entitled, queued for processing, not yet started |
| `analyzing` | Entitled, processing in progress |
| `analyzed` | Entitled, content visible |
| `failed` | Entitled, terminal processing failure |

- Missing `item_status` for a non-entitled song means `locked`, not `pending`
- `item_status` is written only by the content-activation step, never by generic pipeline-completion
- Matching status (`has_suggestions | acted | no_suggestions`) is a sub-dimension of `analyzed` songs only

### Shared artifacts do not imply entitlement

- `song_analysis` rows are global (not account-scoped); existence does not mean the account may see that analysis
- Read models must filter by effective entitlement, not by `song_analysis` or `item_status` existence
- Dashboard stats (`analyzedPercent`, etc.) must be billing-aware
- `match_result` is account-scoped via `match_snapshot.account_id` but still requires entitlement filtering (stale results can reference revoked songs)

### Read-time entitlement filtering

- Match result and suggestion loaders filter by current entitlement at read time, not only by snapshot contents
- Revoked songs disappear immediately from matching UI without waiting for the next snapshot refresh
- Match snapshots are append-only; revocations do not delete old snapshots — latest supersedes, read-time filtering handles the gap

---

## 5. Workflow Invariants

### One enrichment workflow in v1

- One `enrichment` job type; one enrichment slice in `library_processing_state`
- No second durable workflow for Phase A vs Phase B/C
- The orchestrator uses per-song stage flags (`needs_audio_features`, `needs_genre_tagging`, `needs_analysis`, `needs_embedding`, `needs_content_activation`) and runs each stage against the exact sub-batch that needs it

### Pipeline split

| Phase | Stages | Gating |
|---|---|---|
| A | audio_features, genre_tagging | Unbounded — runs for all liked songs, no billing gate |
| B | song_analysis (LLM) | Gated by effective entitlement |
| C | song_embedding | Gated by effective entitlement |
| Activation | content_activation | Account-scoped; writes `item_status` + unlimited unlock rows |

- The value boundary is Phase B (LLM analysis)
- For pack users, purchased balance is deducted at successful unlock request time, not when the worker starts Phase B
- Both LLM paths (lyrical and instrumental) cost 1 credit; Phase A-only work costs 0 credits

### Content activation

- Runs after shared stages, driven by current DB truth (not "which songs ran B/C in this chunk")
- Writes `item_status` only for entitled songs with `song_analysis`
- Persists unlimited unlock rows (`source='unlimited'` or `source='self_hosted'`) for songs that became account-visible but lack durable unlock rows
- Does not wait for embedding; analysis is the user-visible value

### Unlimited users

- Active unlimited authorizes full processing dynamically — no pre-materialization of unlock rows for the whole library
- Selectors authorize Phase B/C through `unlock row OR active unlimited`, not only unlock rows
- Unlock rows are written at content activation time for post-cancellation durability

### Reprioritization

- Every billing mutation that can change the resolved queue band invokes `reprioritize_pending_jobs_for_account(account_id)` as its final step
- Bridge ingress handles control-plane reactions (`BillingChanges.*`), but pending-job reprioritization must not depend solely on bridge delivery
- App-layer `self_hosted` provisioning calls the reprioritization RPC immediately after the billing write

---

## 6. Terminology Invariants (Frozen)

These terms are frozen in schema, RPCs, and shared TS types. Changing them requires migration.

| Domain | Frozen values |
|---|---|
| Plans | `free`, `quarterly`, `yearly` |
| Offer IDs | `song_pack_500`, `unlimited_quarterly`, `unlimited_yearly` |
| Unlock sources | `free_auto`, `pack`, `unlimited`, `self_hosted`, `admin` |
| Revocation reasons | `refund`, `chargeback`, `admin` |
| Queue bands | `low`, `standard`, `priority` |
| Song display state | `locked`, `pending`, `analyzing`, `analyzed`, `failed` (type: `SongDisplayState`) |
| Unlimited access source | `subscription`, `self_hosted` (NULL = none) |
| Control-plane changes | `songs_unlocked`, `unlimited_activated`, `candidate_access_revoked` |
| Bridge event kinds | `pack_fulfilled`, `unlimited_activated`, `pack_reversed`, `unlimited_period_reversed`, `subscription_deactivated` |
| Credit transaction reasons | `song_unlock`, `pack_purchase`, `credit_conversion`, `credit_conversion_reversal`, `replacement_grant`, `refund`, `chargeback_reversal`, `admin_adjustment` |
| Conversion statuses | `pending`, `applied`, `released`, `reversed` |
| Env flags | `BILLING_ENABLED`, `BILLING_SERVICE_URL`, `BILLING_SHARED_SECRET`, `QUARTERLY_PLAN_ENABLED` |
| TS types | `BillingState`, `UnlimitedAccess`, `BillingPlan`, `QueueBand`, `SongDisplayState` |
| Selector flags | `needs_audio_features`, `needs_genre_tagging`, `needs_analysis`, `needs_embedding`, `needs_content_activation` |

See `docs/monetization/TERMINOLOGY.md` §5 for the full frozen vs soft classification.

---

## 7. Non-Goals / Out-of-Scope for v1

| Decision | Rationale |
|---|---|
| Plan switching (quarterly ↔ yearly) | Customer Portal switching disabled; user re-subscribes after active term ends |
| Grandfathering / production migration | Preprod only; accounts can be reset or reseeded |
| Partial unlock fulfillment | All-or-nothing for net-new unlocks per request |
| Free allocation carryforward | Unused free slots are forfeited, not banked |
| Pack purchase while unlimited active | Entry points hidden/disabled |
| Second durable workflow for Phase A vs B/C | One enrichment workflow with per-song stage flags |
| Pre-materialized unlimited unlock rows | Dynamic entitlement + activation-time persistence |
| `past_due` unlimited access | Not entitled; access limited to already-unlocked songs |
| Target-playlist enrichment gating | Target-playlist profiling stays ungated; only liked-song full enrichment is gated |
| Free signup abuse prevention | Acceptable risk for v1; monitor signup rate |
| Embedding required for content visibility | Analysis alone is the visibility threshold; embedding failure is handled separately |

---

## 8. Open Questions

These are genuinely unresolved by the source documents:

| Question | Context | Resolution |
|---|---|---|
| Quarterly COGS viability | V2 plan flags tight margin (~$3.25–$6.25 contribution on worst-case first burst at $14.99). The flag defaults to off, but no explicit go/no-go threshold is stated. | **Leave as-is.** Flag defaults off. Evaluate margins before enabling. No implementation change needed. |
| Match showcase timeout UX | Demo song analysis is pre-seeded, but the onboarding matching path can still be slow. | **Resolved.** Trigger playlist profiling as soon as user saves target playlists (during `flag-playlists` step). Run live match against real playlists with `priority` queue band using the pre-seeded demo song. If live matching hasn't resolved within ~10–15s, fall back to a canned/pre-built demo match result. |
| Replacement grant policy details | v1 policy says issue `replacement_grant` when account-visible analysis cannot be produced, but the exact trigger conditions (which failure modes qualify) and whether it requires manual review are not fully specified. | **Resolved.** Auto-grant 1 replacement credit when the LLM analysis path (lyrical or instrumental) reaches terminal failure and no account-visible analysis can be produced. Phase A failures (audio features, genre tagging) do not trigger a replacement grant — those stages are free and no credit was consumed for them. No manual review required. Charge happens at unlock request time; grant-back on LLM failure keeps balance as committed truth. |
| Legal/FAQ copy update scope | Edge case #20 notes public copy will be inconsistent. No specific list of pages or content blocks to update. | **Resolved.** All three legal JSON files (`public/legal/faq.json`, `public/legal/terms.json`, `public/legal/privacy.json`) have been updated to align with V2 plan terminology and monetization mechanics. |
