# Design: Telemetry Observability & Control Panel Architecture

## 1. Database Schema Design

### 1.1 `account_activity_day`
Stores daily account activity granularity for cohort analysis, DAU, WAU, and retention.
```sql
CREATE TABLE account_activity_day (
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, activity_date)
);

CREATE INDEX idx_account_activity_day_date ON account_activity_day (activity_date);
ALTER TABLE account_activity_day ENABLE ROW LEVEL SECURITY;
CREATE POLICY "account_activity_day_deny_all" ON account_activity_day FOR ALL USING (false);
```

### 1.2 Atomic Heartbeat RPC `touch_account_last_seen`
Maintains latest timestamp in `account_activity` and day record in `account_activity_day`:
```sql
CREATE OR REPLACE FUNCTION touch_account_last_seen(p_account_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_today DATE := (v_now AT TIME ZONE 'UTC')::date;
BEGIN
  INSERT INTO account_activity (account_id, last_seen_at)
  VALUES (p_account_id, v_now)
  ON CONFLICT (account_id) DO UPDATE
    SET last_seen_at = v_now
    WHERE account_activity.last_seen_at < v_now - interval '10 minutes';

  INSERT INTO account_activity_day (account_id, activity_date, first_seen_at, last_seen_at)
  VALUES (p_account_id, v_today, v_now, v_now)
  ON CONFLICT (account_id, activity_date) DO UPDATE
    SET last_seen_at = v_now;
END;
$$;
```

## 2. Typed Client Event Contract

File: `src/lib/observability/product-events.ts`
- Schema version: `EVENT_SCHEMA_VERSION = 1`
- `ProductEventMap`: strictly typed dictionary of client events and payloads.
- Event names:
  - `login_attempted`, `login_succeeded`, `login_error`
  - `signup_attempted`, `signup_succeeded`, `signup_error`
  - `checkout_started`, `checkout_cancelled`, `free_plan_selected`, `billing_portal_opened`
  - `onboarding_completed`
  - `song_dismissed`, `song_added_to_playlist`, `match_suggestion_dismissed`, `matching_session_completed`
  - `password_reset_requested`, `password_reset_failed`, `password_reset_succeeded`
  - `user_logged_out`
- Typed helper function: `captureProductEvent(event, properties)` integrating PostHog client with version metadata.

## 3. Server Architecture (`control-panel/server/`)

### 3.1 `posthog.ts`
- Direct REST queries to PostHog EU/US API with timeout (5s) and `AbortController`.
- Never exposes personal API key to frontend.
- Validates host allowlist (`https://eu.posthog.com`, `https://app.posthog.com`, `https://us.posthog.com`).
- Methods: `postHogSourceStatus()`, `postHogActivity(range)`, `postHogRouteUsage(range)`, `postHogEventCoverage(range)`, `postHogLatestEvents()`.

### 3.2 `telemetry-db.ts`
- Runs parameterized read-only queries against Postgres pool:
  - `getDbSourceStatus()`
  - `getFunnelCohort(range)`
  - `getActivityMetrics(range)`
  - `getEngagementMetrics(range)`
  - `getEconomicsMetrics(range)`
  - `getCoverageDbMetrics(range)`
- Computes cohort step metrics, drop-offs, median and p75 durations using SQL window functions and aggregations.

### 3.3 `telemetry-reports.ts`
- Merges Supabase canonical metrics and PostHog behavioral telemetry.
- Emits standard envelope `TelemetryResponse<T>`:
  ```ts
  interface TelemetryResponse<T> {
    generatedAt: string;
    range: { from: string; to: string; timezone: "UTC"; preset: string };
    data: T;
    sources: {
      supabase: SourceStatus;
      posthog: SourceStatus;
    };
    caveats: string[];
  }
  ```
- Graceful isolation: PostHog failures result in `posthog.status = "unavailable"` with caveats while Supabase data is preserved.

### 3.4 Local API Hardening (`control-panel/server/index.ts`)
- Explicit binding: `hostname: "127.0.0.1"`.
- CORS restricted to `http://localhost:*` and `http://127.0.0.1:*`.
- Mutation endpoint origin verification.

## 4. Control Panel UI Architecture (`control-panel/src/`)

- Added to navigation hierarchy: `Overview` -> `Telemetry` -> `Users` -> ...
- Sections:
  - Header: Range selector (`24h`, `7d`, `14d`, `30d`, `90d`, `all`), UTC range preview, Source status badges, Refresh button, Caveats drawer.
  - Subviews:
    - `Summary`: Key performance indicators with previous-period comparison.
    - `Funnel`: 8-stage canonical funnel with conversion % and median time.
    - `Activity`: Canonical DAU/WAU chart + PostHog observed web visits.
    - `Engagement`: Matching decisions, served vs explicit add rate, orientation split.
    - `Economics`: LLM spend by model/function, cost per activated user.
    - `Data Quality / Coverage`: Source freshness and event parity comparison table.
