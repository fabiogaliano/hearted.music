---
status: proposed
updated: 2026-07-15
---

# Local Control Panel UX and Operator Workflow Improvements

> Future-state implementation plan based on repository commit `bc18627b`.
> The control panel remains a local-only, single-operator tool that reads and
> writes production directly. This plan improves that workflow; it does not turn
> the panel into a deployable product.

Deployment, authentication, multi-operator permissions, and hosted operation are
explicitly outside the current initiative.

## 1. Framing and hard boundaries

The current panel has useful domain-specific sections and safe read paths, but
its shared UI layer is intentionally minimal: navigation is in component state,
tables only render rows, list queries use fixed limits, and mutation feedback is
lost when a section unmounts. The work below makes the existing surfaces faster
to investigate and safer to operate without changing the panel's deployment
model.

### In scope

- Search, filtering, sorting, pagination, column controls, and exact filtered
  CSV/JSON export on data-heavy sections.
- URL-backed sections, tabs, filters, selected users, and browser Back/Forward.
- Saved views and local operator preferences.
- Better loading, refresh, empty, error, and success feedback.
- Overview time-range comparison and more useful attention thresholds.
- Faster review queues: search, filters, reviewed history, focus mode, keyboard
  navigation, and safe bulk approval.
- Local action history for privileged operations, review actions, and email.
- Stronger preview/commit UX for existing mutations.
- Durable local batch execution for grants, safe approvals, and bounded email
  sends, with progress and partial retry.
- Read-only job, billing, grant, and user-detail drill-down improvements.

### Explicitly postponed

- Deployment, hosting, remote access, packaging, or a hosted environment.
- Authentication, RBAC, SSO, MFA, multi-operator attribution, tenant isolation,
  approval chains, or compliance-grade audit retention.
- Deployment-oriented network/CORS hardening.
- External alert delivery, on-call integrations, or a service that runs while
  the local panel is closed.
- Migrating the panel to TanStack Start or importing product UI infrastructure.
- A generic SQL editor or generic CRUD surface.
- Generic job retries, Backstage Pass revocation, or other new privileged domain
  semantics. Those need separate domain plans because a status flip or copied SQL
  could violate product workflow invariants.

### Product and architecture rules

- Keep the standalone Vite UI and Bun API under `control-panel/`.
- Keep aggregate/list SQL in the control-panel server and run reads through the
  existing read-only transaction wrapper.
- Do not introduce barrel exports.
- Do not add new runtime imports from the product's `@/env`-bound graph. Batch
  grants may reuse the helpers already imported by `server/operations.ts`; audio
  actions may reuse their existing wake/URL imports.
- Never send DB-derived ID sets back into Supabase `.in()` URL filters. Resolve
  a filtered cohort in SQL/RPC, snapshot it locally, and process one target at a
  time through existing domain helpers.
- Comments explain why only. Preserve strict typing; no `any`, non-null
  assertions, or unvalidated query/body input.
- Use Bun for all commands. Tests run through `bun run test` (Vitest).

## 2. Current repository state

### Shell and shared UI

- `control-panel/src/App.tsx` owns the active section, selected user, and library
  tier in React state. Reload and browser Back do not preserve them.
- `control-panel/src/components/primitives.tsx#Table` renders rows with index
  keys. It has no controlled sort, filter, pagination, selection, or export
  contract.
- `control-panel/src/lib/api.ts` has a useful response cache and `loading` flag,
  but no fetch timestamp or distinction between initial load and background
  refresh. Cached rows can refresh without visible feedback.
- `App.tsx` remounts sections by key, which discards local section state and
  deliberately replays card entrance animations.

### Fixed list limits

- Users: newest 500 in `server/metrics.ts#usersList`.
- Liked-count drill-down: 200 in `accountsByLiked`.
- Enrichment accounts: top 30 in `enrichmentMetrics`.
- Job item failures: 200 in `jobFailures`; recent failed jobs: 15.
- Audio, release-year, lyrics, and instrumental queues: up to 200 each.
- User detail: latest 60 liked songs.

### Existing mutation UX

- The `OPERATIONS` registry has one entry, Grant access, with song-access and
  Backstage variants. Dry-run exists, but Run remains available before a preview
  and the preview is raw JSON.
- Operations, email, and destructive reviews use native `window.confirm`.
- Per-card busy/error states work, but outcomes disappear after navigation.
- Audio and instrumental review tables already preserve reviewed status and
  metadata in production. Release-year, lyrics, manual URL, grant, and email
  actions do not share one operator-facing history.
- Review mutations live outside the `OPERATIONS` registry, so action history
  must wrap every mutating API route rather than only registry operations.

### Existing strengths to preserve

- `server/db.ts#read` enforces a read-only transaction for metric/list SQL.
- Destructive review actions use explicit read-write transactions and stale-row
  guards.
- Account search escapes wildcard input and binds query parameters.
- The client/server response caches avoid aggregate-query stampedes.
- The server refuses local Supabase credentials, and the shell shows the active
  production project ref.

## 3. Resolved UX and data decisions

### 3.1 URL state without a router dependency

Use the current single-page shell with `window.history.pushState`,
`replaceState`, and `popstate`; do not add TanStack Router or React Router.

Canonical global parameters:

