import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const IS_LOCAL =
	DATABASE_URL.includes("127.0.0.1") || DATABASE_URL.includes("localhost");
const sql = IS_LOCAL
	? postgres(DATABASE_URL, { prepare: false, max: 3, fetch_types: false })
	: null;
const describeLocal = IS_LOCAL ? describe : describe.skip;
let availability: Promise<boolean> | null = null;

function db() {
	if (!sql) throw new Error("postgres client not initialized");
	return sql;
}

function isDatabaseAvailable() {
	availability ??= db()
		`SELECT 1`
		.then(() => true)
		.catch(() => false);
	return availability;
}

const accountIds: string[] = [];
const songIds: string[] = [];

async function createAccount() {
	const accountId = crypto.randomUUID();
	accountIds.push(accountId);
	await db()`INSERT INTO account (id, spotify_id) VALUES (${accountId}, ${`sp-${accountId}`})`;
	return accountId;
}

afterAll(async () => {
	if (!sql) return;
	if (await isDatabaseAvailable()) {
		for (const accountId of accountIds) {
			await sql`DELETE FROM account WHERE id = ${accountId}`;
		}
		for (const songId of songIds) {
			await sql`DELETE FROM song WHERE id = ${songId}`;
		}
	}
	await sql.end({ timeout: 1 }).catch(() => {});
});

describeLocal("telemetry database flows", () => {
	it("records heartbeat activity through touch_account_last_seen without duplicate daily rows", async ({
		skip,
	}) => {
		if (!(await isDatabaseAvailable())) skip();
		const accountId = await createAccount();

		await db()`SELECT touch_account_last_seen(${accountId}::uuid)`;
		await db()`SELECT touch_account_last_seen(${accountId}::uuid)`;

		const activity = await db()<{
			latest_count: number;
			daily_count: number;
			activity_date: string;
		}[]>`
			SELECT
				(SELECT count(*) FROM account_activity WHERE account_id = ${accountId})::int AS latest_count,
				count(*)::int AS daily_count,
				max(activity_date)::text AS activity_date
			FROM account_activity_day
			WHERE account_id = ${accountId}
		`;

		expect(activity[0]).toMatchObject({
			latest_count: 1,
			daily_count: 1,
			activity_date: new Date().toISOString().slice(0, 10),
		});

		await db()`DELETE FROM account WHERE id = ${accountId}`;
		const remaining = await db()`
			SELECT 1 FROM account_activity_day WHERE account_id = ${accountId}
		`;
		expect(remaining).toHaveLength(0);
	});

	it("extracts funnel milestones and deduplicates paid accounts", async ({
		skip,
	}) => {
		if (!(await isDatabaseAvailable())) skip();
		const accountId = await createAccount();
		await db()`
			INSERT INTO user_preferences (account_id, onboarding_completed_at)
			VALUES (${accountId}, now())
		`;
		await db()`
			INSERT INTO billing_activation (
				account_id, kind, stripe_subscription_id,
				subscription_period_end, stripe_event_id
			) VALUES
				(${accountId}, 'unlimited_period_activated', ${`sub-a-${accountId}`}, now() + interval '1 month', ${`evt-a-${accountId}`}),
				(${accountId}, 'unlimited_period_activated', ${`sub-b-${accountId}`}, now() + interval '2 months', ${`evt-b-${accountId}`})
		`;

		const rows = await db()<{
			signups: number;
			onboarded: number;
			paid_accounts: number;
			activation_rows: number;
		}[]>`
			SELECT
				count(DISTINCT a.id)::int AS signups,
				count(DISTINCT a.id) FILTER (
					WHERE up.onboarding_completed_at IS NOT NULL
				)::int AS onboarded,
				count(DISTINCT ba.account_id)::int AS paid_accounts,
				count(ba.id)::int AS activation_rows
			FROM account a
			LEFT JOIN user_preferences up ON up.account_id = a.id
			LEFT JOIN billing_activation ba ON ba.account_id = a.id
			WHERE a.id = ${accountId}
		`;

		expect(rows[0]).toEqual({
			signups: 1,
			onboarded: 1,
			paid_accounts: 1,
			activation_rows: 2,
		});
	});

	it("classifies added, dismissed, and skipped match outcomes", async ({
		skip,
	}) => {
		if (!(await isDatabaseAvailable())) skip();
		const accountId = await createAccount();
		const songId = crypto.randomUUID();
		const playlistId = crypto.randomUUID();
		songIds.push(songId);

		await db()`
			INSERT INTO song (id, spotify_id, name, artists, artist_ids, genres)
			VALUES (
				${songId}, ${`sp-${songId}`}, 'Telemetry Song',
				${"{Artist}"}::text[], ${"{artist-1}"}::text[], ${"{pop}"}::text[]
			)
		`;
		await db()`
			INSERT INTO playlist (id, account_id, spotify_id, name)
			VALUES (${playlistId}, ${accountId}, ${`sp-${playlistId}`}, 'Telemetry Playlist')
		`;
		await db()`
			INSERT INTO match_event (account_id, song_id, playlist_id, event)
			VALUES
				(${accountId}, ${songId}, ${playlistId}, 'added'),
				(${accountId}, ${songId}, ${playlistId}, 'dismissed'),
				(${accountId}, ${songId}, ${playlistId}, 'skipped')
		`;

		const rows = await db()<{
			added: number;
			dismissed: number;
			skipped: number;
			explicit_decisions: number;
		}[]>`
			SELECT
				count(*) FILTER (WHERE event = 'added')::int AS added,
				count(*) FILTER (WHERE event = 'dismissed')::int AS dismissed,
				count(*) FILTER (WHERE event = 'skipped')::int AS skipped,
				count(*) FILTER (WHERE event IN ('added', 'dismissed'))::int AS explicit_decisions
			FROM match_event
			WHERE account_id = ${accountId}
		`;

		expect(rows[0]).toEqual({
			added: 1,
			dismissed: 1,
			skipped: 1,
			explicit_decisions: 2,
		});
	});
});
