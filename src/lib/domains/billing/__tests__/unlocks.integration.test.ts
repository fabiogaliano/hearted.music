/**
 * unlock_songs_for_account against real Postgres — the only place credits are
 * spent. unlocks.test.ts mocks the RPC, so the charging rules (dedupe, no
 * charge for already-unlocked songs, all-or-nothing on insufficient balance,
 * reserved conversion credits, row-lock serialization) are only proven here.
 *
 * Races are made deterministic by holding the competing row locks (the
 * account_billing row, or a conversion prepare's lot locks) in an open
 * transaction until the racing unlocks are parked on them.
 *
 * Auto-skipped when DATABASE_URL / SUPABASE_URL are not the local stack.
 */

import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const IS_LOCAL =
	(DATABASE_URL.includes("127.0.0.1") || DATABASE_URL.includes("localhost")) &&
	SUPABASE_URL.startsWith("http://127.0.0.1");

const RACER_APP_NAME = `unlock-race-${crypto.randomUUID()}`;

const sql = IS_LOCAL
	? postgres(DATABASE_URL, { prepare: false, max: 3, fetch_types: false })
	: null;
// Separate pool tagged with a unique application_name so the lock-wait probe
// only counts this file's competing unlocks.
const racers = IS_LOCAL
	? postgres(DATABASE_URL, {
			prepare: false,
			max: 2,
			fetch_types: false,
			connection: { application_name: RACER_APP_NAME },
		})
	: null;

function db() {
	if (!sql) throw new Error("postgres client not initialised");
	return sql;
}

function racerDb() {
	if (!racers) throw new Error("postgres client not initialised");
	return racers;
}

const describeLocal = IS_LOCAL ? describe : describe.skip;

type UnlockPayload =
	| {
			status: "ok";
			newly_unlocked_song_ids: string[];
			already_unlocked_song_ids: string[];
			credit_balance: number;
	  }
	| {
			status: "insufficient_balance";
			required_credits: number;
			available_credits: number;
	  };

const createdAccountIds: string[] = [];
const createdSongIds: string[] = [];

async function seedAccount(args: {
	creditBalance: number;
	likedSongs: number;
}): Promise<{ accountId: string; songIds: string[] }> {
	const accountId = crypto.randomUUID();
	await db()`INSERT INTO account(id, spotify_id) VALUES (${accountId}, ${`test-${accountId}`})`;
	createdAccountIds.push(accountId);
	await db()`
    INSERT INTO account_billing(account_id, plan, subscription_status, credit_balance)
    VALUES (${accountId}, 'free', 'none', ${args.creditBalance})
  `;

	const songIds = Array.from({ length: args.likedSongs }, () =>
		crypto.randomUUID(),
	);
	for (const songId of songIds) {
		await db()`
      INSERT INTO song(id, spotify_id, name, artists, artist_ids, genres)
      VALUES (${songId}, ${`sp-${songId}`}, 'Unlock Test Song', ARRAY['Tester'], ARRAY['art'], '{}'::text[])
    `;
		createdSongIds.push(songId);
		await db()`
      INSERT INTO liked_song(account_id, song_id, liked_at)
      VALUES (${accountId}, ${songId}, now())
    `;
	}
	return { accountId, songIds };
}

async function seedPackLot(args: {
	accountId: string;
	credits: number;
	createdAt: string;
}): Promise<string> {
	const [lot] = await db()`
    INSERT INTO pack_credit_lot(
      account_id, stripe_event_id, offer_id, original_credits,
      remaining_credits, price_cents, created_at
    )
    VALUES (
      ${args.accountId}, ${`evt_lot_${crypto.randomUUID()}`}, 'test-pack',
      ${args.credits}, ${args.credits}, 500, ${args.createdAt}
    )
    RETURNING id
  `;
	return lot.id;
}

async function unlock(
	accountId: string,
	songIds: string[],
	client: postgres.Sql = db(),
): Promise<UnlockPayload> {
	// fetch_types is off, so the array goes over the wire as a literal.
	const songIdArray = `{${songIds.join(",")}}`;
	const [row] = await client`
    SELECT unlock_songs_for_account(${accountId}::uuid, ${songIdArray}::uuid[]) AS payload
  `;
	return row.payload;
}

async function readBalance(accountId: string): Promise<number> {
	const [row] = await db()`
    SELECT credit_balance FROM account_billing WHERE account_id = ${accountId}
  `;
	return row.credit_balance;
}