- `section`: one of the existing `NAV` keys plus the new `history` section.
- `user`: account UUID for User Detail.
- `tierMin` / `tierMax`: Library liked-count drill-down.
- `view`: section-specific tab, such as an audio queue bucket or review status.
- `q`, `sort`, `direction`, `page`, `pageSize`: shared table state.
- Additional filters use stable section-specific names, documented beside each
  endpoint below.

Rules:

- Navigation to another section clears parameters that section does not own.
- Opening a user preserves the source section and its filters. Closing User
  Detail restores that exact view.
- Back/Forward restores section, table state, queue tab, and selected record.
- Invalid values are normalized to defaults with `replaceState`, not an error.
- Mutation drafts, lyrics text, and email bodies never go into the URL.

Add `control-panel/src/lib/url-state.ts` for parsing/serialization and focused
unit tests. `App.tsx` remains the owner of navigation; contexts receive typed
navigation requests instead of bare strings.

### 3.2 Shared data-table contract

Create `control-panel/src/components/DataTable.tsx`; do not turn
`primitives.tsx` into a catch-all. Keep the current `Table` for small aggregate
rows where controls add no value.

`DataTable` is controlled and supports:

- A debounced search input (250 ms).
- Explicit filter controls supplied by the section.
- Clickable sortable headers with `aria-sort`.
- Page sizes 25, 50, and 100; default 50.
- Server-reported total and page navigation.
- Stable row IDs supplied by `getRowId`; never array-index keys.
- Optional row selection with select-page and select-all-matching affordances.
- Column visibility stored as a local preference per table.
- CSV and JSON download actions when the section supplies an export URL.
- A Reset button that clears search/filter/sort/page state to section defaults.
- Initial skeleton only when there is no data. During a background query, retain
  current rows, mark the table `aria-busy`, and show a compact refreshing state.
- Distinct empty copy for “no records exist” versus “no records match filters.”
- Errors keep stale rows visible and offer Retry instead of replacing the whole
  section with an error card.

Add a typed page shape to `control-panel/src/lib/types.ts` and mirror it in the
server without importing server runtime code into the UI:

```ts
interface PageResult<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: 25 | 50 | 100;
}
```

The server validates every query parameter. Sort columns map through per-query
allowlists; no URL value is interpolated as SQL. Page is clamped to at least 1,
and invalid page sizes normalize to 50.

### 3.3 Export behavior

Expose section-specific endpoints rather than a generic SQL exporter:

- `/api/exports/users.csv` and `.json`
- `/api/exports/enrichment-accounts.csv` and `.json`
- `/api/exports/job-failures.csv` and `.json`
- `/api/exports/job-runs.csv` and `.json`
- `/api/exports/grants.csv` and `.json`
- `/api/exports/accounts-by-liked.csv` and `.json`

Each endpoint uses the same parsed filter/sort object as its corresponding list
query, ignores pagination, and returns the exact filtered result. Cap exports at
25,000 rows. If the count exceeds the cap, return 422 with copy telling the
operator to narrow the filters; never silently truncate.

CSV rules:

- UTF-8 with a header row.
- Escape formula-leading cell values (`=`, `+`, `-`, `@`) so opening production
  data in a spreadsheet cannot execute a formula.
- Use ISO timestamps, not relative labels.
- Filename includes section, production ref, and UTC timestamp.
- Export buttons say that the file contains production data.

### 3.4 Local persistence

Use `localStorage` for non-sensitive UI preferences:

- `hearted-control-panel.saved-views.v1`
- `hearted-control-panel.table-preferences.v1`
- `hearted-control-panel.review-preferences.v1`
- `hearted-control-panel.email-draft.v1`
- `hearted-control-panel.attention-thresholds.v1`

Saved views contain a user-supplied label, section, and normalized URL
parameters. Limit to 30 views; names must be non-empty and unique
case-insensitively. Saving a duplicate name replaces it only after confirmation.

Use a local SQLite file for action and batch history because this is one local
operator and the history is for recall/recovery, not product data or compliance:

- Default path: `control-panel/.data/control-panel.sqlite`.
- Add `control-panel/.data/` to `.gitignore`.
- Allow `CP_DATA_DIR` to override the directory.
- Use Bun's built-in `bun:sqlite`; do not add a package.
- Initialize idempotently on server startup with numbered local schema
  migrations in `control-panel/server/local-store/`.
- If local history initialization fails, reads still work, but every mutating
  endpoint returns 503 before touching production. A prod write must never run
  while its local run record cannot be created.

### 3.5 Action-history model

Local `action_run` fields:

- `id`, `prod_ref`, `action_type`, and `mode` (`dry_run` or `commit`).
- `target_type`, `target_id`, and a human target label snapshot.
- `input_summary_json`; redact email/lyrics bodies and store content length/hash
  rather than full text.
- `status`: `started`, `succeeded`, `failed`, `partial`, or `interrupted`.
- `result_summary_json`, `error_message`, `external_id`.
- `started_at`, `completed_at`, and optional `parent_run_id` for retries.

The mutation wrapper creates `started` before calling production, then records
outcome. On startup, stale `started` records become `interrupted`; they are not
assumed failed or safe to retry. History is filterable by action, mode, status,
target, and date.

Recovery behavior:

- There is no generic Undo button.
- Release-year changes may expose Revert only while the current year still
  equals the value written by that run; revert is a new logged action.
- Grant, Backstage, email, lyrics, mark-instrumental, audio reject/replace, and
  instrumental reject are explicitly non-reversible in this plan.
- Non-reversible runs offer Open target, Copy details, and repeatable Dry run
  where applicable.

