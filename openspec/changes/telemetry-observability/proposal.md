# Proposal: Telemetry Observability & Metric Governance

## Why

Product decisions currently rely on a fragmented mix of raw database tables and unverified PostHog events. Client-side events suffer from ad-blocker drop-offs, premature triggers (e.g. `user_logged_in` firing before auth completes), and schema drift. Historical activity metrics (DAU, WAU, retention) cannot be queried accurately because `account_activity` only tracks the latest timestamp.

This proposal establishes a strict source-of-truth contract:
1. **Supabase is canonical for durable product facts** (accounts, onboarding, library sync, matching decisions, billing, LLM costs).
2. **PostHog is canonical only for behavioral telemetry** (pageviews, sessions, UI interaction, route usage).
3. **Reconciliation & coverage** will explicitly surface discrepancies rather than conflating tracking loss with churn.
4. **Historical activity** will be tracked daily in `account_activity_day` via atomic heartbeat RPC updates.
5. **A dedicated Telemetry section in the local Control Panel** will surface canonical funnels, activity cohorts, engagement, unit economics, and data freshness without exposing production credentials or executing arbitrary SQL/HogQL.

## What Changes

- **Historical Activity Storage**: Add `account_activity_day` table with daily UTC resolution, cascade delete, deny-all RLS, and an updated atomic `touch_account_last_seen` RPC.
- **Typed Event Capture**: Add `ProductEventMap` in `src/lib/observability/product-events.ts`, fix premature auth events (`login_attempted` vs `login_succeeded`, `signup_attempted` vs `signup_succeeded`), and ensure client captures include schema versioning.
- **PostHog Server Adapter**: Add `control-panel/server/posthog.ts` for safe, allowlisted PostHog REST queries (visitors, sessions, route usage, event coverage) with timeout, pagination, and token safety.
- **Canonical Report Modules**:
  - `control-panel/server/telemetry-db.ts`: Read-only queries for funnel cohorts, historical activity, engagement, billing, and LLM economics.
  - `control-panel/server/telemetry-posthog.ts`: Fixed PostHog query runners.
  - `control-panel/server/telemetry-reports.ts`: Unified report composer returning `TelemetryResponse<T>` with source status and caveats.
- **Control Panel API & Security**:
  - Endpoints under `/api/telemetry/*` (`sources`, `summary`, `funnel`, `activity`, `engagement`, `economics`, `coverage`).
  - Local API hardening: bind Bun server to `127.0.0.1`, restrict CORS to local Vite origins, reject non-local origins on POST endpoints.
- **Control Panel UI**:
  - New top-level `Telemetry` navigation tab.
  - Subviews for Summary, Funnel (8-stage canonical funnel with conversion % and median time), Activity (DAU/WAU/MAU cohorts), Engagement, Economics (LLM spend breakdown), and Data Quality / Coverage.

## Metric Registry & Source-of-Truth

| Metric ID | Name | Definition | Canonical Source | Timestamp | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `funnel_account_created` | Account Created | Account registered | Supabase `account` | `created_at` | Funnel baseline |
| `funnel_spotify_connected` | Spotify Connected | Account has `spotify_id` | Supabase `account` | `created_at` / current | Milestone 1 |
| `funnel_library_synced` | Library Synced | First completed sync | Supabase `job` (`extension_sync`) | `finished_at` | Milestone 2 |
| `funnel_onboarding_completed` | Onboarding Completed | Onboarding finished | Supabase `account` | `onboarding_completed_at` | Milestone 3 |
| `funnel_matches_available` | Matches Available | First match snapshot | Supabase `match_snapshot` | `created_at` | Milestone 4 |
| `funnel_match_engaged` | Match Engaged | First match event | Supabase `match_event` | `created_at` | Milestone 5 |
| `funnel_first_value` | First Value (Song Added)| First `added` match event | Supabase `match_event` (`event = 'added'`) | `created_at` | North star activation |
| `funnel_paid` | Paid Activation | First billing activation | Supabase `billing_subscription` / `billing_event` | `created_at` | Monetization conversion |
| `activity_dau` | Daily Active Accounts | Distinct accounts with daily heartbeat | Supabase `account_activity_day` | `activity_date` | Canonical DAU |
| `activity_observed_visitors` | Observed Web Visitors | Distinct PostHog distinct_ids | PostHog `$pageview` | Event timestamp | Subject to consent / blockers |
| `engagement_decisions` | Total Decisions | Added + Dismissed | Supabase `match_event` | `created_at` | Durable engagement |
| `economics_llm_spend` | Total LLM Spend | Sum of estimated cost | Supabase `llm_usage` | `created_at` | Unit economics |

## Capabilities

### New Capabilities
- `telemetry-registry`: Central typed event definition, schema versioning, and canonical metric rules.
- `telemetry-reporting`: Read-only reporting pipelines aggregating database facts and behavioral telemetry with source isolation.
- `control-panel-telemetry`: High-fidelity interactive dashboard for product health, cohort funnels, and data quality.

### Modified Capabilities
- `auth`: Client login and signup flows emit separate attempted vs succeeded telemetry events.
- `activity-tracking`: Heartbeat RPC writes both latest `account_activity` and daily `account_activity_day`.
