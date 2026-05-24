/**
 * Shared helpers for the auth E2E suite.
 *
 * These tests run against a LIVE local stack (dev server + local Supabase),
 * so they live outside the Vitest suite and are invoked via `bun run test:e2e`.
 * No @playwright/test runner — we use the bare `playwright` library plus a tiny
 * assertion collector, matching how the suite was first prototyped.
 */

import postgres from "postgres";

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
export const TEST_EMAIL_PATTERN = "e2e-%@hearted.test";

// ── assertions ──────────────────────────────────────────────────────────────

type Check = { name: string; pass: boolean; detail: string };

export function makeReporter() {
	const checks: Check[] = [];
	return {
		ok(name: string, cond: unknown, detail = "") {
			const pass = !!cond;
			checks.push({ name, pass, detail });
			console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
		},
		summary() {
			const passed = checks.filter((c) => c.pass).length;
			console.log(`\n=== ${passed}/${checks.length} checks passed ===`);
			return { passed, total: checks.length, failed: checks.filter((c) => !c.pass) };
		},
	};
}

// ── HTTP client with a cookie jar (Better Auth needs Origin + cookies) ────────

export function makeClient() {
	const jar = new Map<string, string>();
	return {
		async fetchJson(
			path: string,
			init: { method?: string; body?: unknown } = {},
		) {
			const headers: Record<string, string> = {
				Origin: BASE_URL,
				"Content-Type": "application/json",
			};
			if (jar.size > 0) {
				headers.Cookie = [...jar.entries()]
					.map(([k, v]) => `${k}=${v}`)
					.join("; ");
			}
			const res = await fetch(`${BASE_URL}${path}`, {
				method: init.method ?? "GET",
				headers,
				body: init.body === undefined ? undefined : JSON.stringify(init.body),
				redirect: "manual",
			});
			for (const c of res.headers.getSetCookie?.() ?? []) {
				const [pair] = c.split(";");
				const idx = pair.indexOf("=");
				if (idx > 0) jar.set(pair.slice(0, idx), pair.slice(idx + 1));
			}
			const text = await res.text();
			let json: unknown = null;
			try {
				json = text ? JSON.parse(text) : null;
			} catch {
				json = text;
			}
			return { status: res.status, json, headers: res.headers };
		},
		cookieCount() {
			return jar.size;
		},
	};
}

// ── DB access (direct postgres, same connection style as auth.ts) ─────────────

let sqlSingleton: ReturnType<typeof postgres> | null = null;
export function db() {
	if (!sqlSingleton) {
		const url = process.env.DATABASE_URL;
		if (!url) throw new Error("DATABASE_URL not set — is .env loaded?");
		sqlSingleton = postgres(url, { prepare: false, max: 1, idle_timeout: 5 });
	}
	return sqlSingleton;
}
export async function closeDb() {
	if (sqlSingleton) {
		await sqlSingleton.end({ timeout: 5 });
		sqlSingleton = null;
	}
}

/** Removes every user this suite could have created. Order matters: the app
 *  `account.better_auth_user_id` FK is NOT cascade-on-delete, so app rows go
 *  first, then the better-auth user (which DOES cascade to oauth_account/session). */
export async function cleanupTestUsers() {
	const sql = db();
	await sql`DELETE FROM account WHERE email LIKE ${TEST_EMAIL_PATTERN}`;
	await sql`DELETE FROM "user" WHERE email LIKE ${TEST_EMAIL_PATTERN}`;
}

export async function probeServer() {
	try {
		const res = await fetch(`${BASE_URL}/api/auth/get-session`, {
			headers: { Origin: BASE_URL },
		});
		if (!res.ok) throw new Error(`status ${res.status}`);
	} catch (e) {
		console.error(
			`\nCannot reach the app at ${BASE_URL}.\n` +
				`Start local Supabase (\`supabase start\`) and the dev server (\`bun run dev\`) first.\n` +
				`Underlying error: ${(e as Error).message}\n`,
		);
		process.exit(1);
	}
}
