# PostHog Error Triage — hearted.music

**Generated:** 2026-07-19
**Window:** last 30 days (`-30d`)
**Project:** 185471 (EU cloud)
**Source:** `posthog-cli api call query-error-tracking-issues-list`

12 active issues, 40 total occurrences, ~5 distinct users.
**They are not 12 bugs. They are 3.**

---

## Headline finding: issue fragmentation

Ten of the twelve issues are the *same* React error #418. PostHog filed them as
ten separate issues because each has a different fingerprint:

| Issue | Fingerprint (first 16) | Bundle |
|---|---|---|
| `019ec712…` | `14efe2044726a96d` | `index-DSsxYjXT.js` |
| `019ec143…` | `400701ae804dd5ec` | `index-BzJrlJHs.js` |
| `019f4892…` | `72efcfcf055d62e6` | `index-z0H5BhYC.js` |
| `019ef327…` | `75808cbbd7cd90db` | `index-HAN_h0UA.js` |

Same error, same message, different fingerprint — and the only thing that varies
is the content-hashed bundle filename. **The fingerprint is keyed on the minified
source path, so every deploy mints a brand-new issue for a bug that never went
away.** Occurrence counts are therefore meaningless as a priority signal: the
"12 occurrence" top issue is just the one that survived the longest without a
redeploy.

### Why: sourcemaps go to Sentry, not PostHog

`vite.config.ts:305-318` uploads sourcemaps via `sentryTanstackStart({...})` on
release builds. Nothing uploads them to PostHog. Consequence: PostHog has zero
stack frames for these events — `verbosity: "raw"` with `onlyAppFrames: false`
returns no `stacktrace` key at all — so grouping falls back to the bundle path.

Two ways out, pick one:

1. **Add `posthog-cli sourcemap` to the release build.** The CLI is already
   installed and authenticated. Gives PostHog real frames *and* stable grouping.
2. **Triage in Sentry, use PostHog for replay only.** Your
   `src/lib/observability/posthog-sentry-link.ts` already cross-links both SDKs,
   so Sentry issues carry a PostHog session URL. Cheaper, but leaves PostHog's
   error tab permanently noisy.

Either way, the ten #418 issues can be collapsed today with
`error-tracking-issues-merge-create` — worth doing before the next deploy adds
an eleventh.

---

## Cluster A — hydration failure on authenticated entry (React #418)

**10 issues · 38 occurrences · ~4 users · Chrome + Firefox, desktop**

React #418 is a hydration mismatch: server HTML didn't match the first client
render. URLs cluster on `/dashboard`, `/match`, and `/`. Referrers are
telling — `https://accounts.google.pt/` and `https://hearted.music/login`.

**Every sampled occurrence is on a post-authentication landing.** That points at
markup that depends on session/user state resolving differently between SSR and
first client paint, rather than a random component. Prime suspects are anything
rendering user-conditional UI above the first paint on the dashboard and match
routes.

Not user-visible as a crash — React recovers by re-rendering client-side. The
real cost is a content flash plus a discarded server render on the exact screen
users hit first after signing up.

## Cluster B — match review queue fails to load

**1 issue · `019f18bd-d091-7193-8bab-19aab1ef936f` · Firefox 151 · `/dashboard`**

The only issue with a genuine chained application error:

```
Error: Minified React error #422        (unhandled)
  └─ Error: Could not prepare your match review queue. Please try again.  (handled)
```

React #422 = a Suspense boundary threw during hydration, so React discarded the
server tree and fell back to client rendering. The inner error is ours.

**This is the highest-severity item in the list** — it is the only one where a
user demonstrably could not use a feature.

Code note: the exact string `Could not prepare your match review queue` does not
exist in the current tree. The closest live match is
`src/lib/server/match-deck.functions.ts:603` — `"Could not prepare your match
deck. Please try again."` Either the copy was renamed since 06-30, or this comes
from a sibling in the `match-review-queue.functions.ts` family. Worth confirming
which before chasing the fix.

## Cluster C — fetch failure on dashboard

**1 issue · `019f20e2-dc4a-7370-b178-46e4e83a1f0f` · Firefox 151 · `/dashboard`**

