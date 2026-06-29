#!/usr/bin/env bun
/**
 * Print the app cutover env for pointing Hearted at the self-host Supabase.
 *
 * IMPORTANT: the API keys must be Coolify's *generated* anon/service_role keys,
 * NOT keys re-derived from the JWT secret. Supabase's Kong uses a `key-auth`
 * plugin that only accepts the exact registered key strings — a freshly-signed
 * (but otherwise valid) JWT is rejected at the gateway with 401. So we read the
 * authoritative values straight from Coolify's resolved magic vars.
 *
 * Prints to stdout only (no secret file written). Pipe/paste the values into
 * .env.cloud at cutover time, then redeploy.
 */

import { execFileSync } from "node:child_process";

const SERVICE = "fcuhypd724cwmn4dhx74qqja";

function coolifyEnv(key: string): string {
	const out = execFileSync(
		"coolify",
		["service", "env", "get", SERVICE, key, "-s", "--format", "json"],
		{ encoding: "utf-8" },
	);
	const d = JSON.parse(out);
	const r = Array.isArray(d) ? d[0] : d;
	const v = r?.value ?? r?.real_value ?? r?.val;
	if (!v) throw new Error(`Coolify did not resolve ${key}`);
	return String(v);
}

const anon = coolifyEnv("SERVICE_SUPABASEANON_KEY");
const service = coolifyEnv("SERVICE_SUPABASESERVICE_KEY");
const pgPassword = coolifyEnv("SERVICE_PASSWORD_POSTGRES");

// Live, verified endpoints (see scripts/db/migrate/README.md "Cutover"):
//  - Kong REST/Storage over HTTPS (Let's Encrypt cert, returns 200 with the keys)
//  - supavisor session pooler, published on host :5432 by the `pooler-proxy`
//    sidecar, TLS via supavisor's downstream cert. The pooler username MUST be
//    `postgres.<tenant>` (tenant = dev_tenant) — bare `postgres` fails auth.
const supabaseUrl = "https://supabase.hearted.music";
const databaseUrl = `postgresql://postgres.dev_tenant:${pgPassword}@supabase.hearted.music:5432/postgres?sslmode=require`;

// Both writers use the SAME public endpoints: the CF Worker (edge) and the VPS
// Bun worker (Coolify app gbaerr9a5f86sdqvhbpng1tc). Uniform config, no
// cross-network Docker wiring for the worker.
console.log("# ── Self-host Supabase cutover env (both CF Worker + VPS worker) ──");
console.log(`SUPABASE_URL=${supabaseUrl}`);
console.log(`SUPABASE_ANON_KEY=${anon}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY=${service}`);
console.log(`DATABASE_URL=${databaseUrl}`);