### 3.6 Preview and confirmation behavior

Replace native confirms with a local modal primitive for actions that require a
review step. It must trap focus, close on Escape only before submission, restore
focus to its trigger, and expose an accessible title/description.

For registry operations:

- A successful dry-run is required before Commit becomes available.
- Preview displays target identity, current state, exact intended change,
  no-op/skip reason, downstream effects, and warnings as structured rows.
- Preview is valid for five minutes and is invalidated immediately when any
  input or selected target changes.
- The server stores the preview in local SQLite with normalized-input hash and a
  state fingerprint. Commit re-runs the preview and rejects with 409 if the
  fingerprint changed.
- Commit copy names production, action, target count, and irreversible effects.
- Destructive single-record actions require a reason; simple corrections do not.

For release-year and other low-risk corrections, save immediately and show a
success toast. Release year gets a ten-second Revert affordance backed by the
precondition above.

Use `sonner` directly in the standalone panel for transient success/error
feedback and mount its `Toaster` in `control-panel/src/main.tsx`. Do not import
product toast components or theme modules.

## 4. Server read contracts

Split parameter parsing and list-query code into cohesive control-panel modules
rather than growing `server/metrics.ts` indefinitely:

- `server/query-params.ts`: shared page/search/sort parsing.
- `server/users-list.ts`
- `server/enrichment-accounts.ts`
- `server/job-lists.ts`
- `server/billing-lists.ts`
- `server/export.ts`

Aggregate metric functions remain in `server/metrics.ts`.

### Users

`GET /api/users/list`

Filters:

- `q`: display name, email, handle, or exact UUID.
- `plan`: exact plan.
- `access`: `unlimited`, `limited`, or `all`.
- `library`: `synced`, `none`, or `all`.
- `onboarding`: `complete`, `incomplete`, `not_started`, or `all`.
- `joinedFrom`, `joinedTo`: ISO date boundaries.
- `lastSeen`: `24h`, `7d`, `30d`, `inactive_30d`, `never`, or `all`.

Sort allowlist: `createdAt`, `lastSeenAt`, `liked`, `playlists`, `unlocks`,
`label`; default `createdAt desc`.

Add `emailVerified` to `UserRow` so recipient and batch eligibility is explicit.

### Library account drill-down

`GET /api/accounts/by-liked`

Retain `min`/`max`; add `q`, page, page size, and sort by `liked`, `playlists`,
`createdAt`, or `label`. Default `liked desc`.

### Enrichment accounts

Move the account list out of the aggregate response:

- `GET /api/metrics/enrichment` keeps totals/spend.
- `GET /api/enrichment/accounts` returns a page.

Filters:

- `q`: account identity.
- `missing`: `audio`, `lyrics`, `analysis`, `embedding`, `any`.
- `minMissing`: integer at least 1.
- `coverageBelow`: percentage 0–100.

Sort allowlist: each missing count, total entitled, overall coverage, label.
Default `missingAnalysis desc`, preserving current behavior.

### Job failures and runs

`GET /api/jobs/failures`

Filters: `q`, `code`, `stage`, `terminal`, `accountId`, `age`, and
`parked` (`actionable`, `parked`, `all`). Default remains actionable, newest
first. Add a Parked tab instead of mentioning only its count.

`GET /api/jobs/runs`

Return individual jobs with ID, account identity, type, status, progress,
created/started/completed/updated/heartbeat timestamps, error, and a derived
`stale` flag. Filters: `q`, `type`, `status`, `stale`, account, and date range.
Sort by created/updated/age; default updated descending.

This phase is read-only. The detail drawer displays structured progress and
related item failures but does not retry or edit a job.

### Billing and grants

Keep aggregate billing metrics and add:

- `GET /api/billing/grants`: account, origin, created/applied timestamps,
  requested-by, note, pending/applied status.
- `GET /api/billing/subscriptions`: account, plan, subscription status,
  unlimited source, period end, cancel-at-period-end, credit balance, and a
  derived synthetic-gift marker based on the existing gift provenance.

Filters/search/sort follow the shared table contract. This plan only improves
visibility; gift revocation remains deferred.

### User songs

Replace the fixed latest-60 payload embedded in User Detail with:

- `GET /api/users/:id` for account summary.
- `GET /api/users/:id/songs` for paged songs.

Filters: title/artist search, access (`unlocked`/`locked`), missing enrichment
stage, and liked date. Sort by liked date or name. Default newest first.

## 5. Section-level UX specification

### 5.1 App shell

- Read section/overlay state from the URL contract.
- Preserve mounted section state where practical; stop key-remounting every
  section solely to replay entrance animations.
- Topbar shows `Updated <relative time>` and a compact spinner while visible
  data refreshes. Refresh errors produce a toast and keep stale content.
- Add `Cmd/Ctrl+K` command palette with instant open/close: navigate sections,
  open a saved view, search/open an account, or focus the current table search.
- The palette never commits an operation. Operation commands navigate to a
  prefilled form that still requires preview and confirmation.
- Add a saved-views menu next to Refresh.
- Keep the production ref visible in the sidebar.

### 5.2 Overview

Keep current headline totals and enrichment coverage. Add a range selector with
`24h`, `7d`, `14d`, and `30d`; default 14d to preserve current behavior.

Compare the selected period with the immediately preceding equal period for:

- Signups.
- Jobs created, completed, and failed.
- Analyses created and analysis spend.

