import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NOTIFY_CHANNEL_WAKE } from "@/lib/account-events/contract";
import { writeAccountEvent } from "@/lib/account-events/producer";
import { publishAccountEvents } from "../poll-account-events";

const DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const IS_LOCAL =
	DATABASE_URL.includes("127.0.0.1") || DATABASE_URL.includes("localhost");

const sql = IS_LOCAL
	? postgres(DATABASE_URL, { prepare: false, max: 10, fetch_types: false })
	: (null as unknown as postgres.Sql<Record<string, never>>);

const describeLocal = IS_LOCAL ? describe : describe.skip;

describeLocal("publishAccountEvents", () => {
	const accountId = crypto.randomUUID();

	beforeAll(async () => {
		await sql`INSERT INTO account (id, spotify_id, email) VALUES (${accountId}, ${`pub-${accountId}`}, 'pub@test.com')`;
	});

	afterAll(async () => {
		await sql`DELETE FROM account WHERE id = ${accountId}`;
		await sql.end();
	});

	it("assigns publish_ids sequentially without gaps and emits targeted NOTIFY", async () => {
		const wakePayloads: string[] = [];
		const sqlListen = postgres(DATABASE_URL, {
			prepare: false,
			max: 1,
			fetch_types: false,
			idle_timeout: 0,
			onnotice: () => {},
		});

		await sqlListen.listen(
			NOTIFY_CHANNEL_WAKE,
			(payload) => {
				wakePayloads.push(payload);
			},
			() => {},
		);
		await new Promise((r) => setTimeout(r, 100)); // wait for LISTEN

		// Stage 3 events using the producer (so publish_id IS NULL)
		await sql.begin(async (tx) => {
			await writeAccountEvent(tx, {
				accountId,
				type: "billing_state_changed",
				payload: {},
			});
			await writeAccountEvent(tx, {
				accountId,
				type: "billing_state_changed",
				payload: {},
			});
			await writeAccountEvent(tx, {
				accountId,
				type: "billing_state_changed",
				payload: {},
			});
		});

		// Call publisher
		await publishAccountEvents(sql);

		// Wait for wake
		await new Promise((r) => setTimeout(r, 100));

		// It should emit 1 coalesce NOTIFY since we called publishAccountEvents once
		expect(wakePayloads).toHaveLength(1);
		const wakePayload: unknown = JSON.parse(wakePayloads[0] ?? "{}");
		// Other publishers can legitimately contribute pending events to this
		// coalesced wake-up; this run must still include the account it published.
		expect(wakePayload).toEqual(
			expect.objectContaining({
				accountIds: expect.arrayContaining([accountId]),
			}),
		);

		// Verify rows
		const rows = await sql<{ id: number; publish_id: number }[]>`
			SELECT id, publish_id FROM account_event 
			WHERE account_id = ${accountId} 
			ORDER BY id ASC
		`;

		expect(rows).toHaveLength(3);
		expect(rows[0].publish_id).not.toBeNull();
		expect(Number(rows[1].publish_id)).toBe(Number(rows[0].publish_id) + 1);
		expect(Number(rows[2].publish_id)).toBe(Number(rows[1].publish_id) + 1);

		await sqlListen.end();
	});

	it("handles concurrent publisher candidates safely (no duplicate publish_id, no skipped)", async () => {
		// Stage 10 events
		await sql.begin(async (tx) => {
			for (let i = 0; i < 10; i++) {
				await tx`
					INSERT INTO account_event (account_id, type, payload)
					VALUES (${accountId}, 'billing_state_changed', '{}'::jsonb)
				`;
			}
		});

		// Two distinct connections for two publisher instances
		const sql1 = postgres(DATABASE_URL, {
			prepare: false,
			max: 1,
			fetch_types: false,
		});
		const sql2 = postgres(DATABASE_URL, {
			prepare: false,
			max: 1,
			fetch_types: false,
		});

		// Both call publishAccountEvents concurrently
		await Promise.all([publishAccountEvents(sql1), publishAccountEvents(sql2)]);

		const rows = await sql<{ id: number; publish_id: number }[]>`
			SELECT id, publish_id FROM account_event 
			WHERE account_id = ${accountId} AND publish_id IS NOT NULL
			ORDER BY id ASC
		`;

		// Ensure that all events got published
		const latest10 = rows.slice(-10);
		expect(latest10).toHaveLength(10);

		// Ensure gapless sequence in this batch
		for (let i = 1; i < latest10.length; i++) {
			expect(Number(latest10[i].publish_id)).toBe(
				Number(latest10[i - 1].publish_id) + 1,
			);
		}

		await sql1.end();
		await sql2.end();
	});

	it("recovers rows if a candidate dies mid-batch", async () => {
		// Insert a row
		await sql`INSERT INTO account_event (account_id, type, payload) VALUES (${accountId}, 'billing_state_changed', '{}'::jsonb)`;

		const mockDeadSql = postgres(DATABASE_URL, {
			prepare: false,
			max: 1,
			fetch_types: false,
		});

		// Simulate a crash by starting a transaction, taking the advisory lock, and then throwing
		await expect(
			mockDeadSql.begin(async (tx) => {
				await tx`SELECT pg_try_advisory_xact_lock(hashtext('account_event_publisher'))`;
				// Lock is acquired, now we "crash"
				throw new Error("mid-batch crash");
			}),
		).rejects.toThrow("mid-batch crash");

		// Transaction rolls back, advisory lock is released.
		// New candidate should be able to claim it.
		const sql3 = postgres(DATABASE_URL, {
			prepare: false,
			max: 1,
			fetch_types: false,
		});
		await publishAccountEvents(sql3);

		const rows = await sql`
			SELECT id, publish_id FROM account_event 
			WHERE account_id = ${accountId} 
			ORDER BY id DESC LIMIT 1
		`;

		expect(rows[0].publish_id).not.toBeNull();

		await mockDeadSql.end();
		await sql3.end();
	});
});
