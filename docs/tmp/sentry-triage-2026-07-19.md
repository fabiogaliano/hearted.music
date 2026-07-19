# Sentry triage — f-inc/hearted-music

Date: 2026-07-19 · 9 unresolved issues · diagnosed, then fixed.

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

Gotchas found while pulling this data:

- `issue list` returns **blank event counts and timestamps** (`count`, `lastSeen`,
  `firstSeen` are null even with `-f`). It is the endpoint, not the cache. Real
  numbers only appear in `issue view`.
- `--json` wraps results in `{data, hasMore, hasPrev}`, not a bare array.
- **`extra` context is only in the JSON**, never the human-readable output. This
  matters: `sentry issue view HEARTED-MUSIC-16` shows only an exit code, but
  `--json` carried the full pg_dump stderr that explained the failure. Reach for
  `--json | jq '.. | objects | select(has("<key>"))'` before concluding an event
  is undiagnosable.

Seer AI (`issue explain` / `issue plan`) is likely gated on the free plan; it was
not used. Everything below came from stack traces, event JSON, and reading code.

## Summary

| ID | Events | Users | Env | Diagnosis | Outcome |
|---|---|---|---|---|---|
| -15 | 1899 | 2 | **dev** | Dev traffic hitting the prod DSN | Fixed — gated |
| -18 | 54 | 1 | **dev** | Local DB not migrated | Fixed — gated |
| -12 | 17 | 1 | prod | `.in()` on DB-derived ids → 414 | Already fixed |
| -17 | 12 | 0 | prod | Migration hadn't reached prod | Resolved by deploy |
| -G | 11 | 0 | prod | Hydration mismatch on old `/match` | Stale |
| -19 | 1 | 1 | prod | Lock timeout lost the free grant | Fixed — retry |
| -16 | 1 | 0 | prod | DB not up when worker booted | Fixed — retry |
| -14/-13 | 1+1 | 0 | prod | Stale chunk after deploy | Fixed — reload |

**~98% of event volume was local development traffic.** -15 and -18 together were
1953 of ~1997 events, all tagged `environment: development` from
`http://127.0.0.1:5173`. On the free plan's quota this was the single highest-
leverage fix, and it needed no production code change.

Only **one issue (-19) was an open production defect with user impact.**

## Corrections to the first pass

Three initial conclusions were wrong. Recording them because each was a case of
reasoning from a plausible pattern instead of checking the evidence.

1. **-16 was not undiagnosable, and not a version mismatch.** The first pass said
   stderr wasn't attached and guessed at a pg_dump/server version skew. Both
   wrong — `db-backup.ts:591` already attaches stderr as Sentry `extra`, and it
   was in the event JSON the whole time. The real cause was
   `server closed the connection unexpectedly`: the worker booted before Postgres
   was accepting connections.
2. **-17's retry path was never a hot loop.** The first pass claimed
   `tryRequeueForRetry` burned the retry budget at 1/sec. In fact
   `settlement.ts:41` already applies linear backoff
   (`available_at = now() + 30s * attempts`). The 1/sec breadcrumb stream was the
   account-events publisher's `FALLBACK_POLL_MS = 1000` fallback poll logging
   each failed tick during the schema outage — expected behaviour.
3. **Production source maps are fine.** The first pass flagged local absolute
   paths (`/Users/f/Core/...`) in -18's frames as a broken path rewrite. -18 is a
   *development* event, where those paths are correct. Every production issue
   resolves properly: `../../../src/lib/...` on Cloudflare, `/app/src/...` in the
   worker container. No fix needed.

## What was fixed

**Dev events no longer reach production Sentry**
(`a44e2641`). All three runtimes gate on their own dev signal — the Cloudflare
server drops the DSN under `import.meta.env.DEV`, the browser folds
`import.meta.env.PROD` into `isSentryEnabled()`, and the Bun worker denies
known-local environments. The worker *denies* rather than allow-lists
`production` deliberately: an unset var in the container must never silently
blind us to production errors. Also fixed a latent bug there — `??` resolved
`SENTRY_ENVIRONMENT=` to `""` instead of falling through to `NODE_ENV`.

**-19, the free-allocation lock timeout** (`2524e389`). `grantFreeAllocation` is
the last step of onboarding, and a lock wait lost the grant outright: a free-plan
user finished onboarding with zero unlocked songs and no error shown. The RPC is
idempotent (`ON CONFLICT ... WHERE revoked_at IS NOT NULL`), so it now retries the
lock-timeout class only. Onboarding is *not* the contention source — that path is
already guarded by a compare-and-set in `completeOnboarding`, so only one caller
ever reaches the grant. With one event ever, this reads as transient (a migration
or vacuum holding a lock) rather than a systematic race.

The same commit fixes why it was undiagnosable: `captureServerError` read
`_tag`/`code` from the top-level error only, but domain code returns wrappers like
`UnlockError`'s `{ kind, cause }`, so **every wrapped failure reported with no
`db_*` tags at all**. It now falls back to the cause. Because of that gap the
SQLSTATE was never recorded, so the retry matches on message as well as `55P03`.

**-16, the startup backup** (`a1f98424`). The catch-up backup now retries an
unreachable database (5s/15s/45s) and bails if the scheduler stops mid-wait. Only
the connection class retries — a permission error or version mismatch fails
identically every time. Losing this backup meant no coverage until the next
scheduled run up to a day later.

**-14/-13, the stale chunk** (`38406fcb`). These were one incident, not two:
identical second, release, replay ID, and user. A tab open across a deploy asks
for hashed assets that no longer exist. The root error component now reloads once
onto the current build and skips reporting, capped by a sessionStorage marker so a
client that genuinely can't fetch the chunk surfaces the error instead of looping.

## What needs no code change

- **-12** — already fixed by `ad503918`, which deleted
  `filterDismissedActiveSuggestions` (two `.in()` filters built from
  `suggestions.map(...)`, the exact pattern the CLAUDE.md rule forbids) and
  replaced it with an RPC that keeps the anti-join in Postgres. A regression guard
  now exists at `src/lib/data/client.ts:11` — an 8000-char request-URL check,
  dev/test only, that names the rule.
- **-17** — the migration reached production and the errors stopped.
- **-G** — last seen a month ago on a release predating the deck-model rewrite;
  the `/match` surface it fired on no longer exists in that form.

## Remaining Sentry housekeeping

Not done automatically — these mutate the Sentry project:

```bash
sentry issue resolve HEARTED-MUSIC-12 --in <release>   # regression-flag instead of silent reopen
sentry issue resolve HEARTED-MUSIC-17
sentry issue resolve HEARTED-MUSIC-18
sentry issue resolve HEARTED-MUSIC-15
sentry issue merge HEARTED-MUSIC-14 HEARTED-MUSIC-13 --into HEARTED-MUSIC-14
sentry issue archive HEARTED-MUSIC-14 --until 10x
sentry issue archive HEARTED-MUSIC-G --until auto
```

Worth adding as a backstop regardless of the code gate: an inbound filter on
`environment:development` in the Sentry project settings, so a future stray DSN
can't re-drain the quota.

Leave -19 and -16 open until their fixes have been deployed long enough to
confirm the retries hold.
