# Implementation Plan: account liked song access grant

> **Future-state plan.** `account_liked_song_access_grant`, `grant_liked_song_access(...)`, and the sync-time waitlist auto-apply flow do not exist yet.

## TL;DR

- **Benefit record table:** `account_liked_song_access_grant`
- **Unlock source:** `grant`
- **RPC:** `grant_liked_song_access(...)`
- **Automatic behavior:** yes, matching waitlist users are auto-applied on successful sync
- **Manual behavior:** operators can grant it to existing accounts, including unsynced ones
- **Non-goal for v1:** no generic cross-benefit grant system yet

## How it works

### Automatic waitlist path

The benefit is **not** applied at waitlist signup time.

Instead:

1. a user joins the waitlist with an email
2. later they create an account with that same email
3. on a successful library sync, the app checks waitlist eligibility using normalized email matching
4. if eligible, the app grants access to the account's top 500 currently liked songs
5. if the account somehow has no active liked songs yet, the grant row stays pending and is applied on the next successful sync

### Manual path

An operator can target an existing account by email, account id, or Spotify id.

- if the account already has liked songs, the grant applies immediately
- if the account exists but has not synced yet, a pending row is created
- the next successful sync applies the pending grant automatically

## Naming decisions

Use:

- **table:** `account_liked_song_access_grant`
- **unlock source:** `grant`
- **RPC:** `grant_liked_song_access(...)`

Avoid:

- `waitlist_*` names — too narrow
- `gift`, `bonus`, `promo`, `campaign` — too marketing-flavored
- `pack` — already has paid-pack meaning in this repo
- `allocation` — already overloaded elsewhere in billing/conversion flows

## Must NOT

- Do not edit historical migrations in place
- Do not reuse `account_song_unlock.source = 'pack'`
- Do not apply the benefit on waitlist insert
- Do not rely only on write-time email casing; eligibility must normalize at query time too
- Do not overwrite an existing grant row's origin/audit fields on rerun

## Core behavior decisions

### One row per account

`account_liked_song_access_grant` is a benefit-scoped state record, not a general ledger.

- one account can have at most one row
- row existence means the account has already been considered for this benefit
- `applied_at IS NULL` means pending
- `applied_at IS NOT NULL` means applied

### First writer wins for audit metadata

The first creation of the row owns:

- `origin`
- `requested_by`
- `note`
- `created_at`

Later reruns should:

- detect the existing row
- preserve the original metadata
- return status only

This avoids a later manual rerun rewriting a prior `waitlist_auto` row, or vice versa.

### Snapshot semantics

The benefit applies to the account's **current** top 500 active liked songs at the moment the grant is applied.

- `liked_song.account_id = p_account_id`
- `liked_song.unliked_at IS NULL`
- ordered by `liked_at DESC`
- limited to 500

If some or all of those songs are already unlocked, that is fine.

Once the 500-song candidate snapshot resolves successfully, the row should still be marked applied.

## Schema changes

All schema work should be done in **new migrations**.

### 1) New table: `account_liked_song_access_grant`

Columns:

- `account_id uuid primary key references account(id) on delete cascade`
- `origin text not null check (origin in ('waitlist_auto', 'operator_manual'))`
- `requested_by text null`
- `note text null`
- `created_at timestamptz not null default now()`
- `applied_at timestamptz null`

RLS posture:

- enable RLS
- add a deny-all policy

This is required both for consistency with private billing tables and for `src/lib/data/__tests__/security-invariants.integration.test`.

### 2) Add `grant` as a valid unlock source

Update `account_song_unlock.source` via a new migration so the check constraint includes:

- `grant`

Then replace `insert_song_unlocks_without_charge(...)` so its runtime guard also allows:

- `grant`

Do **not** edit:

- `supabase/migrations/20260405100000_billing_core_tables.sql`
- `supabase/migrations/20260405160000_core_unlock_rpcs.sql`

Instead create new migrations that alter/replace the live schema and functions.

### 3) Waitlist normalization hardening

Current waitlist storage is raw email text.

Add a new migration that:

1. dedupes normalized collisions using `lower(btrim(email))`
2. preserves the **earliest** row per normalized email
3. replaces raw uniqueness with a normalized unique index

Recommended index expression:

```sql
lower(btrim(email))
```

## RPC design

Create:

- `grant_liked_song_access(...)`

Suggested signature:

```sql
grant_liked_song_access(
  p_account_id uuid,
  p_origin text,
  p_requested_by text default null,
  p_note text default null
) returns jsonb
```

Implementation requirements:

- `SECURITY DEFINER`
- `SET search_path = public`
- atomic transaction semantics inside the function

### Return shape

Use a discriminated JSON payload such as:

```json
{ "status": "applied", "candidate_count": 500, "newly_unlocked_song_ids": ["..."] }
```

Statuses:

- `applied`
- `already_applied`
- `pending_no_liked_songs`

### RPC flow

1. insert the grant row if absent
2. select the row `FOR UPDATE`
3. if `applied_at` is already set, return `already_applied`
4. select top 500 current active liked songs
5. if zero songs, return `pending_no_liked_songs` and leave `applied_at` null
6. call `insert_song_unlocks_without_charge(..., p_source = 'grant')`
7. set `applied_at = now()`
8. return `applied` with candidate count and newly unlocked ids

### Important nuance

The function must mark the grant applied even when:

- some candidate songs were already unlocked
- all candidate songs were already unlocked

The benefit is the one-time snapshot decision, not strictly the creation of net-new unlock rows.

## Waitlist eligibility rules

Eligibility should be checked against `account.email`, not the sync payload.

Reason:

- the current sync route does not persist `payload.userProfile.email`
- `account.email` already exists from Better Auth signup

### Eligible when all are true

- `account.email` is not null
- a waitlist row exists where `lower(btrim(waitlist.email)) = lower(btrim(account.email))`
- `waitlist.created_at <= account.created_at`
- no `account_liked_song_access_grant` row exists yet for the account

### Pending grant precedence

On sync:

1. first try to apply any existing pending grant row
2. only if no row exists, evaluate waitlist eligibility

That ensures a prior manual pending grant is never blocked by waitlist ineligibility.

## App code changes

### 1) Normalize waitlist writes

Update:

- `src/lib/server/waitlist.functions.ts`

Behavior:

- insert `email.trim().toLowerCase()`
- duplicate normalized email still returns success

### 2) Add a billing domain module

Create:

- `src/lib/domains/billing/liked-song-access-grant.ts`

Suggested responsibilities:

#### `grantLikedSongAccessForAccount(...)`

Shared by:

- sync flow
- CLI

Behavior:

- call `grant_liked_song_access(...)`
- if `newly_unlocked_song_ids.length > 0`, emit `BillingChanges.songsUnlocked(accountId, ids)`
- if the downstream library-processing change fails, log it and preserve the DB grant result

That matches the repo's current best-effort pattern for non-transactional workflow side effects.

#### `maybeGrantLikedSongAccessAfterSync(...)`

Used only by sync.

Behavior:

1. check for an existing pending grant row; if present, try to apply it
2. otherwise check waitlist eligibility
3. if eligible, call the shared grant helper with `origin = 'waitlist_auto'`
4. log on failure and never fail the sync response

### 3) Wire into sync success path

Update:

- `src/routes/api/extension/sync.tsx`

Placement:

- after the sync data has been written
- after `applyLibraryProcessingChange(SyncChanges.librarySynced(...))` succeeds

Flow becomes:

1. sync liked songs / playlists / tracks
2. emit the existing `library_synced` change
3. call `maybeGrantLikedSongAccessAfterSync(...)`
4. return success regardless of grant failure

This is the automatic waitlist path.

### 4) Skip the normal 10-song onboarding free allocation

Update:

- `src/lib/domains/library/accounts/onboarding-allocation.ts`

Before `grantFreeAllocation(...)`:

- check whether an `account_liked_song_access_grant` row exists
- if yes, skip the 10-song free allocation

Use **row existence**, not only `applied_at`, so the benefit never stacks into `500 + 10` even if the row is still pending.

