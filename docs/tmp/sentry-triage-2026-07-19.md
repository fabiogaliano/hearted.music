# Sentry triage — f-inc/hearted-music

Date: 2026-07-19 · 9 unresolved issues · diagnosis only, no code changed.

## Tooling

The `sentry` CLI (v0.38.0, `~/.local/bin/sentry`) is installed and authenticated
as fbkzdev@gmail.com on org `f-inc`. This is the newer CLI (binary `sentry`), not
the legacy `sentry-cli` — that one is not installed and is not what the
`sentry-cli` skill documents.

```bash
sentry issue list f-inc/hearted-music --query "is:unresolved" --sort freq
sentry issue view HEARTED-MUSIC-19          # full trace + source context
sentry issue events HEARTED-MUSIC-19 --full # all events for an issue
```

Two gotchas found while pulling this data:

- `issue list` returns **blank event counts and timestamps** (`count`, `lastSeen`,
  `firstSeen` come back null even with `-f`). It is the endpoint, not the cache.
  Real numbers only appear in `issue view`, which is why the table below was
  assembled issue-by-issue.
- `--json` wraps results in `{data, hasMore, hasPrev}`, not a bare array — jq
  filters need `.data[]`.

Seer AI (`issue explain` / `issue plan`) is likely gated on the free plan; it was
not used here. Everything below came from stack traces + reading the code.

## Summary

