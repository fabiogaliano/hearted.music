# Hyperdrive Private Database Migration

> Future-state plan. The production Cloudflare Worker still connects directly to
> the public Supavisor endpoint today. This plan is not implemented yet.

## Why this exists

The web Worker currently reaches the self-hosted Supabase session pooler at
`supabase.hearted.music:5432`. On 2026-08-16, firewall hardening that allowlisted
Cloudflare's published proxy ranges blocked Worker database traffic because raw
Workers egress does not have a stable source range matching that list. Better
Auth requests timed out until public pooler access was restored.

The immediate configuration is intentional but transitional: public port 5432
is protected by TLS, Supavisor authentication, and a strong database password.
The target state removes public database ingress entirely.

## Decision

Use **Cloudflare Hyperdrive through Workers VPC and Cloudflare Tunnel**. Workers
VPC is Cloudflare's recommended private-database path and avoids maintaining an
Access application and service token. If Workers VPC is unavailable for the
account, use Hyperdrive through Tunnel + Access as the fallback; do not keep an
IP allowlist of Cloudflare proxy ranges.

Hyperdrive applies only to the deployed web Worker. The standalone Bun worker,
control panel, backups, migrations, and `LISTEN` consumers keep their existing
direct/session-pooler connections because they run outside Cloudflare and some
require session semantics that Hyperdrive is not intended to replace.

References:

- https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database-vpc/
- https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database/
- https://developers.cloudflare.com/hyperdrive/configuration/firewall-and-networking-configuration/
- https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/postgres-js/

## Current repository state

- `wrangler.jsonc` has no Hyperdrive binding and uses Smart Placement.
- `src/lib/platform/auth/auth-request-state.server.ts` creates one request-scoped
  Postgres.js client from `env.DATABASE_URL`; Better Auth is the web Worker's
  direct SQL consumer.
- `src/env.ts` requires `DATABASE_URL` as a process environment value.
- Worker-only transactional and `LISTEN` code also uses `DATABASE_URL`, but runs
  in the standalone Bun worker and must remain on its direct/session-pooler DSN.
- Local control-panel SQL uses the production VPS Tailscale address from
  `.env.cloud.local`, so it does not require public database ingress.
- Supavisor already presents a publicly trusted certificate for
  `supabase.hearted.music`.

## Target topology

```text
Cloudflare Worker
  -> Hyperdrive binding
  -> Workers VPC TCP service
  -> outbound Cloudflare Tunnel
  -> Supavisor on the VPS private Docker network
  -> PostgreSQL
```

No inbound public firewall rule for port 5432 remains after cutover. Tailscale
continues to provide operator access from trusted devices.

## Implementation

### 1. Establish private connectivity

1. Confirm the Cloudflare account has the **Connectivity Directory Admin** role.
2. Run `cloudflared` as a restart-managed service/container on the Supabase VPS.
3. Create a Workers VPC tunnel for the production database network.
4. Create a TCP VPC Service targeting the private Supavisor address on port
   5432 with `--app-protocol postgresql`.
5. Use certificate verification mode `verify_ca` if the private Docker hostname
   does not match the existing `supabase.hearted.music` certificate. Do not use
   disabled certificate verification in production.
6. Run at least two `cloudflared` connector replicas on the VPS so a connector
   restart does not interrupt authentication traffic.

### 2. Create Hyperdrive

1. Create a production Hyperdrive configuration from the VPC Service ID using
   the existing `postgres.dev_tenant` database identity.
2. Disable Hyperdrive query caching initially. Auth session, verification,
   rate-limit, and OAuth account reads must reflect writes immediately.
3. Store the resulting Hyperdrive configuration ID as a non-secret binding in
   `wrangler.jsonc`; credentials remain inside the Hyperdrive configuration.
4. Add a local connection string to the binding for local development only.
5. Regenerate Cloudflare binding types with `bunx wrangler types`.

If Workers VPC cannot be provisioned, create a TCP Tunnel hostname, protect it
with a service-auth Access policy, and create Hyperdrive with the Access client
ID/secret. The rest of the plan is unchanged.

### 3. Introduce one web database connection seam

Add a small platform-level connection resolver used by Better Auth:

- In Cloudflare production, return the Hyperdrive binding's connection string.
- In local Vite/Vitest, return `env.DATABASE_URL`.
- Fail at startup when neither source is available.
- Keep the Postgres.js client request-scoped and close it through the existing
  `AuthRequestState.close()` lifecycle.

Postgres.js is supported by Hyperdrive, so this migration does not require an
ORM or driver rewrite. Do not route Supabase JS queries through Hyperdrive.
Do not modify the standalone Bun worker's connection modules.

### 4. Test before cutover

Automated coverage must pin:

- Hyperdrive binding wins in Cloudflare runtime.
- Local development falls back to `DATABASE_URL`.
- Missing binding and missing fallback fail clearly.
- Auth request state still closes its connection after the response.
- Better Auth session reads and writes use the resolved connection.

Deploy a preview Worker with the Hyperdrive binding and verify:

- `/api/auth/get-session` returns within the normal latency budget.
- Credential and Google login complete.
- Signup creates both Better Auth identity and domain account.
- Email verification and password reset writes are visible immediately.
- Logout/session revocation and database-backed rate limits behave correctly.
- Hyperdrive and Tunnel dashboards show successful connections without origin
  TLS errors or reconnect loops.

### 5. Production rollout

1. Keep public 5432 available during the initial deployment for instant rollback.
2. Deploy the Hyperdrive-bound Worker through normal CI.
3. Verify auth session, login, callback, logout, password reset, and signup.
4. Observe Worker errors, auth latency, Hyperdrive connection health, and Tunnel
   connector health for at least one normal traffic window.
5. Remove the public IPv4/IPv6 5432 rules from UFW and the persistent
   `DOCKER-USER` block in `/etc/ufw/after.rules` and `after6.rules`.
6. Confirm public `supabase.hearted.music:5432` is unreachable while production
   auth remains healthy.
7. Keep the old Worker `DATABASE_URL` secret for one rollback window, then remove
   it after the Hyperdrive path is stable.

## Failure behavior and rollback

- Two healthy tunnel connectors are required before closing public ingress.
- A failed private-connectivity health check blocks rollout; it never falls
  through silently to public Postgres in production.
- If auth errors or latency regress after public ingress closes, reopen port
  5432 first, then roll the Worker back to the previous version.
- Rollback does not change database schema or data.
- Tunnel/Hyperdrive credentials are independently revocable and must never be
  committed to the repository.

## Completion criteria

- The deployed web Worker uses Hyperdrive for every Better Auth SQL connection.
- Production auth flows pass with public port 5432 blocked.
- Direct external TCP and TLS probes to `supabase.hearted.music:5432` fail.
- Bun worker jobs, account-event delivery, backups, migrations, and the local
  control panel continue working through their existing private/direct paths.
- The production runbook documents Hyperdrive, Tunnel, connector restart, TLS,
  health checks, and rollback ownership.
