---
status: proposed
updated: 2026-08-16
---

# Telemetry Observability Layer

## 1. Framing

This plan establishes reliable product telemetry and surfaces it through the
local control panel. It deliberately addresses telemetry before error tracking,
alerting, or AI-assisted analysis.

The control panel remains a local-only, single-operator Vite application backed
by its existing Bun API. Production data stays server-side. The browser receives
only bounded, structured reports.

### In scope

- Reliable product telemetry capture and naming.
- Canonical PM/owner metrics.
- Supabase and PostHog read adapters.
- Source availability, freshness, and instrumentation coverage.
- A unified, read-only control-panel telemetry API.
- Telemetry dashboards and drill-downs.
- Historical authenticated-account activity tracking.
- Cleanup of stale PostHog metric definitions.

### Deferred

- Sentry and application-error investigation.
- Error dashboards and alert delivery.
- Embedded AI analysis.
- MCP or other external-agent access.
- Automated remediation.
- Generic SQL or HogQL consoles.
- Hosting or remotely exposing the control panel.

## 2. Source-of-truth policy

### Supabase is canonical for durable facts

- Account creation.
- Onboarding state and completion.
- Spotify connection.
- Library synchronization.
- Billing state and activation.
- Match snapshots, sessions, and decisions.
- Job execution.
- LLM usage and cost.

### PostHog is canonical only for behavioral telemetry

- Pageviews.
- Sessions.
- Route usage.
- UI interactions.
- Traffic attribution.
- Client performance.

PostHog event counts never override database facts. PostHog can miss events due
to consent, blockers, navigation, network failure, or bad instrumentation. Its
behavioral metrics must therefore be labelled **observed analytics traffic** and
must not be presented as complete population counts.

No generic first-party `product_event` table is introduced. Durable milestones
already exist in domain-owned tables. Duplicating those facts into an event
ledger would create another source to reconcile without adding present value.

## 3. Metric contract

Before implementing reports, create a metric registry. Every metric SHALL have:

- A stable metric ID.
- A human-readable name.
- Exact numerator and denominator.
- Canonical source.
- Timestamp used.
- Account inclusion rules.
- UTC range semantics.
- Known limitations.
- An optional corroborating PostHog event.

All time ranges use UTC half-open intervals:

```text
from <= timestamp < to
```

### 3.1 Canonical funnel

| Stage | Definition | Source |
| --- | --- | --- |
| Account created | `account.created_at` falls in the selected signup cohort | Supabase |
| Spotify connected | Account currently has a non-null `spotify_id` | Supabase |
| Library synced | Account has a completed `extension_sync` job | Supabase |
| Onboarding completed | `user_preferences.onboarding_completed_at` is populated | Supabase |
| Matches available | Account has a persisted `match_snapshot` | Supabase |
| Match engaged | Account has a persisted `match_event` | Supabase |
| First value | Account has a `match_event.event = 'added'` row | Supabase |
| Paid | Account has a `billing_activation` row | Supabase |

Funnel analysis is cohort-based: accounts are selected by signup date and then
measured by whether they reached each milestone. The report includes:

- Conversion between adjacent stages.
- Conversion from account creation.
- Median and p75 time to each timestamped milestone.
- Accounts currently stopped at each stage.
- An insufficient-data state instead of misleading percentages.

Spotify connection has no dedicated historical timestamp today. Its first
version is therefore an eventual state within the signup cohort, not a timed
milestone. The UI SHALL disclose that limitation and SHALL NOT derive a fake
connection time from `account.updated_at`.

### 3.2 Activity

Two distinct metric families are exposed:

1. **Canonical account activity** — authenticated account heartbeats in
   Supabase, covering all authenticated users.
2. **Observed web activity** — PostHog visitors, sessions, and pageviews,
   subject to consent and blockers.

They SHALL NOT be combined into one unexplained active-user figure.

Canonical activity includes:

- Current 24-hour active accounts.
- Current 7-day active accounts.
- Current 30-day active accounts.
- Historical DAU after the daily activity table ships.
- Signup-cohort week-one and week-four retention once enough history exists.

### 3.3 Match engagement

Durable match data defines:

- Accounts with a review session.
- Accounts with at least one match event.
- Sessions started and completed.
- Suggestions served.
- Added, dismissed, and skipped events.
- Add rate among explicit decisions.
- Add rate among all served items.
- Decisions per engaged account.
- Time from first snapshot to first decision.
- Time from first decision to first add.
- Orientation split where stored.

The explicit-decision add rate uses `added / (added + dismissed)`. The overall
served-item add rate uses `added / (added + dismissed + skipped)`. They remain
separate because skips and explicit rejection express different behavior.

