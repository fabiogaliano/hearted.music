# Web app on the VPS (Bun container behind Cloudflare)

The web app runs as a Bun container (`Dockerfile.app`, entry `src/serve.ts`, Sentry preload
`src/instrument.ts`) on the Coolify VPS, next to the job worker and the SSE gateway. Cloudflare
stays in front for DNS, WAF and the asset cache. Background: `docs/plans/reliability.md` §3.

## How a deploy works

On a push to `main` that touches app paths, the `deploy-app` job in `.github/workflows/main.yml`:

1. builds `Dockerfile.app` (`RELEASE=true vite build`, sourcemaps uploaded to Sentry),
2. pushes `ghcr.io/fabiogaliano/hearted.music-app:<sha>` and `:latest`,
3. POSTs the Coolify deploy hook (`COOLIFY_APP_WEBHOOK_URL`),
4. polls `https://hearted.music/health` until `release` equals the commit SHA (10 min limit).

## As built (cutover 2026-10-28)

GitHub:

- Repository secrets (shared by `deploy-app` and `deploy-worker`): `COOLIFY_API_TOKEN`,
  `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`. The Cloudflare Access service token is
  `github-ci-hearted-deploy`; it must be listed in the Zero Trust policy "CI deploy service token"
  (attached to the `coolify-ci-deploy` application for `coolify.fabiogaliano.com/api/v1/deploy`),
  otherwise Access answers 403 and the deploy hook never reaches Coolify.
- `production-app` environment: secret `COOLIFY_APP_WEBHOOK_URL`
  (`https://coolify.fabiogaliano.com/api/v1/deploy?uuid=nwxaqfqz9mrlncyythxaraca&force=false`),
  `SENTRY_AUTH_TOKEN`; variables `VITE_PUBLIC_APP_ORIGIN`, `VITE_PUBLIC_POSTHOG_PROJECT_TOKEN`
  (the build fails without either), `VITE_PUBLIC_POSTHOG_HOST`, `VITE_ACCOUNT_EVENTS_GATEWAY_URL`,
  `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT`, `VITE_SENTRY_ORG_SLUG`, `VITE_CHROME_EXTENSION_ID`,
  `VITE_APP_TITLE`, `VITE_USERJOT_PROJECT_ID`. `VITE_APP_RELEASE` comes from the commit SHA.
- `production-worker` environment: secret `COOLIFY_WORKER_DEPLOY_HOOK` only. Don't re-add copies of
  the shared secrets there: an environment secret shadows the repository secret of the same name, so
  `deploy-worker` would silently keep the stale copy after a rotation.

Coolify (project `hearted.music`, environment `production`):

- Application `hearted-app`, uuid `nwxaqfqz9mrlncyythxaraca`, type Docker Image
  `ghcr.io/fabiogaliano/hearted.music-app:latest`, port 3000, domain `https://hearted.music`,
  memory limit 768 MB. The VPS Docker daemon is logged in to GHCR with a `read:packages` PAT.
- Coolify's own healthcheck is **on** (`GET /health`, port 3000), so a deploy keeps the old
  container serving until the new one is healthy. It runs `curl` inside the container, which
  `Dockerfile.app` installs for that reason; with the check off, Coolify stopped the old container
  before Traefik would route to the new one and every deploy answered a burst of 503s. The image's
  own `HEALTHCHECK` probes every second during its start period, because Traefik ignores
  containers that are not yet healthy.
  Turn the Coolify check on only once an image with `curl` is live: against an older image every
  deploy rolls back as "unhealthy".
- Custom labels are set (Coolify API `custom_labels`): the generated Traefik labels plus
  `cloudflare-only@file` appended to the HTTPS router's middlewares. Regenerating labels from the
  Coolify UI drops that middleware; re-append it.
