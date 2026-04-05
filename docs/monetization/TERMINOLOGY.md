# Monetization Terminology

> Canonical naming reference for all monetization work in `v1_hearted/` and `v1_hearted_brand/`. All implementation code, SQL schema, RPCs, TypeScript types, UI copy, and documentation should use these terms consistently.

---

## 1. Naming Principles

### User-facing copy vs internal code

- User-facing copy uses warm, product-specific language: the product is about **matching songs to playlists**. "Unlock" is the user-facing action verb.
- Internal code uses precise domain language: `credit_balance`, `unlock`, `entitlement`
- These layers are intentionally different. Do not leak internal terms into UI copy or marketing terms into SQL.

### How to choose stable names

- Prefer names that describe what the system **does**, not how it's **implemented** (`unlock_songs_for_account` over `insert_unlock_rows`)
- Prefer names that are meaningful without Stripe context (`plan`, `credit_balance`, not `price_id`, `subscription_item`)
- Prefer names that read correctly as SQL column names, TS type fields, and spoken English simultaneously
- Use `snake_case` in SQL, `camelCase` in TS, same root words in both

### What naming patterns to avoid

- Avoid overloading a verb across unrelated domains (see §Disambiguation below)
- Avoid names that conflate billing facts with display state (`status` alone is too vague — prefix with the domain: `subscription_status`, `item_status`)
- Avoid boolean flags when a discriminated value set is more precise (`is_unlimited` → `unlimited_access_source`)
- Avoid names that embed pricing or quantities (`five_dollar_pack` → `song_pack_500`)
- Avoid acronyms and abbreviations in schema (`sub` → `subscription`, `txn` → `transaction` in table names; `txn` is acceptable in index prefixes like `idx_credit_txn_*`)

### Stripe isolation

- Stripe-specific identifiers (`stripe_customer_id`, `stripe_subscription_id`, `stripe_event_id`) are stored as opaque audit/foreign-key columns
- Only `v1_hearted_brand/` imports the Stripe SDK or references Stripe price IDs
- `v1_hearted/` sends **internal offer IDs** and receives **billing facts**; it never sees Stripe price objects
- Stripe enum values that leak into shared schema (e.g., `subscription_status` values like `past_due`, `incomplete_expired`) are documented as Stripe-derived but treated as opaque strings by the public app; the `BillingState` read model normalizes them into product-meaningful values

---

## 2. Canonical Terms

### Plans & Offers

| Concept | Canonical term | Frozen? | Scope |
|---|---|---|---|
| No paid plan | `free` | ✅ Yes | Both |
| 3-month recurring | `quarterly` | ✅ Yes | Both |
| Yearly recurring | `yearly` | ✅ Yes | Both |
| Yearly tier brand name | **Backstage Pass** (descriptive subtitle: "Yearly Unlimited") | ⏳ Soft (brand) | User-facing |
| SQL plan column values | `'free' \| 'quarterly' \| 'yearly'` | ✅ Yes | Internal |

### Internal Offer IDs

| Concept | Canonical term | Frozen? | Scope |
|---|---|---|---|
| Song pack offer | `song_pack_500` | ✅ Yes | Internal |
| Quarterly unlimited offer | `unlimited_quarterly` | ✅ Yes | Internal |
| Yearly unlimited offer | `unlimited_yearly` | ✅ Yes | Internal |

### User-Facing Language

| Concept | Canonical term | Frozen? | Scope |
|---|---|---|---|
| What the product does | Match songs to playlists | ⏳ Soft (copy) | User-facing |
| User-facing action verb | **Unlock** | ⏳ Soft (copy) | User-facing |
| Zero-state CTA | **Unlock more songs** | ⏳ Soft (copy) | User-facing |
| Unlimited plan description | Unlimited song matching against your library playlists | ⏳ Soft (copy) | User-facing |

### Internal Balance & Credits

| Concept | Canonical term | Frozen? | Scope |
|---|---|---|---|
| Internal balance unit word | **credit** — never user-facing | ✅ Yes | Internal |
| Balance column | `credit_balance` on `account_billing` | ✅ Yes | Internal |
| Ledger table | `credit_transaction` | ✅ Yes | Internal |
| Spendable balance (derived) | **spendable balance** — `credit_balance` minus reserved conversion amounts; computed at query time | ✅ Yes | Internal |
| Purchased-lot balance | **purchased pack value** — credits from pack purchases in `pack_credit_lot` rows; eligible for upgrade conversion | ✅ Yes | Internal |
| Non-lot balance | **operational balance** — credits from `replacement_grant` or `admin_adjustment`; never eligible for upgrade conversion | ✅ Yes | Internal |

### Unlocks / Entitlements / Access