async function countActiveUnlocks(accountId: string): Promise<number> {
	const [row] = await db()`
    SELECT count(*)::int AS n FROM account_song_unlock
    WHERE account_id = ${accountId} AND revoked_at IS NULL
  `;
	return row.n;
}

async function readUnlockLedger(
	accountId: string,
): Promise<{ amount: number; balance_after: number }[]> {
	return db()`
    SELECT amount, balance_after FROM credit_transaction
    WHERE account_id = ${accountId} AND reason = 'song_unlock'
    ORDER BY created_at
  `;
}

async function waitForParkedRacers(count: number): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		const [row] = await db()`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE application_name = ${RACER_APP_NAME} AND wait_event_type = 'Lock'
    `;
		if (row.n === count) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`expected ${count} unlocks parked on a row lock`);
}

/**
 * Starts both unlocks while the billing row is locked and releases it only
 * once both are parked, so each has already passed any pre-lock reads.
 */
async function raceUnlocks(
	accountId: string,
	first: string[],
	second: string[],
): Promise<[UnlockPayload, UnlockPayload]> {
	let racing: Promise<[UnlockPayload, UnlockPayload]> | undefined;
	await db().begin(async (tx) => {
		await tx`SELECT 1 FROM account_billing WHERE account_id = ${accountId} FOR UPDATE`;
		racing = Promise.all([
			unlock(accountId, first, racerDb()),
			unlock(accountId, second, racerDb()),
		]);
		await waitForParkedRacers(2);
	});
	if (!racing) throw new Error("race never started");
	return racing;
}

afterEach(async () => {
	if (!sql) return;
	for (const id of createdAccountIds.splice(0)) {
		await sql`DELETE FROM account WHERE id = ${id}`;
	}
	for (const id of createdSongIds.splice(0)) {
		await sql`DELETE FROM song WHERE id = ${id}`;
	}
});

afterAll(async () => {
	await sql?.end();
	await racers?.end();
});

