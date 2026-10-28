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

## One-time setup (before merging the PR that adds this)

GitHub, `production-app` environment:

- Secrets: `COOLIFY_APP_WEBHOOK_URL` (new), `COOLIFY_API_TOKEN`, `CF_ACCESS_CLIENT_ID`,
  `CF_ACCESS_CLIENT_SECRET` (same values as the worker's; if those are `production-worker`
  environment secrets rather than repository secrets, add them here too), `SENTRY_AUTH_TOKEN`
  (already there).
- Variables (build-time, inlined into the bundle): `VITE_PUBLIC_APP_ORIGIN` and
  `VITE_PUBLIC_POSTHOG_PROJECT_TOKEN` (the build fails without either), `VITE_PUBLIC_POSTHOG_HOST`,
  `VITE_ACCOUNT_EVENTS_GATEWAY_URL`, `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT`,
  `VITE_SENTRY_ORG_SLUG` (new; optional), `VITE_CHROME_EXTENSION_ID`, `VITE_APP_TITLE`,
  `VITE_USERJOT_PROJECT_ID`. `VITE_APP_RELEASE` comes from the commit SHA.
- The old `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `ACCOUNT_EVENTS_TOKEN_SECRET` secrets
  in `production-app` are no longer read; delete them after the Worker is retired.

Coolify:

- [ ] New application, type Docker Image: `ghcr.io/fabiogaliano/hearted.music-app:latest`.
      If the GHCR package is private, add a GHCR registry credential (a PAT with `read:packages`).
- [ ] Port 3000; domain `https://hearted.music`, TLS via Let's Encrypt HTTP-01 the same way as
      `supabase.`, `events.`, `billing.`.
- [ ] Healthcheck: the image's own `HEALTHCHECK` (`GET /health`).
- [ ] Memory limit ~768 MB (decision 1); add a limit on the worker container too.
- [ ] Worker container env: `ML_PROVIDER` (`deepinfra`) and `DEEPINFRA_API_KEY` are set. The
      worker no longer infers the provider from which keys exist, and refuses to start without it.
- [ ] Enable the deploy webhook and store its URL as `COOLIFY_APP_WEBHOOK_URL`.
- [ ] Runtime env, from the same source as the worker (`.env.cloud`). Every server var read by
      `src/env.ts`, plus the Sentry pair read by `src/instrument.ts`:

      Required: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`,
      `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ACCOUNT_EVENTS_TOKEN_SECRET`, `ML_PROVIDER`
      (`deepinfra` in prod), and `DEEPINFRA_API_KEY` when `ML_PROVIDER=deepinfra`. The container
      exits at boot if the provider is missing or its embedding model disagrees with the vectors
      in `song_embedding`.

      Optional but set in prod: `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`, `HF_TOKEN`, `LASTFM_API_KEY`, `GENIUS_CLIENT_TOKEN`, `GEMINI_API_KEY`,
      `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_VERTEX_PROJECT`,
      `GOOGLE_VERTEX_LOCATION`, `GOOGLE_APPLICATION_CREDENTIALS_JSON`, `ANTHROPIC_API_KEY`,
      `OPENAI_API_KEY`, `RESEND_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
      `BILLING_ENABLED`, `BILLING_SERVICE_URL`, `BILLING_SHARED_SECRET`, `QUARTERLY_PLAN_ENABLED`,
      `USERJOT_IDENTITY_SECRET`, `SERVER_URL`.

      `NODE_ENV`, `PORT` and `APP_RELEASE` are set by the image. `VITE_*` values are baked in at
      build time; setting them in Coolify has no effect.

## Cutover

The first deploy job after the merge will fail its health poll: `hearted.music` still routes to
the Worker, which never reports the new SHA. That is expected; cut over, then re-run the job.

1. [ ] Confirm the container is healthy in Coolify and answers on the VPS
       (`curl -H 'Host: hearted.music' http://<vps-ip>:<published port>/health`).
2. [ ] Cloudflare → Workers → `hearted-music` → remove the `hearted.music` custom domain.
3. [ ] DNS: add `A hearted.music → <VPS IP>`, proxied (orange cloud).
4. [ ] Cache rule: cache everything on `hearted.music/assets/*` (respect origin `immutable`);
       bypass cache for `/_serverFn/*` and HTML.
5. [ ] WAF custom rule: block `/wp-*`, `/.env*`, `/xmlrpc.php`, `/.aws/*`.
6. [ ] Rate-limiting rule (the one free rule): `/api/pulse-s` (decision 4).
7. [ ] Origin firewall on the VPS: 80/443 accept only Cloudflare IP ranges
       (https://www.cloudflare.com/ips/), so `cf-connecting-ip` can't be spoofed.
8. [ ] Re-run the failed `deploy-app` job; it passes when `/health` reports the SHA.
9. [ ] Smoke: log in, open the dashboard, run a studio preview, log out (logout must take effect
       immediately: the session cookie cache is gone).

## Rollback

- Bad release, VPS otherwise fine: in Coolify set the image tag to the previous
  `ghcr.io/fabiogaliano/hearted.music-app:<sha>` and redeploy.
- Back to Workers: delete the `hearted.music` A record and re-add the Worker custom domain. Keep
  the Worker deployed but unrouted until the VPS meets "done when" in the plan (zero Worker
  invocations, a day without 5xx, a deliberately thrown server error reaches Sentry, uptime check
  green); `bun run deploy` no longer exists on `main`, so re-deploying the Worker means checking
  out a pre-migration commit.