`TypeError: NetworkError when attempting to fetch resource.` Unhandled, no
frames. Same user (`8ce63d2d…`) and same route as Cluster B.

---

## The clusters are causally linked

Timestamps put the network failures *upstream* of the hydration errors:

| Session | Event | Time | Δ |
|---|---|---|---|
| `019f20e2-cf70…` | TypeError NetworkError | 03:32:46.149 | — |
| `019f20e2-cf70…` | React #418 | 03:32:46.930 | +781ms |
| `019f18bd-b2cb…` | React #422 + queue error | 13:35:17.757 | — |
| `019f18bd-b2cb…` | React #418 | 13:35:25.092 | +7.3s |

Same session, sub-second to seconds apart, fetch error first. **A failed data
fetch during hydration is plausibly generating some fraction of Cluster A**, and
both traces come from the same Firefox user on `/dashboard` arriving from
`/login`.

This is a correlation across two sessions, not proof. But it means fixing B and
C may quietly drain a chunk of A — so fix those first and re-measure before
spending time hunting a generic hydration mismatch.

---

## Recommended order

1. **Fix Cluster B** — only confirmed feature-breaking failure. Start by
   resolving the message-vs-source mismatch noted above.
2. **Fix Cluster C** — likely the same root cause as B; identify which dashboard
   fetch is failing and whether it lacks retry/error handling.
3. **Wire sourcemaps into PostHog** (or commit to Sentry-first triage). Without
   this, issue #11 of Cluster A arrives with the next deploy and you are
   re-reading this document in two weeks.
4. **Merge the ten #418 issues**, then re-assess Cluster A against real frames.

## Caveats

- Last event was **2026-07-09**, ten days ago. Either recently fixed or traffic
  is low — check deploy history before assuming these are live.
- Volumes are small (40 events, ~5 users). Treat cluster boundaries as
  directional.
- `filterTestAccounts: true` throughout; your own sessions are excluded.

## Reproducing

```bash
posthog-cli api call query-error-tracking-issues-list \
  '{"status":"active","filterTestAccounts":true,"orderBy":"occurrences",
    "orderDirection":"DESC","limit":50,"offset":0,"volumeResolution":0,
    "dateRange":{"date_from":"-30d"}}'

posthog-cli api call query-error-tracking-issue-events \
  '{"issueId":"<id>","filterTestAccounts":true,"orderDirection":"DESC",
    "limit":3,"offset":0,"verbosity":"stack","onlyAppFrames":false,
    "dateRange":{"date_from":"-30d"}}'
```

Session IDs from issue events feed `query-session-recordings-list` via its
`session_ids` parameter — useful for watching what preceded the Cluster B
failure.

## Full issue index

| # | ID | Type | Occ | Users | Route | Last seen |
|---|---|---|---|---|---|---|
| 1 | `019ebe55…` | React #418 | 12 | 3 | `/match` | 07-08 |
| 2 | `019ec712…` | React #418 | 7 | 2 | `/dashboard` | 07-07 |
| 3 | `019ec143…` | React #418 | 7 | 1 | `/dashboard` | 07-06 |
| 4 | `019f1527…` | React #418 | 4 | 1 | — | 06-29 |
| 5 | `019ebdc7…` | React #418 | 3 | 1 | — | 06-24 |
| 6 | `019f20f8…` | React #418 | 1 | 1 | — | 07-02 |
| 7 | `019f18bd-ee84…` | React #418 | 1 | 1 | — | 06-30 |
| 8 | `019f20e2-ed50…` | React #418 | 1 | 1 | — | 07-02 |
| 9 | `019ef327…` | React #418 | 1 | 1 | `/dashboard` | 06-23 |
| 10 | `019f4892…` | React #418 | 1 | 1 | `/` | 07-09 |
| 11 | `019f20e2-dc4a…` | TypeError | 1 | 1 | `/dashboard` | 07-02 |
| 12 | `019f18bd-d091…` | React #422 | 1 | 1 | `/dashboard` | 06-30 |

Issue URLs follow `https://eu.posthog.com/project/185471/error_tracking/<id>`.
