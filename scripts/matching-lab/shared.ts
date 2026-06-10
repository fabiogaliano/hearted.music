/**
 * Shared helpers for matching-lab scripts.
 *
 * The lab deliberately targets the LOCAL Supabase stack — these scripts exist
 * to poke at dev data, never production. Centralizing the client (and the
 * vector math every script re-implemented) means a port/JWT change or a guard
 * fix lands once instead of per-script.
 */

import { createClient } from "@supabase/supabase-js";

/** Well-known local-dev demo service-role JWT (supabase start default). */
const LOCAL_URL = "http://127.0.0.1:54321";
const LOCAL_SERVICE_ROLE_KEY =
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

export function createLocalLabClient() {
	return createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY);
}

export type LocalLabClient = ReturnType<typeof createLocalLabClient>;

/**
 * Fetch every row of a select, paging past PostgREST's max_rows cap (1000).
 * Throws on the first page error — lab scripts want loud failures.
 */
export async function selectAll<T>(
	client: LocalLabClient,
	table: string,
	columns: string,
	pageSize = 1000,
): Promise<T[]> {
	const rows: T[] = [];
	for (let from = 0; ; from += pageSize) {
		const { data, error } = await client
			.from(table)
			.select(columns)
			.range(from, from + pageSize - 1);
		if (error) {
			throw new Error(`selectAll(${table}) failed: ${error.message}`);
		}
		rows.push(...((data ?? []) as T[]));
		if (!data || data.length < pageSize) {
			return rows;
		}
	}
}

export function cosineSim(a: number[], b: number[]): number {
	if (a.length !== b.length) return 0;
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}

/** pgvector columns come back as JSON-ish strings; embeds from code as arrays. */
export function parseEmbedding(raw: string | number[] | null): number[] | null {
	if (!raw) return null;
	if (Array.isArray(raw)) return raw;
	try {
		return JSON.parse(raw) as number[];
	} catch {
		return null;
	}
}

/** NaN on empty input so missing data is visible in printed stats. */
export function mean(values: number[]): number {
	return values.length === 0
		? Number.NaN
		: values.reduce((s, v) => s + v, 0) / values.length;
}