| Concept | Canonical term | Frozen? | Scope |
|---|---|---|---|
| Per-song durable access record | **unlock** (noun); table: `account_song_unlock` | ✅ Yes | Internal |
| Action of granting per-song access | **unlock** (verb) | ✅ Yes | Both |
| Runtime access predicate | **effective entitlement** — `unlock row with revoked_at IS NULL` OR `active unlimited access` | ✅ Yes | Internal |
| Unlock provenance column | `source` — values: `free_auto \| pack \| unlimited \| self_hosted \| admin` | ✅ Yes | Internal |
| Removing access after refund/dispute | **revocation** (noun) — columns: `revoked_at`, `revoked_reason`; values: `refund \| chargeback \| admin` | ✅ Yes | Internal |

### Unlimited Access

| Concept | Canonical term | Frozen? | Scope |
|---|---|---|---|
| Non-song-specific full-library access | **unlimited access** | ✅ Yes | Both |
| Source discriminator column | `unlimited_access_source` — values: `'subscription' \| 'self_hosted'`; NULL = none | ✅ Yes | Internal |
| TS read-model type | `UnlimitedAccess` — `{ kind: 'none' } \| { kind: 'subscription' } \| { kind: 'self_hosted' }` | ✅ Yes | Internal |

### Onboarding Monetization

| Concept | Canonical term | Frozen? | Scope |
|---|---|---|---|
| Free songs granted at onboarding | **free allocation** — one-time, up to 15 songs, `source='free_auto'` | ✅ Yes | Internal |
| Pack auto-unlocks at purchase | **pack bonus unlocks** — up to 25, part of pack entitlement, reversed on refund | ✅ Yes | Internal |
| User-facing pack bonus label | **Instant Unlocks** (Stripe product name: "500 Songs + 25 Instant Unlocks") | ⏳ Soft (copy) | User-facing |
| Onboarding step IDs | `song-showcase`, `match-showcase`, `plan-selection` | ✅ Yes | Internal |

### Song Display State

| Concept | Canonical term | Frozen? | Scope |
|---|---|---|---|
| TS type name | `SongDisplayState` | ✅ Yes | Internal |
| Values | `locked \| pending \| analyzing \| analyzed \| failed` | ✅ Yes | Both |
| `locked` | Not entitled, regardless of shared cache state | ✅ Yes | Both |
| `pending` | Entitled, queued for processing, not yet started | ✅ Yes | Both |
| `analyzing` | Entitled, processing in progress | ✅ Yes | Both |
| `analyzed` | Entitled, content visible | ✅ Yes | Both |
| `failed` | Entitled, terminal processing failure (LLM analysis could not be produced) | ✅ Yes | Both |

Notes:
- Replaces `UIAnalysisStatus` (`not_analyzed \| analyzing \| analyzed \| failed`)
- `locked` is new — supersedes both analysis and matching status
- `pending` replaces `not_analyzed` for entitled songs; `not_analyzed` no longer exists
- Matching status (`has_suggestions \| acted \| no_suggestions`) remains a sub-dimension of `analyzed` songs only

### Billing Action Verbs

| Verb | Canonical meaning | Used in |
|---|---|---|
| **unlock** | Grant per-song access (write `account_song_unlock` row) | `unlock_songs_for_account`, `requestSongUnlock`, `songs_unlocked` |
| **grant** | Add operational/replacement credits to balance | `grant_credits` |
| **fulfill** | Complete a pack purchase end-to-end | `fulfill_pack_purchase` |
| **activate** | Turn on a subscription or bring content to account-visible state | `activate_subscription`, `content_activation` stage |
| **deactivate** | End subscription-backed unlimited access | `deactivate_subscription` |
| **prepare** | Hold purchased pack value for a pending upgrade conversion | `prepare_subscription_upgrade_conversion` |
| **apply** | Consume reserved conversion after successful payment | `apply_subscription_upgrade_conversion` |
| **release** | Abandon a reservation without consuming it | `release_subscription_upgrade_conversion` |
| **reverse** | Undo a billing operation after refund/chargeback | `reverse_pack_entitlement`, `reverse_unlimited_period_entitlement`, `reverse_subscription_upgrade_conversion` |
| **revoke** | Remove per-song access (set `revoked_at`) | Inside reversal RPCs; not a top-level billing verb |
| **reprioritize** | Update queue band on pending jobs after billing state change | `reprioritize_pending_jobs_for_account` |

### Status / State Values