Show absolute current value and signed percentage/absolute delta. When the
previous period is zero, show an absolute delta rather than an infinite percent.

Attention defaults, stored locally and editable from a small settings popover:

- Failed jobs: any.
- Stale running jobs: any using the existing five-minute server definition.
- Actionable item failures: any.
- Pending jobs: only when oldest pending exceeds ten minutes.
- Pending grants: any.
- No-library accounts: only accounts older than 24 hours.

Every attention row links to the exact filtered section URL. No external
notification is sent.

### 5.3 Users

- Replace “All accounts” with `DataTable` and the Users endpoint contract.
- Search input is the primary card action; advanced filters collapse behind a
  Filters button with an active-count badge.
- Clicking a row or account link opens User Detail while preserving the table
  URL.
- User Detail exposes copy buttons for account ID, email, handle, and Spotify ID.
- Show the grant fields already returned by the server: origin, applied time,
  requested-by, and note.
- Add prefilled “Grant access” and “Send email” actions. They navigate to the
  existing sections with the account selected; they do not mutate from User
  Detail.
- Replace the fixed song list with the paginated/searchable User Songs table.

### 5.4 Library

- Keep the distribution and top-library cards.
- Tier drill-down becomes a URL-backed `DataTable` with search, sort, pagination,
  and export.
- Persist the selected tier through reload/Back.
- Top libraries remains a small summary table; its “View all” action opens an
  account list sorted by liked count rather than increasing the summary payload.

### 5.5 Enrichment

- Keep aggregate cards and explanatory copy.
- Move gaps into the paged/filterable endpoint.
- Add quick filter chips for Audio, Lyrics, Analysis, Embedding, and Any.
- Add a coverage-below control and sort by each gap column.
- Clicking a metric card applies its corresponding table filter.
- Export uses the active gap filter.

### 5.6 Job Health

- Keep aggregate cards, failure-code chart, and work-by-type summary.
- Metric cards and failure-code bars apply table filters.
- Add tabs: Actionable failures, Parked failures, Job runs, Recent failed.
- Use `DataTable` for each detailed tab.
- A row opens a drawer with IDs, account, timestamps, full error, structured job
  progress, and related item failures. Include Copy debug details.
- Do not add retry, resolve, suppress, or status-edit actions in this plan.

### 5.7 Billing & Grants

- Keep aggregate plan/origin summaries.
- Add tabs for Grants and Subscriptions using the new list endpoints.
- Grants supports pending/applied/origin filters and links to User Detail.
- Subscriptions highlights synthetic gifts and periods ending within 30 days,
  but remains read-only.
- Pending-grant attention links directly to `status=pending`.

### 5.8 Operations

- Preserve the self-describing registry form.
- Replace raw JSON preview with structured impact rows; keep raw details behind
  a collapsed Debug disclosure.
- Require a current preview before Commit.
- Default requested-by from a locally stored operator label, while allowing an
  override. Keep reason optional for grants but required for future destructive
  registry operations.
- After completion, show a persistent action-run link plus toast; retain the
  form values until the operator explicitly resets them.

### 5.9 Review queues

Create `control-panel/src/components/QueueToolbar.tsx` and shared typed queue
state, while keeping each queue's domain-specific card.

Shared behavior:

- Search title/artist.
- Filter by status and domain evidence.
- Oldest/newest ordering.
- Page size 25/50/100.
- `focus` mode (default): one actionable card with previous/next controls and a
  queue position. Successful action advances to the next card without a full
  section remount.
- `list` mode: current multi-card layout plus selection where safe.
- Persist mode per queue locally.
- Keyboard: `J`/`K` move, `A` approves where approval exists, `/` focuses
  search, `Escape` closes a form/modal. Shortcuts are disabled while typing.
- Destructive actions never commit from one keypress; a shortcut may only open
  the confirmation modal.
- Reviewed tabs are read-only unless an existing explicit correction flow
  already exists.

Audio-specific filters:

- Queue bucket, review status, source type, minimum match score, maximum duration
  delta, and age.
- Approved/rejected history uses the existing status-capable endpoint.
- Batch action: approve selected pending rows only, maximum 200.
- Reject, replace URL, and submit URL remain single-item actions.

Lyrics-specific filters:

- Needs lyrics versus instrumental, source, age, and search.
- No bulk save or mark-instrumental.
- Preserve unsaved text while moving within the queue; warn before discarding it.

Instrumental-specific filters:

- Pending/approved/rejected, signal, instrumentalness threshold, genre, age, and
  search.
- Use `pendingTotal`, not returned-page length, for the header count.
- Batch action: approve selected live pending rows only, maximum 200.
- Reject remains single-item and requires a reason.

Release-year-specific filters:

- Unresolved/pending/set, search, checked age, and year range for set records.
- Save remains single-record. Success advances in focus mode and offers the
  bounded Revert behavior.

### 5.10 Send Email

- Autosave the current draft and selected template ID to localStorage; restore
  on revisit. Clear requires confirmation only when the draft is non-empty.
- Show unsaved-preview/render errors instead of swallowing them; keep the last
  successful preview visible and mark it stale.
- Add “Send test” to an operator-entered test address. A draft's real Send is
  enabled only after a successful test if the recipient count is greater than
  one; single-recipient behavior remains confirm-and-send.
- Record recipient, subject, template ID, Resend ID, and outcome in local action
  history. Do not store body text; store body hash and length.
