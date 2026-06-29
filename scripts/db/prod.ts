#!/usr/bin/env bun
/**
 * prod.ts — one tool for talking to the PRODUCTION Supabase project, in the two
 * ways that actually work against a remote Supabase DB:
 *
 *   prod rest …   PostgREST + service-role key. Table CRUD / RPC. NO password.
 *                 Safe + simple, but only row-level operations (no joins/DDL).
 *
 *   prod sql  …   Direct Postgres via postgres.js. Arbitrary SQL (joins,
 *                 aggregates, DDL, transactions). Needs the DB password.
 *
 * Decision rule: reach for `rest` first (no secret, can't run a stray DROP);
 * drop to `sql` only when REST can't express it.
 *
 * ─── Credentials ─────────────────────────────────────────────────────────────
 * PROD is now the SELF-HOST Supabase (https://supabase.hearted.music), not the
 * old hosted project. See scripts/db/migrate/README.md for the cutover.
 *   rest mode  → SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.cloud
 *                (already the self-host values — nothing to set up).
 *   sql  mode  → PROD_DATABASE_URL from .env.cloud.local (gitignored) = the
 *                self-host supavisor pooler DSN (user `postgres.dev_tenant`,
 *                `?sslmode=require`). Get the value from
 *                `bun scripts/db/migrate/print-cutover-env.ts` (its DATABASE_URL).
 *                Falls back to the LEGACY hosted pooler (supabase/.temp/pooler-url
 *                + SUPABASE_DB_PASSWORD from .env) only if PROD_DATABASE_URL is
 *                unset — that path will break once hosted is decommissioned.
 * Full runbook: the `supabase-prod` skill (.claude/skills/supabase-prod/SKILL.md).
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *   # REST (reads — no confirm, no password)
 *   bun run prod:rest get user --select id,name,email --order created_at
 *   bun run prod:rest count liked_song --eq account_id=<uuid>
 *   bun run prod:rest rpc some_function --data '{"arg":1}'
 *
 *   # REST (writes — typed-ref confirmation unless --yes)
 *   bun run prod:rest insert user_preferences --data '{"account_id":"…"}'
 *   bun run prod:rest update account --eq id=<uuid> --data '{"handle":"x"}'
 *   bun run prod:rest delete account --eq id=<uuid>
 *
 *   # SQL (read-only by default; --write opens a write transaction)
 *   bun run prod:sql 'select count(*) from account'
 *   bun run prod:sql -f scripts/report.sql --json
 *   bun run prod:sql --write 'update account set handle = lower(handle)'
 *
 * Common flags: --json (raw JSON out), --yes (skip write confirmation).
 */

import { parseArgs } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

const REPO_ROOT = process.cwd();
const POOLER_URL_FILE = resolve(REPO_ROOT, "supabase/.temp/pooler-url");

// REST creds are PROD-only and must come from the cloud files — bun auto-loads
// .env (LOCAL SUPABASE_URL/KEY) into process.env, so the cloud file has to win.
const CLOUD_FILES = [".env.cloud.local", ".env.cloud"];
// The prod DB password lives in .env; PROD_DATABASE_URL/override may be in
// .env.cloud.local. (.env's DATABASE_URL is local and is never read here.)
const SQL_FILES = [".env.cloud.local", ".env.cloud", ".env"];

function fail(message: string): never {
	console.error(`\n✗ ${message}\n`);
	process.exit(1);
}

/**
 * Minimal KEY=VALUE reader. Returns the FIRST occurrence across `files`, so
 * callers list the authoritative file first. Used file-first (over process.env)
 * because bun's auto-loaded local .env would otherwise shadow prod values.
 */
function readEnv(keys: string[], files: string[]): Record<string, string> {
	const found: Record<string, string> = {};
	for (const file of files) {
		const path = resolve(REPO_ROOT, file);
		if (!existsSync(path)) continue;
		for (const raw of readFileSync(path, "utf-8").split("\n")) {
			const line = raw.trim();
			if (!line || line.startsWith("#")) continue;
			const eq = line.indexOf("=");
			if (eq === -1) continue;
			const key = line.slice(0, eq).trim();
			if (!keys.includes(key) || key in found) continue;
			let value = line.slice(eq + 1).trim();
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}
			found[key] = value;
		}
	}
	return found;
}

/** Block accidental prod writes behind a typed project-ref confirmation. */
function confirmWrite(ref: string, yes: boolean, what: string) {
	if (yes) return;
	const answer = prompt(
		`\n⚠ This ${what} runs against PRODUCTION (ref=${ref}).\n  Type the ref to proceed: `,
	);
	if (answer?.trim() !== ref) fail("Confirmation did not match. Aborted.");
}

