/**
 * Lazy, shared prod Postgres connection for read-only metric queries.
 *
 * Every query runs inside an explicit read-only transaction — the same belt the
 * skill's prod:sql uses, because Supabase's pooler silently drops the
 * `default_transaction_read_only` startup option. A stray write raises instead
 * of mutating prod.
 */

import postgres from "postgres";
import { getSqlTarget } from "./prod-creds";

let client: ReturnType<typeof postgres> | null = null;
let connRef = "(unknown)";

function getClient(): ReturnType<typeof postgres> {
	if (!client) {
		const { connectionString, ref } = getSqlTarget();
		connRef = ref;
		client = postgres(connectionString, {
			// prepare:false is required for Supabase's transaction pooler — named
			// prepared statements aren't shared across pooled backends.
			prepare: false,
			// Kept modest on purpose: the free-tier pooler exposes only ~15-20
			// backend processes and the panel also uses the PostgREST client for
			// operations, so we stay well under ~40% of that. Caching + in-flight
			// de-dup (cache.ts) keep real concurrency low, so this rarely saturates.
			max: 6,
			fetch_types: false,
			// Hold connections longer so back-to-back interactive use reuses a warm
			// link instead of paying a fresh TLS handshake to the remote pooler.
			idle_timeout: 120,
		});
	}
	return client;
}

/** Open the connection ahead of the first request so the first load isn't cold. */
export async function warm(): Promise<void> {
	try {
		await read("select 1");
	} catch {
		// Best-effort: a failed warm-up just means the first real request pays the
		// connection cost, exactly as before.
	}
}

export function prodRef(): string {
	getClient();
	return connRef;
}

/** Run a read-only SQL statement and return the rows. $1-style params are bound. */
export async function read<T = Record<string, unknown>>(
	text: string,
	params: unknown[] = [],
): Promise<T[]> {
	const sql = getClient();
	const rows = await sql.begin(async (tx) => {
		await tx.unsafe("set transaction read only");
		return tx.unsafe(text, params as never);
	});
	return rows as unknown as T[];
}

/** A bound `$1`-style statement runner inside an open read-write transaction. */
export type TxRun = <T = Record<string, unknown>>(
	text: string,
	params?: unknown[],
) => Promise<T[]>;

/**
 * Run a deliberate read-WRITE transaction. The default surface of this module is
 * read-only on purpose; this is the narrow, explicit escape hatch for the
 * operator review actions (approve/reject/replace), which must atomically delete
 * the exact feature row and its now-stale downstream artifacts. Unlike `read`,
 * it does NOT set the transaction read-only, so writes commit. The callback gets
 * a runner; throw to roll the whole transaction back.
 */
export async function tx<T>(fn: (run: TxRun) => Promise<T>): Promise<T> {
	const sql = getClient();
	return sql.begin(async (t) => {
		const run: TxRun = async <R = Record<string, unknown>>(
			text: string,
			params: unknown[] = [],
		) => {
			const rows = await t.unsafe(text, params as never);
			return rows as unknown as R[];
		};
		return fn(run);
	}) as Promise<T>;
}