### 3.4 Economics

Supabase defines:

- Active subscriptions.
- New paid activations.
- LLM calls and cost.
- Cost by provider, model, and function.
- Cost per recorded analysis.
- Cost per activated account.
- Cost per paid account.
- Current-period versus previous-period spend.

## 4. Historical account activity

The current `account_activity` table stores only the latest timestamp. It cannot
answer historical DAU or retention questions.

Add a migration for:

```sql
CREATE TABLE account_activity_day (
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (account_id, activity_date)
);
```

Required behavior:

- `activity_date` is derived in UTC.
- RLS is enabled with a deny-all policy, matching `account_activity`.
- An index on `activity_date` supports aggregate activity queries.
- Only the existing service-role heartbeat RPC writes the table.
- The first heartbeat on a UTC day inserts the row.
- Later heartbeats update only `last_seen_at`.
- No route, IP address, user agent, or request payload is stored.
- Account deletion cascades the history.

Update `touch_account_last_seen` atomically to maintain both
`account_activity.last_seen_at` and `account_activity_day`.

Backfill exactly one day from each existing account's current `last_seen_at`.
Do not invent historical activity. Reports SHALL mark dates before the migration
as incomplete.

## 5. Product-event contract and capture semantics

The current event names and timing are unreliable:

- `user_logged_in` fires before authentication succeeds.
- `user_signed_up` fires before account creation succeeds.
- `purchase_confirmed` depends on returning through one client route.
- Durable facts are duplicated between PostHog and Supabase.
- Raw strings and property objects allow taxonomy drift.

### 5.1 Typed client event map

Add a typed event map under `src/lib/observability/` and expose it through a
typed client hook. Representative events:

```ts
interface ProductEventMap {
  login_attempted: { provider: AuthProvider };
  login_succeeded: { provider: AuthProvider };
  signup_attempted: { provider: AuthProvider };
  signup_succeeded: { provider: AuthProvider };
  checkout_started: {
    plan_kind: string;
    offer: string;
  };
  onboarding_completed: {
    songs: number;
    playlists: number;
  };
}
```

The contract enforces:

- Valid event names.
- Required properties.
- A product-event schema version.
- Consistent snake-case property names.
- Runtime/source metadata where it is meaningful.

### 5.2 Correct event timing

- Rename premature `user_logged_in` events to `login_attempted`.
- Emit `login_succeeded` only after credential login succeeds.
- Treat Supabase account creation as canonical signup success.
- Emit `checkout_started` only after checkout session creation succeeds.
- Treat `billing_activation` as canonical purchase confirmation.
- Treat persisted onboarding state as canonical onboarding completion.
- Treat `match_event` as canonical match action history.
- Treat `match_snapshot` as canonical match publication.

Historical event names remain queryable but are marked legacy. Reports do not
combine old and new names unless their semantics are demonstrably equivalent.

### 5.3 Consent boundary

- Client PostHog events continue through the existing consent system.
- Owner metrics never infer abandonment from a missing PostHog event.
- Durable server facts are read from Supabase rather than duplicated into
  identified PostHog events solely to build a funnel.
- Behavioral PostHog metrics are labelled as observed traffic.

## 6. PostHog read adapter

The control panel calls the PostHog API directly. It does not shell out to
`posthog-cli`.

### 6.1 Configuration

Add local-only variables to `.env.example`:

```env
POSTHOG_PERSONAL_API_KEY=
POSTHOG_PROJECT_ID=185471
POSTHOG_API_HOST=https://eu.posthog.com
```

Requirements:

- The personal token remains in the Bun server.
- The browser never receives the token.
- The EU API host is allowlisted.
- The project ID is validated.
- Missing configuration returns an `unconfigured` source status rather than
  preventing the control panel from starting.

### 6.2 Server module

Add `control-panel/server/posthog.ts` with named, allowlisted operations:

- `postHogSourceStatus()`
- `postHogActivity(range)`
- `postHogRouteUsage(range)`
- `postHogEventCoverage(range)`
- `postHogLatestEvents()`

It SHALL NOT accept arbitrary HogQL from an HTTP request.

Every PostHog request has:

- A bounded timeout.
- A response-size limit.
- Runtime response validation.
- Controlled pagination.
- Redacted errors.
- A typed `Result`.

## 7. Telemetry report modules

Add:

```text
control-panel/server/telemetry-db.ts
control-panel/server/telemetry-posthog.ts
control-panel/server/telemetry-reports.ts
```

### 7.1 `telemetry-db.ts`

Owns read-only SQL for:

- Funnel cohorts.
- Current and historical activity.
- Retention.
- Match engagement.
- Billing conversion.
- LLM economics.
- Latest durable production activity.

Every query runs through the existing read-only transaction wrapper.

### 7.2 `telemetry-posthog.ts`

Owns fixed PostHog queries for:

- Visitors.
- Sessions.
- Pageviews.
- Route usage.
- Behavioral events.
- Latest captured-event timestamps.

### 7.3 `telemetry-reports.ts`

Combines already-loaded source data into UI-ready reports. It performs no raw
SQL or HTTP itself.

Every report returns source metadata:

```ts
interface TelemetryResponse<T> {
  generatedAt: string;
  range: {
    from: string;
    to: string;
    timezone: "UTC";
  };
  data: T;
  sources: {
    supabase: SourceStatus;
    posthog: SourceStatus;
  };
  caveats: string[];
}

type SourceStatus =
  | {
      status: "available";
      fetchedAt: string;
      latestObservedAt: string | null;
    }
  | {
      status: "quiet";
      fetchedAt: string;
      latestObservedAt: string | null;
    }
  | { status: "unconfigured"; message: string }
  | { status: "unavailable"; message: string };
```

A PostHog failure never hides available Supabase metrics.

## 8. Control-panel telemetry API

Add read-only endpoints:

```text
GET /api/telemetry/sources
GET /api/telemetry/summary?range=30d
GET /api/telemetry/funnel?cohort=30d
GET /api/telemetry/activity?range=30d
GET /api/telemetry/engagement?range=30d
GET /api/telemetry/economics?range=30d
GET /api/telemetry/coverage?range=30d
```

Initially supported ranges:

- `24h`
- `7d`
- `14d`
- `30d`
- `90d`
- `launch`

The launch boundary is a single date constant in the metric contract, inferred
from the earliest production account date rather than chosen independently by
each query. Custom dates are deferred until preset reports are validated.

### Caching

- Supabase telemetry reports use the existing 30-second cache.
- PostHog reports use a five-minute cache.
- In-flight requests are deduplicated.
- Manual refresh bypasses stored values and repopulates the cache.
- Responses always expose source and generation timestamps.

## 9. Instrumentation coverage and source freshness

Add a reconciliation report for facts with existing equivalent events:

| Canonical fact | PostHog event |
| --- | --- |
| Onboarding completed | `onboarding_completed` |
| Billing activation | Legacy `purchase_confirmed` |
| Match snapshot persisted | `match_snapshot_published` |
| Match action persisted | `match_deck_action` |

For each pair, report:

- Canonical database count.
- PostHog event count.
- Distinct accounts in each source where identity is available.
- Coverage percentage.
- Latest timestamp from each source.
- Known semantic mismatch.

This is instrumentation coverage, not product conversion.

Rules:

- Show raw differences immediately.
- Do not assign a critical percentage state until the canonical denominator is
  at least 10.
- Do not call PostHog stale merely because traffic is zero.
- Mark PostHog `quiet` when its API works but Supabase shows newer account
  activity than PostHog.
- Mark it `unavailable` only when its API cannot be queried.
- Mark it `unconfigured` when local API credentials are absent.

## 10. Control-panel UI

Add a top-level **Telemetry** section after Overview.

### 10.1 Shared header

- Range selector.
- Explicit UTC range.
- Last generated timestamp.
- Supabase source status.
- PostHog source status.
- Manual refresh.
- Visible caveat indicator.

### 10.2 Summary

Headline cards:

- Accounts created.
- Onboarding-completed accounts.
- Current 7-day active accounts.
- Match-engaged accounts.
- Paid accounts.
- LLM spend.

Each card shows its canonical source, current value, previous-period comparison,
and drill-down destination.

### 10.3 Funnel

Render the canonical stages vertically:

```text
Account created
  ↓
Spotify connected
  ↓
Library synced
  ↓
Onboarding completed
  ↓
Matches available
  ↓
Match engaged
  ↓
First song added
  ↓
Paid
```

Every stage displays:

- Accounts.
- Conversion from the preceding stage.
- Conversion from signup.
- Median time where a real milestone timestamp exists.
- Accounts currently stopped there.

### 10.4 Activity

- Canonical DAU from `account_activity_day`.
- Current WAU and 30-day active accounts.
- Signup cohorts.
- Week-one and week-four retention when sufficient history exists.
- Separately labelled PostHog visitors and sessions.
- Most-used routes from PostHog.

Pre-migration history is displayed as unavailable, not zero.

### 10.5 Engagement