- Add “Duplicate into composer” from email history.

## 6. Batch execution

Batching is the final phase because it depends on URL filters, exact counts,
selection, action history, and preview/commit safety.

### Local model

Add local SQLite tables:

- `batch_run`: action type, source filter snapshot, status, counts, timestamps,
  preview/commit metadata.
- `batch_target`: batch ID, ordinal, target type/ID/label, status
  (`pending`, `running`, `succeeded`, `failed`, `skipped`, `cancelled`), attempts,
  result summary, error, external ID.

A batch preview resolves the filter server-side and snapshots exact targets into
local SQLite. The UI never submits a list obtained from a prior DB read to a
Supabase `.in()` query.

### API

- `POST /api/batches/preview`
- `POST /api/batches/:id/commit`
- `GET /api/batches/:id`
- `POST /api/batches/:id/cancel`
- `POST /api/batches/:id/retry-failed`
- `POST /api/batches/:id/resume`

Preview returns exact target count, first 100 target labels for inspection,
eligible/skipped counts and reasons, warnings, and estimated action count.
Commit requires the preview ID and unchanged filter/input hash.

The local server processes targets asynchronously with bounded concurrency:

- Grants: concurrency 2, maximum 100 targets per batch.
- Audio/instrumental approvals: concurrency 4, maximum 200.
- Email: concurrency 2, maximum 50 verified recipients.

If the process exits, running targets become `interrupted` on startup. Resume
re-checks target state and only queues targets that are still safe; succeeded
items are never repeated. Cancel affects pending targets only. Retry creates a
child action run for failed targets and never retries rows that returned an
external Resend ID.

### Supported first-release batches

1. **Grant song access** to selected or all-matching Users. Preview shows already
   granted, pending, no-library, eligible, and expected unlock counts. Each
   eligible account runs through the existing shared grant helper.
2. **Approve selected audio reviews.** Approval only; no reject/replace batch.
3. **Approve selected instrumental reviews.** Approval only; no reject batch.
4. **Send one email draft to selected verified Users.** One Resend request per
   recipient, no CC/BCC, exact recipient list, mandatory successful test send
   after the latest draft change, and per-recipient outcome.

Backstage gifts are deliberately excluded from batch actions.

### Progress UI

A persistent topbar progress affordance appears while any batch runs. Its drawer
shows completed/total, succeeded, failed, skipped, and current targets. It
survives section navigation and browser refresh. Poll every second while open and
running, every five seconds while running in the background, and stop polling on
a terminal state.

Partial completion is never presented as success. The terminal state says, for
example, “42 succeeded · 3 failed · 5 skipped,” with Retry failed and Export
results actions.

## 7. Action History section

Add `history` to the Actions navigation group.

The section contains:

- Summary counts for today: commits, dry runs, failed/partial, and active batches.
- Filters for action, mode, status, target text, and date range.
- A paginated local-history table, newest first.
- Detail drawer with normalized input summary, result, error, related batch,
  external/job ID, production ref, and timestamps.
- Open target, Repeat dry run, Duplicate email draft, Copy details, and Revert
  release year when the action's recovery contract permits it.
- Export local history as JSON. Do not offer compliance language or claim that
  the record is authoritative/tamper-proof.

## 8. Error, loading, and edge-case decisions

- Search/filter requests are cancellable. Late responses cannot overwrite newer
  query state.
- Changing any filter resets page to 1.
- If deleting/actioning the final row on a page makes that page empty, move to
  the previous valid page.
- If a selected row disappears after refresh, remove it from selection and
  announce the updated count.
- Select-all-matching always displays the server total and filter summary; it is
  not inferred from loaded rows.
- Invalid saved-view parameters are normalized when opened; unknown sections
  are rejected with a toast rather than silently navigating elsewhere.
- A changed production ref clears in-memory API caches and displays a blocking
  interstitial until acknowledged. Saved views remain valid; previews and
  uncommitted batches from a different ref cannot commit.
- CSV/JSON export is read-only and does not create an action-history row.
- An API failure during background refresh keeps stale data and its original
  “Updated” timestamp.
- Empty batches cannot commit.
- Batch target failures include actionable plain-language messages and preserve
  precise server details in the run drawer.
- Email preview aborts are ignored; real render errors surface. A stale preview
  cannot satisfy the mandatory batch test-send gate.
- Keyboard actions never fire from input, textarea, select, contenteditable, or
  an open confirmation modal.
- Repeated navigation, refresh, and keyboard actions do not replay decorative
  card entrance animation. Honor `prefers-reduced-motion` for remaining motion.

## 9. Implementation sequence

Each task is a reviewable increment. Do not start mutation/batch work before the
read-only UX foundations are stable.

### T1 — URL state and refresh visibility

Progress:

- [x] URL-backed sections, user detail, library tiers, and review queue tabs
- [x] Browser Back/Forward and reload restoration
- [x] API refresh state, fetch timestamps, and production-ref cache invalidation
- [x] Removed animation-only key remounts

Files:

- Add `src/lib/url-state.ts` and tests.
- Update `src/App.tsx`, `src/lib/navigation.ts`, and
  `src/lib/user-selection.ts`.
- Extend `src/lib/api.ts` with `refreshing`, `fetchedAt`, and cache invalidation
  by production ref.
- Update shell/topbar styles; remove key-driven remounts used only for animation.