| Domain | Column/field | Values | Scope |
|---|---|---|---|
| Song display | `SongDisplayState` | `locked \| pending \| analyzing \| analyzed \| failed` | Both |
| Subscription lifecycle (SQL) | `subscription_status` | `none \| active \| past_due \| canceled \| unpaid \| incomplete \| incomplete_expired` | Internal |
| Subscription lifecycle (TS read model) | `subscriptionStatus` | `none \| active \| ending \| past_due` | Internal |
| Upgrade conversion | `status` on `subscription_credit_conversion` | `pending \| applied \| released \| reversed` | Internal |
| Webhook processing | `status` on `billing_webhook_event` | `processing \| processed \| failed` | Internal |
| Bridge event kinds | `event_kind` on `billing_bridge_event` | `pack_fulfilled \| unlimited_activated \| pack_reversed \| unlimited_period_reversed \| subscription_deactivated` | Internal |
| Credit transaction reasons | `reason` on `credit_transaction` | `song_unlock \| pack_purchase \| credit_conversion \| credit_conversion_reversal \| replacement_grant \| refund \| chargeback_reversal \| admin_adjustment` | Internal |
| Unlock sources | `source` on `account_song_unlock` | `free_auto \| pack \| unlimited \| self_hosted \| admin` | Internal |
| Revocation reasons | `revoked_reason` on `account_song_unlock` | `refund \| chargeback \| admin` | Internal |

### Queue / Priority

| Concept | Canonical term | Frozen? | Scope |
|---|---|---|---|
| Priority tier | **queue band** — TS type: `QueueBand` (already in repo) | ✅ Yes | Internal |
| Band values | `low \| standard \| priority` | ✅ Yes | Internal |
| Band mapping | free(no balance)→low, positive balance→standard, quarterly→standard, yearly→priority, self_hosted→priority | ✅ Yes | Internal |

### Provider-Disabled / Self-Hosted

| Concept | Canonical term | Frozen? | Scope |
|---|---|---|---|
| Deployment with Stripe billing | **provider-enabled deployment** | ✅ Yes | Internal |
| Deployment without Stripe billing | **provider-disabled deployment** | ✅ Yes | Internal |
| Access source in provider-disabled deployments | `self_hosted` (in `unlimited_access_source`) | ✅ Yes | Internal |

Distinction: "provider-enabled/disabled" describes the **deployment** (env flag). `self_hosted` describes the **access source** on an account (SQL value). They correlate in practice but are semantically separate.

### Billing Bridge

| Concept | Canonical term | Frozen? | Scope |
|---|---|---|---|
| Billing-service → app HTTP call | **bridge call** | ✅ Yes | Internal |
| Bridge ingress endpoint | **billing bridge endpoint** | ✅ Yes | Internal |
| App → billing-service HTTP call | **billing service call** | ✅ Yes | Internal |
| App-side idempotency table | `billing_bridge_event` | ✅ Yes | Internal |
| Service-side idempotency table | `billing_webhook_event` | ✅ Yes | Internal |

### Env Flags

| Flag | Purpose | Default | Frozen? |
|---|---|---|---|
| `BILLING_ENABLED` | Master billing integration toggle | `false` | ✅ Yes |
| `BILLING_SERVICE_URL` | Billing service base URL | — | ✅ Yes |
| `BILLING_SHARED_SECRET` | HMAC key for app ↔ billing-service auth | — | ✅ Yes |
| `QUARTERLY_PLAN_ENABLED` | Feature flag for quarterly plan visibility | `false` | ✅ Yes |

### Pipeline Stage & Content Activation

| Concept | Canonical term | Frozen? | Scope |
|---|---|---|---|
| Post-enrichment account-scoped stage | **content activation** — `content_activation` in code, `needs_content_activation` selector flag | ✅ Yes | Internal |
| Phase labels (docs only) | Phase A (audio features + genres, free), Phase B (LLM analysis, value boundary), Phase C (embedding, gated) | ⏳ Soft (docs) | Internal |

Note: Phase A/B/C are documentation shorthand only. The execution model is per-song, per-stage flags — no coarse phase grouping in code.

### Control-Plane Change Variants

| Change kind | Canonical name | Emitted by | Frozen? |
|---|---|---|---|
| Songs became entitled | `songs_unlocked` | Free allocation, pack bonus unlocks, manual selection, bridge pack fulfillment | ✅ Yes |
| Unlimited access started | `unlimited_activated` | Bridge unlimited activation | ✅ Yes |
| Access set shrank | `candidate_access_revoked` | Bridge revocation outcomes | ✅ Yes |

---

## 3. Disambiguation

### "activate" is overloaded — canonical usage

| Context | Canonical phrase | Example |
|---|---|---|
| Subscription lifecycle | **activate subscription** | `activate_subscription` RPC |
| Pipeline content stage | **content activation** | `content_activation` stage, `needs_content_activation` flag |
| Unlimited unlock persistence | **persist unlimited unlocks** | `activate_unlimited_songs` RPC (name kept for SQL stability; semantically it persists unlock rows with subscription provenance) |
| Billing activation marker | **activation marker** | `billing_activation` table row |

Rules:
- In prose, always qualify: "subscription activation", "content activation", "activation marker" — never bare "activation"
- In code, the function/table name provides context; comments should still qualify if ambiguous

