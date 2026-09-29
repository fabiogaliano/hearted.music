/**
 * ensureEnrichmentJob under a concurrent enqueue, against the real partial
 * unique index idx_unique_active_enrichment_per_account.
 *
 * The race is made deterministic by holding a competing enqueue in an open
 * transaction: ensureEnrichmentJob's read misses the uncommitted row, its
 * insert blocks on the unique index, and committing the competitor turns that
 * insert into a 23505 — the exact window the retry path exists for.
 *
 * Auto-skipped when DATABASE_URL / SUPABASE_URL are not the local stack.
 */

import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { ensureEnrichmentJob } from "@/lib/platform/jobs/library-processing-queue";
import { makeInitialProgress } from "@/lib/workflows/enrichment-pipeline/progress";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const IS_LOCAL =
	(DATABASE_URL.includes("127.0.0.1") || DATABASE_URL.includes("localhost")) &&
	SUPABASE_URL.startsWith("http://127.0.0.1");

const sql = IS_LOCAL
	? postgres(DATABASE_URL, { prepare: false, max: 3, fetch_types: false })
	: null;

function db() {
	if (!sql) throw new Error("postgres client not initialised");
	return sql;
}

const describeLocal = IS_LOCAL ? describe : describe.skip;

const createdAccountIds: string[] = [];

async function waitUntilBlockedOn(xid: string): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		const [row] = await db()`
      SELECT EXISTS (
        SELECT 1 FROM pg_locks
        WHERE locktype = 'transactionid'
          AND NOT granted
          AND transactionid::text = ${xid}
      ) AS blocked
    `;
		if (row.blocked) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("ensureEnrichmentJob insert never blocked on the competitor");
}

afterAll(async () => {
	if (!sql) return;
	for (const id of createdAccountIds) {
		await sql`DELETE FROM account WHERE id = ${id}`;
	}
	await sql.end();
});

describeLocal("ensureEnrichmentJob concurrent enqueue", () => {
	it("returns the competitor's job instead of a unique-violation error when a concurrent enqueue wins the insert", async () => {
		const accountId = crypto.randomUUID();
		await db()`INSERT INTO account(id, spotify_id) VALUES (${accountId}, ${`sp-${accountId}`})`;
		createdAccountIds.push(accountId);

		let ensurePromise: ReturnType<typeof ensureEnrichmentJob> | undefined;

		const competitorJobId = await db().begin(async (tx) => {
			const [job] = await tx`
        INSERT INTO job(account_id, type, status)
        VALUES (${accountId}, 'enrichment', 'pending')
        RETURNING id
      `;
			const [{ xid }] = await tx`SELECT pg_current_xact_id()::text AS xid`;

			ensurePromise = ensureEnrichmentJob({
				accountId,
				satisfiesRequestedAt: "2026-09-29T00:00:00Z",
				queuePriority: 100,
				progress: makeInitialProgress(5, 0, 0),
			});
			await waitUntilBlockedOn(xid);
			return job.id as string;
		});

		if (!ensurePromise) throw new Error("ensureEnrichmentJob never started");
		const result = await ensurePromise;

		expect(result).toBeOk();
		expect(result.unwrap().id).toBe(competitorJobId);

		const [{ count }] = await db()`
      SELECT count(*)::int AS count FROM job
      WHERE account_id = ${accountId} AND type = 'enrichment'
    `;
		expect(count).toBe(1);
	});
});
