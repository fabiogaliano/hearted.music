# Control Panel

A **local-only** operations dashboard for the Hearted production database. It is
never deployed — it runs on your machine and reads prod through the same
service-role / DB-password creds the `supabase-prod` skill already uses
(`.env.cloud` + `.env`).

```bash
bun run control-panel   # starts the API (4319) + the UI (4318)
```

Then open http://localhost:4318.

## What it shows

- **Overview** — headline counts + a "needs attention" panel (failed/stale jobs,
  unresolved item failures, pending grants, un-synced accounts) + signup trend +
  enrichment coverage.
- **Users** — accounts, signups (1d/7d/30d), library adoption, waitlist.
- **Library** — active liked songs, distinct library songs, playlists, the
  liked-count distribution, and the top libraries.
- **Enrichment** — what's *missing* per pipeline (audio features, lyrics,
  analysis, embeddings), globally and **per account**, so you can see who still
  needs processing.
- **Job health** — pending/running/failed/completed, stale running jobs,
  unresolved item failures by code, recent failures.
- **Billing & grants** — plans, subscription status, credit balance, liked-song
  grants (applied/pending) by origin.
- **Operations** — run privileged actions, each with a dry run. v1 wires
  **Grant liked-song access**: pick a verified user with a synced library from a
  searchable list and choose how many top liked songs to unlock (default 500,
  capped at 10000 by the `p_limit` RPC argument). Replaces the manual email/id
  entry of `scripts/ops/grant-liked-song-access.ts`.
- **Send email** — compose a transactional email in Hearted's house style and
  send it through Resend, with a **live preview that re-renders as you type**
  (HTML and plain-text tabs). The recipient is the same searchable account picker
  as Operations (or type any address). It reuses the product's own `envelopeHtml`
  (`src/lib/platform/email/templates.ts`), so the markup is identical to the
  verify/reset flows. Uses the real `RESEND_API_KEY` from `.env`.

## Architecture

- `server/` — a small Bun HTTP API (`bun control-panel/server/index.ts`).
  - `prod-creds.ts` resolves prod creds file-first (mirrors `scripts/db/prod.ts`)
    and refuses to run against a local URL.
  - `db.ts` — read-only `postgres.js` for metric SQL (joins/aggregates).
  - `supabase.ts` — service-role REST client for operations (RPC + lookups).
  - `metrics.ts` / `operations.ts` — the queries and the action registry.
  - `email.ts` — renders + sends styled email (preview is lenient, send is strict).
- `src/` — a standalone Vite + React UI (Linear-dark, Phosphor, NumberFlow). It
  proxies `/api` to the Bun server, so requests are same-origin in dev.

It imports **nothing** from the product (`src/`) — that keeps it isolated and
avoids dragging the app's `@/env`-bound module graph (which would split reads
between prod and your local DB). The one deliberate exception is
`server/email.ts`, which relative-imports the pure `email/templates.ts` (zero
imports, no `@/env`, no DB) so styled emails share a single source of truth with
the app instead of a drifting copy.

## Adding an operation

Add an entry to `OPERATIONS` in `server/operations.ts` (id, fields, dry-run
support) and a `case` in `runOperation`. The UI renders the form generically.

## Ports

Override with `CP_API_PORT` / `CP_WEB_PORT` if 4319 / 4318 are taken.
