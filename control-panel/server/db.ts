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
			prepare: false,
			max: 4,
			fetch_types: false,
			idle_timeout: 20,
		});
	}
	return client;
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