## CLI plan

Create:

- `scripts/grant-liked-song-access.ts`

Match the operator UX style of:

- `scripts/reset-onboarding.ts`

### Supported selectors

- positional email
- `--account-id <uuid>`
- `--spotify-id <spotify-user-id>`

### Optional flags

- `--reason "..."`
- `--requested-by "..."`
- `--dry-run`

### CLI behavior

1. resolve the account
2. print account summary
3. if `--dry-run`, show what would happen and exit without creating a row
4. otherwise call the shared grant helper
5. print one of:
   - `applied`
   - `already_applied`
   - `pending_no_liked_songs`

### Important detail

Email lookup in the CLI should be normalized/case-insensitive, not raw `eq("email", input)`.

## Queue priority

Defer this for v1 unless product explicitly wants it now.

If added later, the rule should be:

- applied `account_liked_song_access_grant` bumps queue band from `low` to `standard`

That would require updating both:

- `src/lib/domains/billing/queries.ts`
- `reprioritize_pending_jobs_for_account(...)` via a new migration

If that change is ever added, the apply path should also call `reprioritize_pending_jobs_for_account(...)` after `applied_at` is set.

## Tests

### DB / integration

- first apply on a synced account returns `applied` and unlocks top 500
- unsynced existing account returns `pending_no_liked_songs` and creates a pending row
- next sync after pending row applies the grant
- rerun after apply returns `already_applied`
- library with fewer than 500 songs unlocks all of them and marks applied
- all candidate songs already unlocked still marks applied and creates no duplicate unlock rows
- reruns do not overwrite `origin`, `requested_by`, or `note`

### Waitlist

- case-mismatched email still matches
- whitespace differences still match
- waitlist row created before account creation is eligible
- waitlist row created after account creation is not eligible
- duplicate normalized waitlist email preserves the earliest row
- manual pending grant applies even if the account is not waitlist-eligible

### Sync route

- successful sync triggers the post-sync grant helper
- grant helper failure does not fail the sync response
- pending grant is attempted before waitlist eligibility lookup

### Onboarding

- free 10-song allocation is skipped when a grant row exists

### CLI

- resolves by email
- resolves by account id
- resolves by Spotify id
- dry-run is read-only
- prints `pending_no_liked_songs` / `applied` / `already_applied` correctly

## Files likely touched

### New migrations

- create `account_liked_song_access_grant`
- extend `account_song_unlock.source` with `grant`
- replace `insert_song_unlocks_without_charge(...)`
- create `grant_liked_song_access(...)`
- normalize waitlist uniqueness

### App code

- `src/lib/server/waitlist.functions.ts`
- `src/routes/api/extension/sync.tsx`
- `src/lib/domains/library/accounts/onboarding-allocation.ts`
- new: `src/lib/domains/billing/liked-song-access-grant.ts`

### Script

- new: `scripts/grant-liked-song-access.ts`

### Generated

- `src/lib/data/database.types.ts`

## Recommended implementation order

1. create the new grant table migration with RLS + deny-all policy
2. create the waitlist normalization migration
3. create the unlock-source migration that adds `grant` and replaces `insert_song_unlocks_without_charge(...)`
4. create the `grant_liked_song_access(...)` RPC migration
5. run `bun run gen:types`
6. update `src/lib/server/waitlist.functions.ts` to normalize waitlist writes
7. add `src/lib/domains/billing/liked-song-access-grant.ts`
8. wire the new helper into `src/routes/api/extension/sync.tsx`
9. update onboarding allocation skip logic in `src/lib/domains/library/accounts/onboarding-allocation.ts`
10. add `scripts/grant-liked-song-access.ts`
11. add tests for DB, sync, onboarding, and CLI behavior
12. run the smallest relevant verification steps:
    - `bun run test`
    - targeted typecheck if needed

## Final shape in one sentence

Use one benefit-scoped account grant record plus one atomic `grant_liked_song_access(...)` RPC, then wire it to both sync-time waitlist auto-apply and a manual Bun CLI for existing accounts.