function printRows(rows: unknown, json: boolean) {
	const arr = Array.isArray(rows) ? rows : rows == null ? [] : [rows];
	if (json) {
		console.log(JSON.stringify(rows, null, 2));
	} else if (arr.length > 0) {
		console.table(arr);
	}
	console.error(`✓ ${arr.length} row${arr.length === 1 ? "" : "s"}`);
}

// ─── REST mode (PostgREST + service-role) ────────────────────────────────────

async function runRest(argv: string[]) {
	const { values, positionals } = parseArgs({
		args: argv,
		options: {
			select: { type: "string" },
			order: { type: "string" },
			limit: { type: "string" },
			data: { type: "string" },
			eq: { type: "string", multiple: true }, // --eq col=val (repeatable)
			filter: { type: "string", multiple: true }, // --filter col=op.val (raw)
			json: { type: "boolean", default: false },
			yes: { type: "boolean", default: false },
		},
		allowPositionals: true,
		strict: true,
	});

	const [action, target] = positionals;
	const READS = new Set(["get", "count"]);
	const WRITES = new Set(["insert", "update", "delete"]);
	if (!action || !target) {
		fail(
			"Usage: prod rest <get|count|insert|update|delete|rpc> <table|fn> [flags]",
		);
	}

	const env = readEnv(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"], CLOUD_FILES);
	const url = env.SUPABASE_URL ?? process.env.SUPABASE_URL;
	const key =
		env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) {
		fail("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (.env.cloud).");
	}
	if (url.includes("127.0.0.1") || url.includes("localhost")) {
		fail(`Refusing to run: resolved a LOCAL SUPABASE_URL (${url}). Check .env.cloud.`);
	}
	const ref = new URL(url).hostname.split(".")[0];
	const headers: Record<string, string> = {
		apikey: key,
		Authorization: `Bearer ${key}`,
	};

	// PostgREST filters: --eq col=val → col=eq.val ; --filter passes raw.
	const filters: string[] = [
		...(values.eq ?? []).map((pair) => {
			const i = pair.indexOf("=");
			if (i === -1) fail(`Bad --eq "${pair}" (expected col=value)`);
			return `${pair.slice(0, i)}=eq.${encodeURIComponent(pair.slice(i + 1))}`;
		}),
		...(values.filter ?? []),
	];

	console.error(
		`▶ PRODUCTION REST  ref=${ref}  ${action} ${target}  ${READS.has(action) ? "read" : "WRITE"}`,
	);

	if (action === "rpc") {
		// RPCs may mutate; treat as a write unless explicitly --yes'd through.
		confirmWrite(ref, values.yes, `rpc ${target}`);
		const res = await fetch(`${url}/rest/v1/rpc/${target}`, {
			method: "POST",
			headers: { ...headers, "Content-Type": "application/json" },
			body: values.data ?? "{}",
		});
		if (!res.ok) fail(`${res.status}: ${await res.text()}`);
		const text = await res.text();
		printRows(text ? JSON.parse(text) : [], values.json);
		return;
	}

	if (!READS.has(action) && !WRITES.has(action)) {
		fail(`Unknown rest action "${action}".`);
	}

	const qs = new URLSearchParams();
	if (values.select) qs.set("select", values.select);
	if (values.order) qs.set("order", values.order);
	if (values.limit) qs.set("limit", values.limit);
	const query = [filters.join("&"), qs.toString()].filter(Boolean).join("&");
	const endpoint = `${url}/rest/v1/${target}${query ? `?${query}` : ""}`;

	if (action === "count") {
		const res = await fetch(`${endpoint}${query ? "&" : "?"}select=*`, {
			method: "HEAD",
			headers: { ...headers, Prefer: "count=exact", Range: "0-0" },
		});
		const total = (res.headers.get("content-range") ?? "").split("/")[1];
		console.error(`✓ count = ${total ?? `ERR ${res.status}`}`);
		return;
	}

	if (action === "get") {
		const res = await fetch(endpoint, { headers });
		if (!res.ok) fail(`${res.status}: ${await res.text()}`);
		printRows(await res.json(), values.json);
		return;
	}

	// writes: insert / update / delete
	if (WRITES.has(action) && action !== "insert" && filters.length === 0) {
		fail(`Refusing ${action} without a filter (--eq/--filter).`);
	}
	confirmWrite(ref, values.yes, `${action} ${target}`);
	const method =
		action === "insert" ? "POST" : action === "update" ? "PATCH" : "DELETE";
	const res = await fetch(endpoint, {
		method,
		headers: {
			...headers,
			"Content-Type": "application/json",
			Prefer: "return=representation,count=exact",
		},
		body: action === "delete" ? undefined : (values.data ?? "{}"),
	});
	if (!res.ok) fail(`${res.status}: ${await res.text()}`);
	const text = await res.text();
	printRows(text ? JSON.parse(text) : [], values.json);
}