Done when section, user detail, tier drill-down, and queue tab survive reload and
Back/Forward; refresh state is visible without clearing cached content.

### T2 — DataTable and query parsing foundation

Progress:

- [x] Controlled DataTable with search debounce, sorting, pagination, loading, refresh, empty, and retry states
- [x] Typed page result and validated server query parsing
- [x] CSV escaping and export response helpers with formula-injection tests
- [x] Row selection, select-all-matching, and column preferences

Files:

- Add `src/components/DataTable.tsx` and focused Testing Library tests.
- Add `server/query-params.ts` and unit tests.
- Add page/query types to `src/lib/types.ts` and server modules.
- Add reusable export escaping/response helpers with formula-injection tests.

Done when a fixture table demonstrates accessible sort, search, paging,
selection, stale refresh, no-match empty state, retry, and CSV/JSON download.

### T3 — Users, Library drill-down, and User Detail

Progress:

- [x] Paginated/searchable/sortable Users and Library tier endpoints
- [x] URL-backed Users and Library table state
- [x] Paginated User Songs endpoint and User Detail table
- [x] Filtered Users and Library CSV/JSON exports with the 25,000-row cap
- [x] User identity copy actions and visible grant metadata
- [ ] Full Users filter surface, selection, and batch entry points — filters
      (plan added, collapsed behind a Filters button with active-count badge)
      and selection (select-all-matching) are done; batch execution entry
      points are deferred to T9's batch engine.
- [x] User Detail source-view restoration and prefilled Grant/email actions

Files:

- Extract `server/users-list.ts`; add paged user-song query.
- Update routes in `server/index.ts`.
- Update `UsersSection.tsx`, `AccountList.tsx`, `UserDetail.tsx`.
- Add section/server tests for filter and sort allowlists.

Done when fixed 500/200/60 presentation limits no longer constrain interactive
investigation, exports match active filters, and User Detail links back to the
exact source view.

### T4 — Enrichment, Jobs, and Billing tables

Progress:

- [x] Enrichment accounts moved to a paginated, searchable, sortable endpoint
- [x] Enrichment missing-stage and coverage filters are URL-backed
- [x] Paginated/searchable actionable and parked job-failure endpoint/table
- [x] Individual job runs and read-only detail drawer
- [x] Read-only Billing grants and subscriptions tables
- [x] Billing detail filters and exports

Files:

- Add `server/enrichment-accounts.ts`, `server/job-lists.ts`, and
  `server/billing-lists.ts`.
- Keep aggregate functions in `server/metrics.ts`.
- Update `EnrichmentSection.tsx`, `JobsSection.tsx`, and `BillingSection.tsx`.
- Add a local detail-drawer primitive if one does not already exist; keep it in a
  focused component file, not `primitives.tsx`.

Done when each section can filter, sort, paginate, deep-link, and export its
existing detail data; Jobs includes parked failures and read-only run detail.

### T5 — Overview comparisons, attention thresholds, and saved views

Progress:

- [x] Range-aware period comparison (24h/7d/14d/30d, default 14d) for signups,
      jobs created/completed/failed, and analyses created/spend, with a
      zero-baseline-safe absolute/percent delta
- [x] Attention thresholds are locally editable (settings popover) with the
      documented defaults, including the two age-based rules (pending job age,
      no-library account age) via a small parameterized endpoint
- [x] Saved views (`src/lib/saved-views.ts` + `SavedViewsMenu.tsx`): 30-view
      cap, case-insensitive unique names, confirm-before-replace, menu next to
      Refresh in the topbar

Files:

- Add range-aware aggregate SQL and response types.
- Update `Overview.tsx` and its metric links.
- Add `src/lib/saved-views.ts`, `src/components/SavedViewsMenu.tsx`, and tests.
- Add local threshold settings and tests.

Done when period comparisons are correct at zero baselines, attention links open
exact filtered views, and named views survive reload.

### T6 — Review queue foundation and queue-by-queue adoption

Progress:

- [x] Shared queue foundation: `src/lib/queue-state.ts` (URL-backed tab/search/
      order/paging + localStorage focus/list mode + focus index),
      `src/lib/queue-keyboard.ts` (J/K/A/`/`/Escape, typing- and modifier-guarded),
      `src/components/QueueToolbar.tsx` (debounced search, filters slot, order,
      mode, page size, reset), and `server/query-params.ts#parseQueueQuery`
- [x] Release-year queue: `releaseYearReviewsPage` (search, order, year range,
      paging → `PageResult`); section rewritten with toolbar, focus/list,
      advance-after-save, keyboard
- [x] Lyrics queue: `lyricsReviewsPage` (search, order, source, paging); section
      rewritten with focus/list, keyboard, drafts preserved while moving within
      the queue and a warn-before-discard on Reset
- [x] Instrumental queue: `instrumentalReviewsPage` (status pending/approved/
      rejected, signal + instrumentalness-threshold filters, search, order);
      reviewed tabs are read-only; header count uses `pendingTotal`, not
      returned-page length; `A` approves the focused live card only
- [x] Audio queue: `audioReviewsPage` (status, source type, min match score, max
      duration delta, search, order); approval queue rewritten with toolbar/
      focus/list/keyboard, read-only Approved/Rejected tabs; Needs URL and Failed
      job tabs preserved

Files:

- Add `src/components/QueueToolbar.tsx` and queue state helpers.
- Extend each review list server module with validated query/paging contracts.
- Update Audio, Lyrics, Instrumental, and Release-year sections one at a time.
- Add reviewed-status UI for audio/instrumental and fix instrumental header count
  to use `pendingTotal`.

Adoption order: release year, lyrics, instrumental, audio. Audio is last because
its card and evidence surface are largest.

Done when every queue supports search, URL filters, focus/list modes, stable
advance-after-action, and safe keyboard navigation.

### T7 — Local store, action history, and mutation wrapper

Progress:

- [x] Local SQLite store: `server/local-store/sqlite.ts` (runtime-detecting
      driver — `bun:sqlite` in the Bun server, `node:sqlite` under the Node
      Vitest worker, both built-ins so no new package), `migrations.ts`
      (numbered idempotent migrations + `schema_migration` ledger creating
      `action_run`), `action-runs.ts` (started/complete/mark-stale-interrupted/
      list/get/export/today-summary), `store.ts` (CP_DATA_DIR override, default
      `control-panel/.data/control-panel.sqlite`, init on startup, readiness
      flag). `.gitignore` entry added.
- [x] Typed mutation wrapper `local-store/record.ts#recordAction`: writes a
      `started` row before the prod call and records the outcome after; returns
      503 before any prod side effect when the store is unavailable or the
      started row cannot be written; `redactText` stores email/lyrics body
      length+hash, never text. Applied to every mutating route in
      `server/index.ts` (operations dry_run/commit, email send, audio approve/
      reject/replace, audio submit-url, release-year set, lyrics save/mark-
      instrumental, instrumental approve/reject). Stale `started` rows become
      `interrupted` on startup.
- [x] History API (`server/history-api.ts`): list (filters action/mode/status/
      target/date, paginated newest-first), single run, JSON export, today
      summary. `src/sections/HistorySection.tsx` (summary counts, URL-backed
      DataTable, detail Drawer with input/result/error/external-id/prod-ref/
      timestamps, Open target + Copy details, JSON export). `history` added to
      `SECTION_KEYS` and the Actions nav group. Sonner `Toaster` mounted in
      `src/main.tsx`.

Files:

- Add `server/local-store/` migrations/repository modules and tests against a
  temporary SQLite file.
- Add `.gitignore` entry for `control-panel/.data/`.
- Add a typed mutation wrapper and apply it to every mutating route in
  `server/index.ts`.
- Add History API, `src/sections/HistorySection.tsx`, navigation entry, and
  detail UI.
- Mount Sonner in `src/main.tsx`.

Done when every dry-run, committed operation, review action, manual URL/year/
lyrics write, and email send leaves a local outcome record, including failures
and interrupted-state handling.

### T8 — Preview/commit UX and recovery contracts

Progress:

- [x] Structured operation preview metadata: `server/operation-preview.ts`
      (@/-free, unit-tested) shapes prod facts into impact rows (identity/current/
      change/skip/downstream/warning) plus `inputHash`/`stateFingerprint`.
      `operations.ts` refactored to gather facts once and drive preview + commit.
- [x] Local preview persistence: migration 2 `operation_preview` +
      `server/local-store/operation-previews.ts` (insert/getValid/delete/prune,
      five-minute TTL). Successful dry run persists a preview; changing any input
      or target clears it client-side.
- [x] Preview/commit routes: `POST /api/operations/:id/preview` (records a
      dry_run, stores the preview) and `.../commit` (re-gathers facts, 409s when
      the stored preview is missing/expired, the input hash changed, or the state
      fingerprint moved — no prod write on conflict). Commit returns the
      action-run id for a History deep link.
- [x] `ConfirmModal` primitive (focus trap, Escape-before-submit only, restore
      focus, accessible title/description, optional required reason, non-blocking
      open-modal signal so queue shortcuts bail). Replaces `window.confirm` in
      Operations commit, audio reject/replace, instrumental reject, and lyrics
      mark-instrumental. Reason required for audio + instrumental reject.
- [x] Operations UX: structured preview rows with a collapsed Debug JSON
      disclosure, Commit gated on a current preview, requested-by seeded from a
      locally stored operator label, persistent action-run link + toast, form
      retained until explicit reset.
- [x] Release-year conditional Revert: `setReleaseYear` records `previousYear`;
      `revertReleaseYear` restores it only while current == written (409
      otherwise); a new logged `release-year-revert` action with `parentRunId`.
      Surfaced in History detail when a prior non-null year existed (the
      preservation trigger blocks restoring null).

Files:

- Extend operation definitions/types with structured preview metadata.
- Add local preview persistence, five-minute expiry, input/state fingerprints,
  and commit conflict handling.
- Replace native confirms in Operations and destructive review flows.
- Add release-year conditional Revert.

Done when Commit cannot run without a current matching preview, stale previews
return 409 without writing, and only release-year actions advertise Revert.

### T9 — Batch engine and progress UI

Progress:

- [x] Local batch store: migration 3 (`batch_run` + `batch_target`) and
      `server/local-store/batches.ts` (snapshot insert, live progress from target
      rows, `resumableTargets`/`requeueFailedTargets` guarding external-id rows,
      `cancelPendingTargets`, `finalizeBatch`, and `markStaleBatchesInterrupted`
      reclaiming `running` targets/batches on startup). Tested against a temp DB.