- Runtime env: every server var read by `src/env.ts` plus `SENTRY_DSN` /
  `SENTRY_ENVIRONMENT` for `src/instrument.ts`, copied from the worker's Coolify env, `.env.cloud`
  and the old Worker secrets. Required: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
  `ACCOUNT_EVENTS_TOKEN_SECRET`, `ML_PROVIDER=deepinfra`, `DEEPINFRA_API_KEY`. The container exits
  at boot if the provider is missing or its embedding model disagrees with `song_embedding`.
  `NODE_ENV`, `PORT` and `APP_RELEASE` come from the image; `VITE_*` values are baked at build
  time and have no effect in Coolify.
- The worker container also has `ML_PROVIDER=deepinfra` (it refuses to start without it).

Origin lock (instead of a host firewall): `/data/coolify/proxy/dynamic/cloudflare-only.yaml`
defines a Traefik `ipAllowList` middleware with the Cloudflare edge ranges
(https://www.cloudflare.com/ips/). Only the `hearted.music` router uses it; `supabase.`, `chili.`
and `ntfy.` are reached directly and a ufw rule would cut them off. Direct requests to the origin
with `Host: hearted.music` get 403. When Cloudflare publishes new ranges, regenerate the file on
the VPS from `https://www.cloudflare.com/ips-v4` and `ips-v6` (one `- "<cidr>"` line per range under
`http.middlewares.cloudflare-only.ipAllowList.sourceRange`); Traefik watches the directory and
reloads on write. The file header records the fetch date.

Cloudflare (zone `hearted.music`, SSL mode Full):

- DNS: `A hearted.music → 57.129.63.224`, proxied. The Worker custom domain and its `AAAA 100::`
  placeholder were removed. The `hearted-music` Worker was deleted on 2026-10-29.
- WAF custom rule "Block scanner paths" (`/wp-*`, `/.env*`, `/xmlrpc.php`, `/.aws/*`).
- Cache rules: bypass `/_serverFn/*` and `/api/*`; cache `/assets/*` honouring origin TTLs.
- Rate limit: `/api/pulse-s` (Sentry tunnel) 30 req / 10 s per IP.
- Origin TLS: Traefik Let's Encrypt HTTP-01. The first issuance failed because it ran before DNS
  moved; a `docker restart coolify-proxy` retried it. If the origin ever serves the
  `TRAEFIK DEFAULT CERT` again, do the same.

Monitoring:

- Kener (`status.fabiogaliano.com`, category "hearted.music"): `hearted-app` (`/health`),
  `hearted-events`, `hearted-billing`, `hearted-db` (Supabase auth health). Trigger "ntfy ops-alerts
  (hearted)" posts to ntfy topic `ops-alerts` (user `kener`, write-only token) after 2 consecutive
  DOWN checks (checks every 3 min) and again on recovery. Kener 3.2 has no native ntfy trigger, so
  it is a webhook in ntfy's JSON publish format. Kener's database has no volume yet (hardening
  backlog).
- Sentry workflows on the `hearted-music` error monitor, email to the owner:
  "hearted.music: server error volume" (`service=web-server`, >10 events/h in an issue) and
  "hearted.music: route error volume" (`route` tag set, >10 events/h).

Smoke after a deploy: `GET /health` reports the SHA, dashboard and studio load, the dashboard opens
one SSE stream to `events.hearted.music` (visible as one established connection into the gateway
container), `/wp-login.php` is 403 at the edge.

## Rollback

- Bad release, VPS otherwise fine: in Coolify set the image tag to the previous
  `ghcr.io/fabiogaliano/hearted.music-app:<sha>` and redeploy. Images older than `218b8e02` have no
  `curl`, so Coolify's healthcheck marks them unhealthy and rolls the deploy back; to go back that far,
  disable the healthcheck first.
- Back to Workers: the Worker is deleted and `bun run deploy` no longer exists on `main`, so
  this means checking out a pre-migration commit, deploying it, then swapping the `hearted.music`
  A record for the Worker custom domain.