// ─── SQL mode (direct Postgres) ──────────────────────────────────────────────

function buildFromPoolerUrl(password: string): string {
	if (!existsSync(POOLER_URL_FILE)) {
		fail(
			`No PROD_DATABASE_URL and ${POOLER_URL_FILE} missing. Run \`supabase link\` or set PROD_DATABASE_URL.`,
		);
	}
	const u = new URL(readFileSync(POOLER_URL_FILE, "utf-8").trim());
	u.username = u.username || "postgres";
	u.password = password;
	return u.toString();
}

function resolveSqlUrl(explicit?: string): string {
	if (explicit) return explicit;
	const env = readEnv(["PROD_DATABASE_URL", "SUPABASE_DB_PASSWORD"], SQL_FILES);
	const url = env.PROD_DATABASE_URL ?? process.env.PROD_DATABASE_URL;
	if (url) return url;
	const pw = env.SUPABASE_DB_PASSWORD ?? process.env.SUPABASE_DB_PASSWORD;
	if (pw) return buildFromPoolerUrl(pw);
	return fail(
		"No prod DB connection found. Set PROD_DATABASE_URL in .env.cloud.local to\n" +
			"the self-host pooler DSN (from `bun scripts/db/migrate/print-cutover-env.ts`),\n" +
			"or SUPABASE_DB_PASSWORD in .env for the legacy hosted pooler.",
	);
}

async function runSql(argv: string[]) {
	const { values, positionals } = parseArgs({
		args: argv,
		options: {
			file: { type: "string", short: "f" },
			json: { type: "boolean", default: false },
			write: { type: "boolean", default: false },
			yes: { type: "boolean", default: false },
			url: { type: "string" },
		},
		allowPositionals: true,
		strict: true,
	});

	const connectionString = resolveSqlUrl(values.url);
	const target = new URL(connectionString);
	const isLocal =
		target.hostname === "127.0.0.1" || target.hostname === "localhost";
	const ref = target.username.split(".")[1] ?? "(unknown)";
	console.error(
		isLocal
			? `▶ LOCAL  ${target.hostname}:${target.port}  ${values.write ? "WRITE" : "read-only"}`
			: `▶ PRODUCTION SQL  ref=${ref}  ${values.write ? "WRITE" : "read-only"}`,
	);

	const wantsStdin = positionals.includes("-");
	const inline = positionals.find((p) => p !== "-");
	let sqlText = "";
	if (values.file) {
		const path = resolve(REPO_ROOT, values.file);
		if (!existsSync(path)) fail(`SQL file not found: ${path}`);
		sqlText = readFileSync(path, "utf-8");
	} else if (wantsStdin) {
		sqlText = await Bun.stdin.text();
	} else if (inline) {
		sqlText = inline;
	} else {
		fail("No SQL provided. Pass it inline, with -f <file>, or via stdin (-).");
	}
	sqlText = sqlText.trim();
	if (!sqlText) fail("Empty SQL.");

	if (values.write && !isLocal) confirmWrite(ref, values.yes, "SQL");

	const sql = postgres(connectionString, {
		prepare: false,
		max: 1,
		fetch_types: false,
		idle_timeout: 5,
	});
	try {
		// Supabase's pooler ignores the `-c default_transaction_read_only`
		// startup option, so enforce read-only with an explicit transaction:
		// `SET TRANSACTION READ ONLY` makes any mutation raise an error and the
		// surrounding BEGIN/COMMIT is rolled back on failure.
		const rows = values.write
			? await sql.unsafe(sqlText)
			: await sql.begin(async (tx) => {
					await tx.unsafe("set transaction read only");
					return tx.unsafe(sqlText);
				});
		printRows(rows, values.json);
	} catch (error) {
		fail(error instanceof Error ? error.message : String(error));
	} finally {
		await sql.end({ timeout: 5 });
	}
}

// ─── dispatch ────────────────────────────────────────────────────────────────

const [mode, ...rest] = process.argv.slice(2);
if (mode === "rest") await runRest(rest);
else if (mode === "sql") await runSql(rest);
else {
	fail(
		"Usage:\n" +
			"  bun run prod:rest <get|count|insert|update|delete|rpc> <table|fn> [flags]\n" +
			"  bun run prod:sql  '<query>' | -f <file> [--write] [--json]\n" +
			"Full runbook: the `supabase-prod` skill (.claude/skills/supabase-prod/SKILL.md).",
	);
}