| ID | Events | Users | Last seen | Env | Verdict |
|---|---|---|---|---|---|
| [-15](#hearted-music-15) | 1899 | 2 | Jul 16 | **development** | Noise — quota drain |
| [-18](#hearted-music-18) | 54 | 1 | Jul 13 | **development** | Unmigrated local DB |
| [-12](#hearted-music-12) | 17 | 1 | Jul 2 | production | **Already fixed** |
| [-17](#hearted-music-17) | 12 | 0 | Jul 9 | production | Deploy ordering |
| [-G](#hearted-music-g) | 11 | 0 | Jun 19 | production | Stale, likely gone |
| [-19](#hearted-music-19) | 1 | 1 | Jul 18 | production | **Real, open** |
| [-16](#hearted-music-16) | 1 | 0 | Jul 9 | production | Needs stderr |
| [-14](#hearted-music-14--hearted-music-13) | 1 | 0 | Jul 2 | production | Stale chunk |
| [-13](#hearted-music-14--hearted-music-13) | 1 | 0 | Jul 2 | production | Same event as -14 |

**The headline: ~98% of your Sentry volume is local development noise.** -15 and
-18 together are 1953 of ~1997 total events, and both are tagged
`environment: development` from `http://127.0.0.1:5173`. On the free plan's error
quota that is by far the highest-leverage thing to fix, and it costs no
production code change.

Only **one issue (-19) is an open production defect with user impact.**

---

## HEARTED-MUSIC-15

`APIError: Failed to get session` — 1899 events, 2 users, Jul 9–16.

**Not a production issue.** Tags: `environment: development`,
`url: http://127.0.0.1:5173/_serverFn/...`, `runtime.name: cloudflare`,
SDK `sentry.javascript.cloudflare`. These are your local dev server (the Vite +
workerd runner) reporting to production Sentry.

Capture site is `src/lib/platform/auth/auth.server.ts:79`:

```ts
} catch (error) {
    const message = errorMessage(error);
    console.warn("Failed to get auth session:", message);
    captureServerError(error, { area: "auth", operation: "load_auth_session" });
    return null;
}
```

The comment above it explains the intent — with `enableLogs: false` on the server
a widespread auth/DB outage would otherwise be invisible, so it captures and still
returns null. That reasoning is sound for production. The problem is purely that
dev traffic reaches the same DSN.

Note the shape: 1899 events across **2 users** over 7 days. That is a hot loop,
not scattered failures — every server-fn call on a broken local auth/DB connection
captures once. One `bun run dev` session with Supabase down could produce most of
this.

`.env` currently has `VITE_SENTRY_DSN` and `SENTRY_DSN` commented out (file
modified ~Jul 14, and this issue stops Jul 16), so this may already be mitigated.
Worth confirming the *server* DSN specifically, since these events came from the
Cloudflare/server SDK rather than the browser one.

`sentry.client.ts:36` sets `environment: VITE_SENTRY_ENVIRONMENT ?? MODE` but
there is no gate that prevents dev from *sending*. Options: leave the DSN unset in
dev (current approach), or add an explicit `enabled: import.meta.env.PROD` to the
init so a stray DSN can't leak dev traffic again.

**Action:** confirm no DSN is set in dev, then resolve. Consider an inbound filter
on `environment:development` in Sentry project settings as a belt-and-braces
quota guard.

## HEARTED-MUSIC-18

`DatabaseError: Could not find the function public.get_account_release_year_counts(p_account_id) in the schema cache`
— 54 events, 1 user, Jul 13.

**Not a production issue.** `environment: development`,
`url: http://127.0.0.1:5173/playlists/new`.

The migration exists in the repo:
`supabase/migrations/20260713000000_account_release_year_counts_rpc.sql` — dated
the same day as the errors. The local DB simply had not been migrated when the
calling code ran. Call site is
`src/lib/domains/library/liked-songs/taste-profile-queries.ts:140`, reached from
`playlists.functions.ts:1268` inside a `Promise.all`.

**Secondary finding worth its own fix:** the stack frames for this issue show
**local absolute paths** —
`/Users/f/Core/dev/projects/hearted./v1_hearted/src/lib/...` — instead of
repo-relative paths like the other issues (`../../../src/lib/...`). That means
this build's source maps were uploaded without the path-prefix rewrite. It will
keep degrading traces from this entrypoint and leaks your local directory
structure into Sentry.

**Action:** resolve (dev-only, already migrated). Separately, check the
`sentryTanstackStart` source-map config in `vite.config.ts` for the dev/SSR path
rewrite.

## HEARTED-MUSIC-12

`DatabaseError: URI too long` — 17 events, 1 user, Jul 2, production.

**Already fixed — safe to resolve.**

This is your own `CLAUDE.md` rule firing in production: *"DB-derived id sets must
never re-enter a query as `.in()` URL filters."* At release `75a3d92d`,
`filterDismissedActiveSuggestions` built two `.in()` filters straight from a
DB-derived list:

```ts
.eq("decision", "dismissed")
.eq("song_id", subject.songId)
.in("playlist_id", suggestions.map((s) => s.playlistId))
```

With a large enough suggestion capture the request line exceeded the nginx/Kong
limit and PostgREST returned 414, surfacing as `URI too long` through
`mapPostgrestError` (`src/lib/shared/utils/result-wrappers/supabase.ts:105`).

Both the function and its caller were deleted in `ad503918`
*("refactor(match): delete legacy queue machinery replaced by the deck model
(phase 5)")*. The replacement, `readQueueItemSongSuggestions`
(`src/lib/domains/taste/match-review-queue/queries.ts:656`), pushes the entire
predicate into the `read_match_review_item_song_suggestions` RPC — visible pairs,
dismissed anti-join, ordering and paging all inside Postgres, so no id set leaves
the database.

A regression guard was also added at `src/lib/data/client.ts:11-33`: an 8000-char
request-URL check on the admin client, active in dev/test only, that throws with a
pointer to the CLAUDE.md rule. Good — the failure now surfaces locally instead of
as a prod 414.

**Action:** resolve. Ideally `sentry issue resolve HEARTED-MUSIC-12 --in <release>`
so a genuine regression gets flagged rather than silently reopening.

## HEARTED-MUSIC-17

`Error: relation "account_event" does not exist` — 12 events, Jul 9, 16:24–16:54,
production Bun worker (release `e9b1e5ae`, bun 1.3.14).

**Deploy-ordering, self-resolved.** The migration exists:
`supabase/migrations/20260708000026_create_account_event_outbox.sql`, dated Jul 8
— one day *before* the errors. The worker rolled out and started running against a
database where that migration had not yet been applied.

Thrown at `src/lib/workflows/library-processing/runner.ts:89`, where a failed
`mark-completed` is escalated to a throw. The 30-minute window and clean stop
indicate the migration landed and the errors ceased.

**Worth noting:** the breadcrumbs show console errors at a **steady ~1/second**
for the whole window. `tryRequeueForRetry` (runner.ts:64) requeues while attempts
remain, and against a permanently-missing relation that becomes a hot retry loop
until `max_attempts` is exhausted per job. It was self-limiting here, but a
schema-level error (`42P01`) is never going to succeed on retry — worth
considering whether that error class should fail terminally rather than consume
the retry budget at 1/sec.

**Action:** resolve. Optionally revisit deploy ordering so migrations apply before
worker rollout.

## HEARTED-MUSIC-G

`Hydration failed - the server rendered HTML didn't match the client.` — 11 events,
May 21 – Jun 19, production, `/match`, release `d6dc206f`.

**Stale.** Last seen a month ago, on a release that predates the deck-model
rewrite (`ad503918`) — the `/match` surface this fired on has since been
substantially rebuilt. A replay exists (`aa35096f0c354082a3986cbdee2ec1cb`) if you
want to confirm the cause, but the rendering path has changed underneath it.

**Action:** archive with `--until auto` so it reopens only if it recurs on the
current match surface:
`sentry issue archive HEARTED-MUSIC-G --until auto`

## HEARTED-MUSIC-19

`DatabaseError: canceling statement due to lock timeout` in `grantFreeAllocation`
— 1 event, 1 user, Jul 18 23:39, production (release `6f5f2cdf`).

**This is the only open production defect with real user impact, and it is the
most recent issue in the project.**

Path: `completeOnboardingWithAllocations`
(`src/lib/domains/library/accounts/onboarding-allocation.ts:80`) →
`grantFreeAllocation` (`src/lib/domains/billing/unlocks.ts:234`) → RPC
`insert_song_unlocks_without_charge`.

That RPC (latest definition in
`supabase/migrations/20260601154305_add_grant_unlock_source.sql:19`) is a single
statement:

```sql
INSERT INTO account_song_unlock (account_id, song_id, source, granted_stripe_event_id)
SELECT p_account_id, s, p_source, p_granted_stripe_event_id
FROM unnest(p_song_ids) AS s
ON CONFLICT (account_id, song_id) DO UPDATE ...
```

`ON CONFLICT DO UPDATE` takes row locks on conflicting rows. The timeout means
another transaction held locks on those `(account_id, song_id)` rows longer than
the configured `lock_timeout`. No `lock_timeout` is set anywhere in the repo — it
comes from the self-hosted Postgres/Supabase server config on the Coolify VPS.
(For contrast, `20260629000000_raise_service_role_statement_timeout.sql` sets
`service_role` `statement_timeout = '120s'`, so this is specifically *lock* wait,
not total statement time.)

**User impact is silent.** The error is caught and reported, and onboarding
continues:

```ts
if (Result.isError(allocationResult)) {
    console.error("[onboarding] Free allocation failed:", allocationResult.error);
    // Free-plan user silently loses their baseline song allocation.
    captureServerError(allocationResult.error, { ... });
}
```

The comment already acknowledges it — a free-plan user finishes onboarding with
**zero unlocked songs** and no error shown. Only one user is affected so far, but
this is a first-run experience failure, and it is the newest issue.

**Open questions to investigate:**
- What else writes `account_song_unlock` for the same account concurrently? The
  library-processing worker and `applyLibraryProcessingChange` are candidates.
- Is onboarding completion idempotent against double-submit? Two concurrent
  `grantFreeAllocation` calls for one account would contend on exactly these rows.
- Should this specific failure retry, given the allocation is idempotent
  (`ON CONFLICT ... WHERE revoked_at IS NOT NULL`)? A retry is safe here, and
  a lock timeout is the textbook transient worth retrying.

**Action:** highest-priority fix. Identify the contending writer before deciding
between a retry, a serialization guard on onboarding, or an advisory lock.

## HEARTED-MUSIC-16

`pg_dump exited with code 1 during startup-catch-up.` — 1 event, Jul 9,
production worker (`feature: db-backup`, Debian 13.4, bun 1.3.14).

Spawned at `src/worker/db-backup.ts:499`:

```ts
Bun.spawn(["pg_dump", "--format=custom", "--file", temporaryPath, "--no-password"], {
    env: pgEnv, stderr: "pipe", stdout: "ignore",
});
```

**The actual cause is not recoverable from this event** — the message reports only
the exit code. `stderr` is piped, so if it is being read it should be attached;
if it is not, that is the fix to make first, because otherwise every future
backup failure is equally undiagnosable.

Most likely candidates, in order: pg_dump client version older than the server
(very common on self-hosted Supabase, and it exits 1 with a clear stderr message);
or the connection-kind problem the code already guards against at line 322
(transaction pooler on 6543 instead of a direct/session connection on 5432) — the
guard exists but only covers the URL it can parse.

Single occurrence during `startup-catch-up`, so a later scheduled backup presumably
succeeded. **Verify a recent backup actually exists** before treating this as
benign — a silently missing backup is worse than the error suggests.

**Action:** confirm recent backups on disk; attach pg_dump stderr to the Sentry
report so the next failure is diagnosable.

## HEARTED-MUSIC-14 / HEARTED-MUSIC-13

`TypeError: error loading dynamically imported module: https://hearted.music/assets/dist-DwgSDvZd.js`
and `TypeError: NetworkError when attempting to fetch resource.` — 1 event each,
Jul 2 04:32:45, production.

**These are one incident, not two.** Identical timestamp (same second), identical
release (`75a3d92d`), identical replay ID (`242ad7bf22d647a48e000722455c4e5a`),
same browser (Firefox 151, Mac), same page (`/dashboard`, route
`_authenticated/match`).

Classic stale-chunk-after-deploy: a user had the app open across a deploy, the
hashed asset `dist-DwgSDvZd.js` no longer existed, the route's dynamic import
404'd (-14, handled), and the resulting rejection surfaced unhandled as -13
(`mechanism: auto.browser.global_handlers.onunhandledrejection`).

Not a code defect. The standard remedy is a chunk-load-error boundary that
triggers a reload once when a dynamic import fails, so users mid-session recover
instead of hitting a dead route.

**Action:** merge them so they triage as one signal, then archive:

```bash
sentry issue merge HEARTED-MUSIC-14 HEARTED-MUSIC-13 --into HEARTED-MUSIC-14
sentry issue archive HEARTED-MUSIC-14 --until 10x
```

---

## Recommended order

1. **Stop the dev-noise drain (-15, -18)** — ~98% of quota, zero production risk.
   Confirm the server DSN is unset in dev; add an `environment:development`
   inbound filter as a backstop.
2. **Fix -19** — the only open production defect with user impact, and the newest.
   Free-plan users are silently getting no baseline allocation.
3. **Check -16** — verify a recent backup exists; attach pg_dump stderr.
4. **Close the resolved ones** — -12 (fixed by `ad503918`, resolve `--in` a
   release), -17 (migration landed), -14/-13 (merge + archive), -G (archive
   `--until auto`).
5. **Source-map path rewrite** — surfaced by -18; affects future trace quality.

Two things that came out of this that are not issues in the list but worth
considering: the retry loop in `runner.ts` burning attempts at ~1/sec on a
permanently-failing schema error (-17), and whether onboarding is guarded against
concurrent completion (-19).