describeLocal("unlock_songs_for_account", () => {
	it("charges one credit per distinct new song and returns the committed balance", async () => {
		const { accountId, songIds } = await seedAccount({
			creditBalance: 5,
			likedSongs: 3,
		});
		const [a, b, c] = songIds as [string, string, string];

		const result = await unlock(accountId, [a, b, c, a]);

		expect(result).toEqual({
			status: "ok",
			newly_unlocked_song_ids: expect.arrayContaining([a, b, c]),
			already_unlocked_song_ids: [],
			credit_balance: 2,
		});
		expect(await readBalance(accountId)).toBe(2);
		expect(await readUnlockLedger(accountId)).toEqual([
			{ amount: -3, balance_after: 2 },
		]);
	});

	it("never charges again for songs the account already unlocked", async () => {
		const { accountId, songIds } = await seedAccount({
			creditBalance: 3,
			likedSongs: 2,
		});
		const [a, b] = songIds as [string, string];
		await unlock(accountId, [a]);

		const repeat = await unlock(accountId, [a]);
		const mixed = await unlock(accountId, [a, b]);

		expect(repeat).toEqual({
			status: "ok",
			newly_unlocked_song_ids: [],
			already_unlocked_song_ids: [a],
			credit_balance: 2,
		});
		expect(mixed).toEqual({
			status: "ok",
			newly_unlocked_song_ids: [b],
			already_unlocked_song_ids: [a],
			credit_balance: 1,
		});
		expect(await readBalance(accountId)).toBe(1);
		expect(await readUnlockLedger(accountId)).toEqual([
			{ amount: -1, balance_after: 2 },
			{ amount: -1, balance_after: 1 },
		]);
	});

	it("unlocks nothing and charges nothing when the balance cannot cover every new song", async () => {
		const { accountId, songIds } = await seedAccount({
			creditBalance: 1,
			likedSongs: 2,
		});

		const result = await unlock(accountId, songIds);

		expect(result).toEqual({
			status: "insufficient_balance",
			required_credits: 2,
			available_credits: 1,
		});
		expect(await readBalance(accountId)).toBe(1);
		expect(await countActiveUnlocks(accountId)).toBe(0);
		expect(await readUnlockLedger(accountId)).toEqual([]);
	});

	it("regression: spending never drains pack credits reserved by a pending upgrade conversion", async () => {
		// Lot A (5) is reserved by the pending conversion; lot B (5) arrives
		// after the checkout started. Only B's 5 credits are spendable.
		const { accountId, songIds } = await seedAccount({
			creditBalance: 5,
			likedSongs: 6,
		});
		const reservedLot = await seedPackLot({
			accountId,
			credits: 5,
			createdAt: "2026-09-01T00:00:00Z",
		});
		const [conversion] = await db()`
      SELECT conversion_id, converted_credits
      FROM prepare_subscription_upgrade_conversion(${accountId}::uuid, 'quarterly')
    `;
		expect(conversion?.converted_credits).toBe(5);
		const freshLot = await seedPackLot({
			accountId,
			credits: 5,
			createdAt: "2026-09-02T00:00:00Z",
		});
		await db()`UPDATE account_billing SET credit_balance = 10 WHERE account_id = ${accountId}`;

		expect(await unlock(accountId, songIds)).toEqual({
			status: "insufficient_balance",
			required_credits: 6,
			available_credits: 5,
		});
		expect(await unlock(accountId, songIds.slice(0, 5))).toMatchObject({
			status: "ok",
			credit_balance: 5,
		});

		const lots = await db()`
      SELECT id, remaining_credits FROM pack_credit_lot WHERE account_id = ${accountId}
    `;
		expect(
			Object.fromEntries(lots.map((l) => [l.id, l.remaining_credits])),
		).toEqual({
			[reservedLot]: 5,
			[freshLot]: 0,
		});

		// The upgrade can still consume exactly what it reserved.
		await db()`
      SELECT apply_subscription_upgrade_conversion(
        ${conversion?.conversion_id}::uuid, 'sub_test', 'in_test', ${`evt_apply_${accountId}`}
      )
    `;
		expect(await readBalance(accountId)).toBe(0);
	});

	it("regression: an unlock racing an in-flight conversion prepare cannot drain the lot it reserves", async () => {
		const { accountId, songIds } = await seedAccount({
			creditBalance: 5,
			likedSongs: 1,
		});
		const lot = await seedPackLot({
			accountId,
			credits: 5,
			createdAt: "2026-09-01T00:00:00Z",
		});

		// Prepare reserves the whole lot but stays uncommitted until the unlock
		// is parked, so the unlock's reservation read predates the commit.
		let unlocking: Promise<UnlockPayload> | undefined;
		const conversion = await db().begin(async (tx) => {
			const [prepared] = await tx`
        SELECT conversion_id
        FROM prepare_subscription_upgrade_conversion(${accountId}::uuid, 'quarterly')
      `;
			unlocking = unlock(accountId, songIds, racerDb());
			await waitForParkedRacers(1);
			return prepared;
		});
		if (!unlocking) throw new Error("race never started");

		expect(await unlocking).toEqual({
			status: "insufficient_balance",
			required_credits: 1,
			available_credits: 0,
		});
		const [lotRow] = await db()`
      SELECT remaining_credits FROM pack_credit_lot WHERE id = ${lot}
    `;
		expect(lotRow?.remaining_credits).toBe(5);

		await db()`
      SELECT apply_subscription_upgrade_conversion(
        ${conversion?.conversion_id}::uuid, 'sub_test', 'in_test', ${`evt_apply_${accountId}`}
      )
    `;
		expect(await readBalance(accountId)).toBe(0);
	});

	it("two concurrent unlocks of different songs cannot overspend the balance", async () => {
		const { accountId, songIds } = await seedAccount({
			creditBalance: 1,
			likedSongs: 2,
		});
		const [a, b] = songIds as [string, string];

		const results = await raceUnlocks(accountId, [a], [b]);

		expect(results.map((r) => r.status).sort()).toEqual([
			"insufficient_balance",
			"ok",
		]);
		expect(await readBalance(accountId)).toBe(0);
		expect(await countActiveUnlocks(accountId)).toBe(1);
	});

	it("regression: two concurrent unlocks of the same song charge it once", async () => {
		const { accountId, songIds } = await seedAccount({
			creditBalance: 2,
			likedSongs: 1,
		});
		const [a] = songIds as [string];

		const results = await raceUnlocks(accountId, [a], [a]);

		expect(results).toEqual(
			expect.arrayContaining([
				{
					status: "ok",
					newly_unlocked_song_ids: [a],
					already_unlocked_song_ids: [],
					credit_balance: 1,
				},
				{
					status: "ok",
					newly_unlocked_song_ids: [],
					already_unlocked_song_ids: [a],
					credit_balance: 1,
				},
			]),
		);
		expect(await readBalance(accountId)).toBe(1);
		expect(await readUnlockLedger(accountId)).toEqual([
			{ amount: -1, balance_after: 1 },
		]);
	});
});
