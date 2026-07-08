import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NOTIFY_CHANNEL_INSERTED } from "../contract";
import { writeAccountEvent } from "../producer";

const DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const IS_LOCAL =
	DATABASE_URL.includes("127.0.0.1") || DATABASE_URL.includes("localhost");

const sql = IS_LOCAL
	? postgres(DATABASE_URL, { prepare: false, max: 5, fetch_types: false })
	: (null as unknown as postgres.Sql<{}>);

const describeLocal = IS_LOCAL ? describe : describe.skip;

describeLocal("writeAccountEvent", () => {
	const accountId = crypto.randomUUID();

	beforeAll(async () => {
		await sql`INSERT INTO account (id, spotify_id, email) VALUES (${accountId}, ${`test-${accountId}`}, 'test@test.com')`;
	});

	afterAll(async () => {
		await sql`DELETE FROM account WHERE id = ${accountId}`;
		await sql.end();
	});

	it("inserts an event and notifies inside a transaction", async () => {
		let notified = false;

		const sqlListen = postgres(DATABASE_URL, {
			prepare: false,
			max: 1,
			fetch_types: false,
			idle_timeout: 0,
			onnotice: () => {},
		});

		await sqlListen.listen(
			NOTIFY_CHANNEL_INSERTED,
			(payload) => {
				notified = true;
			},
			() => {},
		);

		// wait for LISTEN to establish
		await new Promise((r) => setTimeout(r, 100));

		await sql.begin(async (tx) => {
			await writeAccountEvent(tx, {
				accountId,
				type: "billing_state_changed",
				payload: {},
			});
		});

		// wait for NOTIFY to arrive
		await new Promise((r) => setTimeout(r, 100));

		expect(notified).toBe(true);

		const rows =
			await sql`SELECT * FROM account_event WHERE account_id = ${accountId}`;
		expect(rows).toHaveLength(1);
		expect(rows[0].type).toBe("billing_state_changed");
		expect(rows[0].publish_id).toBeNull();

		await sqlListen.end();
	});

	it("rolls back safely on error without inserting or notifying", async () => {
		let notified = false;

		const sqlListen = postgres(DATABASE_URL, {
			prepare: false,
			max: 1,
			fetch_types: false,
			idle_timeout: 0,
			onnotice: () => {},
		});

		await sqlListen.listen(
			NOTIFY_CHANNEL_INSERTED,
			(payload) => {
				notified = true;
			},
			() => {},
		);

		// wait for LISTEN to establish
		await new Promise((r) => setTimeout(r, 100));

		await expect(
			sql.begin(async (tx) => {
				await writeAccountEvent(tx, {
					accountId,
					type: "billing_state_changed",
					payload: {},
				});
				throw new Error("test rollback");
			}),
		).rejects.toThrow("test rollback");

		// wait for NOTIFY to arrive (it shouldn't)
		await new Promise((r) => setTimeout(r, 100));

		expect(notified).toBe(false);

		// The previous test inserted one row, so count should still be 1
		const rows =
			await sql`SELECT * FROM account_event WHERE account_id = ${accountId}`;
		expect(rows).toHaveLength(1);

		await sqlListen.end();
	});
});