- Review sessions.
- Engaged accounts.
- Added, dismissed, and skipped counts.
- Explicit-decision add rate.
- Overall served-item add rate.
- Decisions per account.
- Orientation split.
- Time to first add.

### 10.6 Economics

- Total LLM spend.
- Spend by function and model.
- Daily spend.
- Cost per analysis.
- Cost per activated account.
- Paid activations.
- Active subscriptions.

### 10.7 Data quality

- Source status and freshness.
- Instrumentation coverage table.
- Legacy-event warnings.
- Missing PostHog configuration.
- Latest durable activity.
- Latest observed PostHog activity.

## 11. Local API hardening

Adding a PostHog personal token increases the importance of local isolation.
The foundational implementation SHALL:

- Bind the Bun API explicitly to `127.0.0.1`.
- Replace wildcard CORS with the configured local Vite origin.
- Keep the Vite `/api` proxy as the browser's normal access path.
- Reject unexpected origins on state-changing routes.
- Never return configuration tokens from health endpoints.
- Never expose a generic PostHog passthrough endpoint.

This also prevents arbitrary websites from reading existing production-data
endpoints through localhost.

## 12. Testing

### 12.1 Database integration tests

- The first heartbeat creates current and daily activity rows.
- Repeated heartbeats update rather than duplicate the day.
- A UTC date transition creates another daily row.
- Account deletion cascades daily activity.
- Funnel queries count each account once.
- Billing activation is not double-counted.
- Match events are classified correctly.

### 12.2 PostHog adapter tests

Mock:

- Successful query.
- Missing configuration.
- Timeout.
- Authentication failure.
- Rate limiting.
- Malformed response.
- Empty results.
- Pagination.
- Unexpected project response.

### 12.3 Report tests

Use fixed source fixtures to verify:

- Conversion calculations.
- Median and p75 milestone timing.
- Previous-period comparisons.
- Partial PostHog failure.
- Low-denominator coverage behavior.
- `quiet` versus `unavailable`.
- UTC range boundaries.

Expected values come from the metric contract or hand calculation, never from
running the implementation under test.

### 12.4 UI tests

- Source-unavailable state still displays database metrics.
- Range changes refetch the report.
- Funnel stages expose accessible names and values.
- Coverage warnings navigate to data quality.
- Empty history is not rendered as zero retention.
- Refresh preserves the selected range.

### 12.5 Verification commands

Run targeted tests for each changed area:

```bash
bun run test control-panel/server/__tests__/telemetry-*.test.ts
bun run test src/lib/observability/__tests__/product-events.test.ts
bun run test src/lib/platform/auth/__tests__/auth.server.test.ts
bun run typecheck
bun run check
```

After adding the migration, local only:

```bash
bunx supabase db push
bun run gen:types
bun run typecheck
```

Production migration remains CI-only.

## 13. Delivery sequence

### Change 1 — specification and contracts

- OpenSpec proposal, design, spec delta, and tasks.
- Metric registry.
- Source-of-truth rules.
- Range semantics.
- Consent semantics.

### Change 2 — activity-history schema

- `account_activity_day` migration.
- Heartbeat RPC update.
- Generated database types.
- Integration tests.

This structural migration remains separate from event behavior changes.

### Change 3 — event semantics

- Typed product-event map.
- Correct attempted versus succeeded events.
- Remove PM-report reliance on client purchase confirmation.
- Event schema version.
- Restrict PostHog's role to behavioral telemetry where durable facts exist.

### Change 4 — telemetry read layer

- PostHog client.
- Database telemetry queries.
- Report composition.
- Source metadata.
- Read-only API endpoints.
- Local API hardening.

### Change 5 — control-panel interface

- Telemetry navigation.
- Summary.
- Funnel.
- Activity.
- Engagement.
- Economics.
- Data quality.

### Change 6 — rollout and reconciliation

- Validate control-panel numbers against hand-calculated production samples.
- Confirm PostHog query results.
- Mark pre-deployment historical activity as incomplete.
- Update or archive the stale PostHog Analytics basics dashboard.
- Document which reports are authoritative.

## 14. Acceptance criteria

The telemetry layer is complete when:

1. The control panel answers core PM questions without opening Supabase or
   PostHog.
2. Every number identifies its source and time range.
3. Durable conversions come from Supabase.
4. PostHog unavailability does not hide canonical metrics.
5. Historical authenticated DAU accumulates reliably from rollout onward.
6. PostHog event names describe what actually happened.
7. Instrumentation loss is visible as coverage rather than mistaken for churn.
8. No production credential reaches the browser.
9. No arbitrary SQL or HogQL endpoint exists.
10. Errors, Sentry, alerts, and AI analysis remain deferred to later changes.