- [x] Adapters `server/batch-adapters.ts` (grant, audio-approve,
      instrumental-approve, email) — each resolves its exact cohort server-side
      (a filter reused from `users-list`, or an explicit id array bound as a
      parameter, never a Supabase `.in()` URL filter) and processes one target
      through the same shared helper as the single-item route. Caps/concurrency
      per adapter (grants 2/100, approvals 4/200, email 2/50).
- [x] Orchestration `server/batches.ts`: preview snapshots targets + enforces the
      cap (422); commit gates on the snapshot (empty/non-preview/wrong-ref refuse)
      and runs an async bounded-concurrency runner; cancel/resume/retry-failed
      with a single-runner-per-batch guard; email commit gated on a matching
      test-send body hash. Runner + gate covered by `__tests__/batches.test.ts`.
- [x] API routes: `POST /api/batches/preview`, `/:id/commit`, `/:id/cancel`,
      `/:id/retry-failed`, `/:id/resume`, `GET /api/batches/:id`,
      `GET /api/batches` (active), and `POST /api/email/test` (the test-send gate).
- [x] UI: `src/lib/batch.ts` client + a localStorage-backed `batchTracker`;
      `BatchLauncher` (preview → structured impact → confirm → commit, with the
      mandatory email test-send step); `BatchProgressDrawer` mounted in `App.tsx`
      (persists across navigation/reload, polls 1s while running, Resume/Retry/
      Cancel/Export/Dismiss, partial never shown as success). Selection entry
      points: grant-batch from Users selection/select-all-matching; approve-batch
      from the audio and instrumental list-mode pending selections.

Files:

- Add local batch tables/repository/runner and API routes.
- Add table selection actions for Users and safe review queues.
- Add persistent batch progress drawer.
- Add grant, audio approval, instrumental approval, and email adapters in that
  order, with adapter-specific tests.

Done when runs survive navigation/reload, process exits become resumable
interrupted states, partial failures are explicit, retry skips successes, and
caps/concurrency rules are enforced server-side.

### T10 — Email draft/test/history polish and command palette

Progress:

- [x] Email composer draft + template persistence (`hearted-control-panel.email-draft.v1`), confirmed non-empty clear, stale last-good preview errors, operator test sends, and verified-recipient batch composition. Batch previews reuse the T9 test hash gate; any draft change requires a fresh test before commit.
- [x] Email sends record recipient, subject, template, redacted body hash/length, Resend ID, and outcome. History can duplicate a browser-local sent draft into the composer without storing body text in SQLite.
- [x] `CommandPalette` with Cmd/Ctrl+K, input/modal guards, section and saved-view navigation, verified-account opening, and current-table search focus; it exposes no direct mutation commands. Focused UI and persistence behavior have tests.

Files:

- Update `EmailSection.tsx` for draft persistence, preview error state, mandatory
  batch test-send, and history duplication.
- Add `src/components/CommandPalette.tsx` and tests.
- Update App shell keyboard handling and saved-view commands.

Done when a draft survives navigation, batch email cannot commit after the draft
changes without another test, and `Cmd/Ctrl+K` reaches sections, accounts, and
saved views without exposing direct mutation shortcuts.

## 10. Verification gates

For every task:

```bash
bunx tsc -p control-panel/tsconfig.json --noEmit
bun run test
bun run check
```

Add tests under `control-panel/src/**/__tests__/` for UI/state behavior and
`control-panel/server/__tests__/` for query parsing, SQL semantics, export,
local history, previews, and batches.

Before declaring the initiative complete:

1. Run all three commands above.
2. Start with `bun run control-panel` and manually verify each section against
   production in read-only interactions first.
3. Verify URL reload/Back, saved views, table exports, focus mode, and keyboard
   guards.
4. Use dry-run/no-op targets for operation and batch verification before any
   committed production mutation.
5. Verify a deliberately mixed batch yields succeeded/failed/skipped counts and
   retries only failed rows.
6. Stop the local server mid-test batch, restart, and verify interrupted/resume
   behavior without repeating successes.
7. Confirm no new runtime `@/` imports were added under `control-panel/` beyond
   the currently documented exceptions.

## 11. Completion criteria

- Existing sections retain their current domain semantics and metrics.
- Data-heavy tables are searchable, filterable, sortable, paginated,
  deep-linkable, and exportable without fixed presentation caps.
- Browser navigation and local saved views preserve investigation context.
- Review queues support focused high-throughput operation without making
  destructive actions easier to trigger accidentally.
- Mutation outcomes and batch progress persist locally across navigation and
  restart.
- Existing writes gain clearer preview/confirmation; no new generic mutation
  surface is introduced.
- The panel remains local-only, standalone, and isolated from additional
  product `@/env` runtime dependencies.

## 12. Resolved decisions

- Local-only is a hard product boundary for this initiative.
- Deployment/auth/network work is postponed.
- Read-only UX foundations land before additional batch mutation volume.
- URL query parameters are the canonical navigation/filter state; no router
  dependency is added.
- Filters/sorts/pagination execute server-side; export uses the same filter
  contract and fails rather than truncating above 25,000 rows.
- UI preferences use localStorage; action and batch history use local SQLite.
- Local history is for operator recall and recovery, not compliance.
- No generic Undo exists; only release year has a defined conditional Revert in
  this plan.
- Safe batch scope is grants, approval-only reviews, and bounded one-recipient-
  per-request email. Destructive review actions and Backstage gifts remain
  single-target.
- Job detail and gift expiry visibility are read-only; mutation semantics are
  deferred to separate domain plans.
