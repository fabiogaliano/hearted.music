# Tasks: Telemetry Observability Implementation

## Phase 1: Database Migration & Storage (Change 2)
- [ ] 1.1 Create migration `supabase/migrations/20260816180000_create_account_activity_day.sql` with table definition, index, RLS, backfill, and updated `touch_account_last_seen` RPC.
- [ ] 1.2 Update TypeScript definitions in `src/lib/data/database.types.ts` for `account_activity_day`.
- [ ] 1.3 Add integration/unit tests for heartbeat RPC and `account_activity_day` updates in `src/lib/domains/library/accounts/__tests__/`.

## Phase 2: Event Taxonomy & Typed Client Contracts (Change 3)
- [ ] 2.1 Create `src/lib/observability/product-events.ts` with `ProductEventMap`, schema versioning, and typed event helpers.
- [ ] 2.2 Refactor `src/routes/login.tsx` to emit `login_attempted`, `login_succeeded`, `signup_attempted`, and `signup_succeeded`.
- [ ] 2.3 Refactor event call sites across `src/features/` and `src/routes/` to use typed schemas.
- [ ] 2.4 Add unit tests for typed product events in `src/lib/observability/__tests__/product-events.test.ts`.

## Phase 3: Telemetry Read Layer & API Hardening (Change 4)
- [ ] 3.1 Create `control-panel/server/posthog.ts` for direct, secure PostHog API integration with allowlisting, timeouts, and error redaction.
- [ ] 3.2 Create `control-panel/server/telemetry-db.ts` for read-only SQL aggregations (funnel, activity, engagement, economics, coverage).
- [ ] 3.3 Create `control-panel/server/telemetry-posthog.ts` with cached PostHog queries.
- [ ] 3.4 Create `control-panel/server/telemetry-reports.ts` for combined reporting with source status and caveats.
- [ ] 3.5 Update `control-panel/server/index.ts` with API hardening (127.0.0.1 binding, local CORS, origin checks) and telemetry routes (`/api/telemetry/*`).
- [ ] 3.6 Add server unit tests in `control-panel/server/__tests__/telemetry-*.test.ts`.

## Phase 4: Control Panel UI (Change 5)
- [ ] 4.1 Add `Telemetry` section tab to `control-panel/src/App.tsx`.
- [ ] 4.2 Create `control-panel/src/sections/TelemetrySection.tsx` with shared range selector, source freshness badges, caveats banner, and subviews:
  - Summary View (headline metrics, prior period comparison)
  - Funnel View (8-stage vertical funnel, drop-offs, timing, stuck accounts)
  - Activity View (canonical DAU/WAU chart + PostHog visits)
  - Engagement View (match deck actions, add rates, session counts)
  - Economics View (LLM spend, cost per user/song)
  - Data Quality View (reconciliation table, latency, coverage)
- [ ] 4.3 Add UI unit tests in `control-panel/src/sections/__tests__/TelemetrySection.test.tsx`.

## Phase 5: Verification & Delivery (Change 6)
- [ ] 5.1 Run full suite of unit and integration tests.
- [ ] 5.2 Run typecheck and linter checks (`bun run typecheck`, `bun run check`).
- [ ] 5.3 Verify edge cases (e.g. unconfigured PostHog, empty DB tables, UTC date boundaries).