### "balance" is overloaded — canonical usage

| Phrase | Meaning |
|---|---|
| **credit balance** | `account_billing.credit_balance` — aggregate (spendable + reserved) |
| **spendable balance** | `credit_balance` minus credits reserved by pending upgrade conversions |
| **purchased pack value** | Credits from pack purchases in `pack_credit_lot` rows; eligible for upgrade conversion |
| **operational balance** | Credits from grants/adjustments with no lot provenance; never eligible for upgrade conversion |

### "reverse" vs "revoke"

| Term | Scope | Example |
|---|---|---|
| **reverse** | Undo a billing operation (balance restoration, conversion rollback) | `reverse_pack_entitlement`, `reverse_subscription_upgrade_conversion` |
| **revoke** | Remove per-song access (set `revoked_at` on unlock row) | Happens inside reversal RPCs; not a top-level billing verb |

Reversal triggers revocation, not the other way around.

---

## 4. Terms to Avoid

| ❌ Avoid | ✅ Use instead | Why |
|---|---|---|
| "credits" (user-facing) | "songs to explore" or describe the unlock action | Transactional framing undermines product identity |
| "buy credits" | "Unlock more songs" | Same reason |
| "tokens" | "credits" (internal) | Confuses with LLM tokens in the codebase |
| "tier" for plan levels | "plan" | Implies hierarchy; `free` is a different product shape, not a lesser tier |
| "subscription" as a plan name | `quarterly` / `yearly` | The plan name is the billing cadence; "subscription" is the Stripe mechanism |
| "premium" / "pro" | "unlimited" | Generic; doesn't describe what the user gets |
| "entitlement" (user-facing) | Describe the outcome directly | Too abstract for users |
| "provision" (user-facing) | "set up" or omit | Jargon |
| "gated" (user-facing) | "locked" or "unlock to explore" | Internal pipeline language |
| bare "activation" | Qualify: "subscription activation", "content activation" | Ambiguous — see §Disambiguation |
| bare "balance" | Qualify: "credit balance", "spendable balance", "purchased pack value" | Ambiguous — see §Disambiguation |
| bare "status" | Qualify: `subscription_status`, `SongDisplayState`, `conversion status` | Too many status domains |
| "onboarding allocation" | "free allocation" | The allocation is a free-tier concept, not onboarding-specific |
| "auto-allocation" standalone | "free allocation" or "pack bonus unlocks" | Ambiguous — which auto-allocation? |
| "effective access" | "effective entitlement" | "access" is too generic; "entitlement" signals billing domain |
| "provider-disabled" for access source | `self_hosted` | "provider-disabled" is the deployment; `self_hosted` is the access source |
| "account activation" for pipeline stage | "content activation" | Collides with subscription activation |
| `is_unlimited` (boolean) | `unlimited_access_source` (nullable enum) | Boolean loses the source distinction |

---

## 5. Frozen vs Soft Terms

**Frozen** — use in schema, RPCs, shared TS types. Changing later requires migration:
- Plan values: `free`, `quarterly`, `yearly`
- Offer IDs: `song_pack_500`, `unlimited_quarterly`, `unlimited_yearly`
- Unlock sources: `free_auto | pack | unlimited | self_hosted | admin`
- Revocation reasons: `refund | chargeback | admin`
- Queue bands: `low`, `standard`, `priority`
- Song display state: `locked | pending | analyzing | analyzed | failed` (type: `SongDisplayState`)
- All SQL table and column names in the plan
- All RPC names in the plan
- Env flags: `BILLING_ENABLED`, `BILLING_SERVICE_URL`, `BILLING_SHARED_SECRET`, `QUARTERLY_PLAN_ENABLED`
- TS types: `BillingState`, `UnlimitedAccess`, `BillingPlan`, `QueueBand`, `SongDisplayState`
- Control-plane change kinds: `songs_unlocked`, `unlimited_activated`, `candidate_access_revoked`
- Bridge event kinds: `pack_fulfilled | unlimited_activated | pack_reversed | unlimited_period_reversed | subscription_deactivated`
- Credit transaction reasons: `song_unlock | pack_purchase | credit_conversion | credit_conversion_reversal | replacement_grant | refund | chargeback_reversal | admin_adjustment`
- Conversion statuses: `pending | applied | released | reversed`
- Webhook statuses: `processing | processed | failed`
- Selector flags: `needs_audio_features`, `needs_genre_tagging`, `needs_analysis`, `needs_embedding`, `needs_content_activation`
- Content activation as pipeline stage name

**Soft** — user-facing copy, brand names. Can change without schema migration:
- "Backstage Pass" (yearly brand name)
- "Instant Unlocks" (pack bonus label in Stripe product)
- "Unlock more songs" (CTA copy)
- "unlimited song matching" (plan description copy)
- Phase A/B/C documentation labels
