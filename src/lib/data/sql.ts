import postgres from "postgres";
import { env } from "@/env";

let pool: ReturnType<typeof postgres> | undefined;

/**
 * The process's one raw-SQL pool, shared by Better Auth's adapter and the few
 * domain writes that need a transaction PostgREST can't express. Built on
 * first use: modules importing this also load in client-side test runs, where
 * reading a server env var throws.
 */
export function getSql(): ReturnType<typeof postgres> {
	pool ??= postgres(env.DATABASE_URL, {
		// DATABASE_URL may be a transaction-mode pooler, which can't hold prepared
		// statements across transactions.
		prepare: false,
		max: 8,
		idle_timeout: 20,
		fetch_types: false,
	});
	return pool;
}
