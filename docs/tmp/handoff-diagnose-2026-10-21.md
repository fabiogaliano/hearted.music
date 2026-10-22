# Handoff: diagnose hearted.music's reliability

Find every issue, bug and weak spot behind the symptoms below, from the bottom up. Diagnose only: don't change
code, config or data, and don't deploy, unless Fábio says so.

## Symptoms

- On 2026-10-17, between about 15:37 and 15:43 UTC, logged-in page loads (desktop width) of `/dashboard`,
  `/liked-songs`, `/playlists/new` and `/match` intermittently returned Cloudflare **Error 1102** ("Worker
  exceeded resource limits"). The load came from automated headless browsers: first 3 at a time, then 1 at a
  time with pauses. Example Ray IDs: a4c064b139d3f55c, a4c0620bb940f4f9, a4c069604bfcff4e, a4c069b11b7910fc,
  a4c06aa4bb5bb2a2.
- Errors reportedly continued for hours after that load stopped.
- On 2026-10-21, one automated run of `/playlists/new` (prompt, then Start) showed "Nothing matches" in the
  studio. The same flow minutes earlier returned songs.

## Access

- Repo: this one. Deploy target: Cloudflare Workers (see wrangler config).
- The `sentry` CLI is logged in. wrangler is logged in. PostHog and other credentials may be in the repo's env
  files.
- Use the live site only for light, read-only checks. It's in production with real users.

## Deliverable

A report in `docs/tmp/` listing every issue found: symptom → root cause → evidence → suggested fix, ranked by
impact. Separate what's confirmed from what's suspected.

A previous quick pass exists at `docs/tmp/investigation-1102-2026-10-21.md`. Read it only after forming your own
view, then note where you agree or disagree.
