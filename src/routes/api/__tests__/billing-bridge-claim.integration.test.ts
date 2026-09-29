/**
 * billing_bridge_event claim/finalize state machine against real Postgres.
 *
 * The route's idempotency rests entirely on these RPCs: claim decides whether
 * a handler runs, and the mark_* finalizers decide what the next upstream
 * retry sees. Lease expiry is simulated by backdating processing_started_at so
 * the test never sleeps.
 *
 * Auto-skipped when DATABASE_URL / SUPABASE_URL are not the local stack.
 */

import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const IS_LOCAL =
	(DATABASE_URL.includes("127.0.0.1") || DATABASE_URL.includes("localhost")) &&
	SUPABASE_URL.startsWith("http://127.0.0.1");

const sql = IS_LOCAL
	? postgres(DATABASE_URL, { prepare: false, max: 2, fetch_types: false })
	: null;

function db() {
	if (!sql) throw new Error("postgres client not initialised");
	return sql;
}

const describeLocal = IS_LOCAL ? describe : describe.skip;

const LEASE_MS = 5 * 60 * 1000;
const EVENT_PREFIX = `evt_bridge_claim_test_${crypto.randomUUID()}_`;
let eventSeq = 0;

function newEventId(): string {
	eventSeq += 1;
	return `${EVENT_PREFIX}${eventSeq}`;
}

async function claim(eventId: string, token?: string): Promise<string> {
	const [row] = token
		? await db()`SELECT claim_billing_bridge_event(${eventId}, 'pack_fulfilled', ${LEASE_MS}, ${token}::uuid) AS outcome`
		: await db()`SELECT claim_billing_bridge_event(${eventId}, 'pack_fulfilled', ${LEASE_MS}) AS outcome`;
	return row.outcome;
}

async function markProcessed(
	eventId: string,
	token?: string,
): Promise<boolean> {
	const [row] = token
		? await db()`SELECT mark_billing_bridge_event_processed(${eventId}, ${token}::uuid) AS owned`
		: await db()`SELECT mark_billing_bridge_event_processed(${eventId}) AS owned`;
	return row.owned;
}

async function markFailed(eventId: string, token?: string): Promise<boolean> {
	const [row] = token
		? await db()`SELECT mark_billing_bridge_event_failed(${eventId}, 'handler threw', ${token}::uuid) AS owned`
		: await db()`SELECT mark_billing_bridge_event_failed(${eventId}, 'handler threw') AS owned`;
	return row.owned;
}

async function expireLease(eventId: string): Promise<void> {
	await db()`
    UPDATE billing_bridge_event
       SET processing_started_at = now() - interval '10 minutes'
     WHERE stripe_event_id = ${eventId}
  `;
}

async function readStatus(eventId: string): Promise<string> {
	const [row] = await db()`
    SELECT status FROM billing_bridge_event WHERE stripe_event_id = ${eventId}
  `;
	return row.status;
}

afterAll(async () => {
	if (!sql) return;
	await sql`DELETE FROM billing_bridge_event WHERE stripe_event_id LIKE ${`${EVENT_PREFIX}%`}`;
	await sql.end();
});

describeLocal("claim_billing_bridge_event", () => {
	it("claims an unseen event and leaves it processing", async () => {
		const eventId = newEventId();

		expect(await claim(eventId, crypto.randomUUID())).toBe("claimed");
		expect(await readStatus(eventId)).toBe("processing");
	});

	it("reports duplicate_processed once the claim holder finalizes successfully", async () => {
		const eventId = newEventId();
		const token = crypto.randomUUID();

		await claim(eventId, token);
		await markProcessed(eventId, token);

		expect(await claim(eventId, crypto.randomUUID())).toBe(
			"duplicate_processed",
		);
	});

	it("reports in_progress while another holder's lease is still valid", async () => {
		const eventId = newEventId();

		await claim(eventId, crypto.randomUUID());

		expect(await claim(eventId, crypto.randomUUID())).toBe("in_progress");
	});

	it("reclaims a processing row whose lease has expired", async () => {
		const eventId = newEventId();

		await claim(eventId, crypto.randomUUID());
		await expireLease(eventId);

		expect(await claim(eventId, crypto.randomUUID())).toBe("claimed");
	});

	it("reclaims an event whose previous handler run failed", async () => {
		const eventId = newEventId();
		const token = crypto.randomUUID();

		await claim(eventId, token);
		await markFailed(eventId, token);

		expect(await readStatus(eventId)).toBe("failed");
		expect(await claim(eventId, crypto.randomUUID())).toBe("claimed");
	});

	it("regression: a stale lease holder's failure cannot overwrite a processed outcome and re-run the handler", async () => {
		const eventId = newEventId();

		// Worker A claims, stalls past its lease; worker B reclaims and succeeds.
		await claim(eventId);
		await expireLease(eventId);
		await claim(eventId);
		await markProcessed(eventId);

		// A's handler finally throws and it reports failure for the same event.
		await markFailed(eventId);

		expect(await readStatus(eventId)).toBe("processed");
		expect(await claim(eventId)).toBe("duplicate_processed");
	});

	it("regression: a stale lease holder's failure cannot release a live reclaim for a concurrent third run", async () => {
		const eventId = newEventId();
		const staleToken = crypto.randomUUID();
		const liveToken = crypto.randomUUID();

		await claim(eventId, staleToken);
		await expireLease(eventId);
		expect(await claim(eventId, liveToken)).toBe("claimed");

		expect(await markFailed(eventId, staleToken)).toBe(false);

		expect(await readStatus(eventId)).toBe("processing");
		expect(await claim(eventId, crypto.randomUUID())).toBe("in_progress");

		expect(await markProcessed(eventId, liveToken)).toBe(true);
		expect(await readStatus(eventId)).toBe("processed");
	});

	it("regression: a stale lease holder's success is reported as a lost claim so the route does not ack it", async () => {
		const eventId = newEventId();
		const staleToken = crypto.randomUUID();

		await claim(eventId, staleToken);
		await expireLease(eventId);
		expect(await claim(eventId, crypto.randomUUID())).toBe("claimed");

		expect(await markProcessed(eventId, staleToken)).toBe(false);
		expect(await readStatus(eventId)).toBe("processing");
	});

	it("still finalizes events claimed without a token by a pre-token deploy", async () => {
		const eventId = newEventId();

		await claim(eventId);
		await markProcessed(eventId);

		expect(await claim(eventId)).toBe("duplicate_processed");
	});
});
