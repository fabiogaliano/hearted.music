/**
 * Database security invariants (CI guard).
 *
 * The application reaches Postgres only through the service-role key, which
 * BYPASSES RLS. RLS + the absence of anon/authenticated grants are therefore
 * the sole defense for the public PostgREST endpoint. A new table created
 * without a deny-all policy, a SECURITY DEFINER function exposed to anon, or a
 * stray grant would silently re-open that endpoint. These tests fail the build
 * when any of those invariants regress.
 *
 * Connects with postgres.js against the direct DATABASE_URL (introspection
 * needs raw SQL, which the PostgREST client can't run). Auto-skipped when
 * DATABASE_URL is not local so CI without a local stack is unaffected.
 */

import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const IS_LOCAL =
	DATABASE_URL.includes("127.0.0.1") || DATABASE_URL.includes("localhost");

const sql = IS_LOCAL
	? postgres(DATABASE_URL, { prepare: false, max: 1, fetch_types: false })
	: null;

function db() {
	if (!sql) throw new Error("postgres client not initialised");
	return sql;
}

afterAll(async () => {
	if (sql) await sql.end();
});

const describeLocal = IS_LOCAL ? describe : describe.skip;

describeLocal("database security invariants", () => {
	it("every public table has RLS enabled and at least one policy", async () => {
		const client = db();
		const offenders = await client<{ table: string }[]>`
			SELECT c.relname AS "table"
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = 'public'
				AND c.relkind = 'r'
				AND (
					NOT c.relrowsecurity
					OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
				)
			ORDER BY 1`;

		expect(offenders.map((r) => r.table)).toEqual([]);
	});

	it("no public routine is executable by anon/authenticated", async () => {
		const client = db();
		const offenders = await client<{ fn: string }[]>`
			SELECT p.proname AS fn
			FROM pg_proc p
			JOIN pg_namespace n ON n.oid = p.pronamespace
			WHERE n.nspname = 'public'
				AND (
					has_function_privilege('anon', p.oid, 'EXECUTE')
					OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
				)
			ORDER BY 1`;

		expect(offenders.map((r) => r.fn)).toEqual([]);
	});

	it("every SECURITY DEFINER function pins search_path", async () => {
		const client = db();
		const offenders = await client<{ fn: string }[]>`
			SELECT p.proname AS fn
			FROM pg_proc p
			JOIN pg_namespace n ON n.oid = p.pronamespace
			WHERE n.nspname = 'public'
				AND p.prosecdef
				AND COALESCE(
					(SELECT bool_or(cfg LIKE 'search_path=%')
					 FROM unnest(COALESCE(p.proconfig, '{}')) cfg),
					false
				) = false
			ORDER BY 1`;

		expect(offenders.map((r) => r.fn)).toEqual([]);
	});

	it("anon and authenticated hold no privileges on any public table", async () => {
		const client = db();
		const offenders = await client<{ grantee: string }[]>`
			SELECT DISTINCT grantee
			FROM information_schema.role_table_grants
			WHERE table_schema = 'public'
				AND grantee IN ('anon', 'authenticated')`;

		expect(offenders.map((r) => r.grantee)).toEqual([]);
	});
});
