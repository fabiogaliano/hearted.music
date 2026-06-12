/**
 * Live-DB integration tests for the begin_extension_sync RPC.
 *
 * Connects via postgres.js against DATABASE_URL (superuser, bypasses RLS).
 * Auto-skipped when DATABASE_URL is not the local stack so CI without a local
 * Supabase is unaffected. Covers the three gate outcomes: enqueue, active, and
 * cooldown.
 */

import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const IS_LOCAL =
	DATABASE_URL.includes("127.0.0.1") || DATABASE_URL.includes("localhost");

const sql = IS_LOCAL
	? postgres(DATABASE_URL, { prepare: false, max: 5, fetch_types: false })
	: null;

function db() {
	if (!sql) throw new Error("postgres client not initialised");
	return sql;
}

const describeLocal = IS_LOCAL ? describe : describe.skip;

const createdAccountIds: string[] = [];

async function seedAccount(id: string): Promise<void> {
	const client = db();
	await client`INSERT INTO account(id, spotify_id) VALUES (${id}, ${`sp-${id}`})`;
	await client`INSERT INTO user_preferences(account_id) VALUES (${id})`;
	createdAccountIds.push(id);
}

async function begin(id: string, path: string, bytes: number) {
	const rows = await db()`
    SELECT begin_extension_sync(${id}::uuid, ${path}, ${bytes}::bigint) AS result
  `;
	return rows[0].result as Record<string, unknown>;
}

afterAll(async () => {
	if (!sql) return;
	for (const id of createdAccountIds) {
		await sql`DELETE FROM account WHERE id = ${id}`;
	}
	await sql.end();
});

describeLocal("begin_extension_sync", () => {
	it("enqueues a parent + three phase jobs and points prefs at them", async () => {
		const id = "00000000-0000-0000-0000-00000000be01";
		await seedAccount(id);

		const result = await begin(id, `${id}/p.json`, 1234);

		expect(result.jobId).toBeTruthy();
		expect(result.phaseJobIds).toMatchObject({
			liked_songs: expect.any(String),
			playlists: expect.any(String),
			playlist_tracks: expect.any(String),
		});

		const jobs = await db()`
      SELECT type::text AS type, status::text AS status
      FROM job WHERE account_id = ${id}::uuid ORDER BY type::text
    `;
		expect(jobs.map((j) => j.type)).toEqual([
			"extension_sync",
			"sync_liked_songs",
			"sync_playlist_tracks",
			"sync_playlists",
		]);
		expect(jobs.every((j) => j.status === "pending")).toBe(true);

		const prefs = await db()`
      SELECT phase_job_ids IS NOT NULL AS has_ids
      FROM user_preferences WHERE account_id = ${id}::uuid
    `;
		expect(prefs[0].has_ids).toBe(true);
	});

	it("returns active:true when a sync is already in flight", async () => {
		const id = "00000000-0000-0000-0000-00000000be02";
		await seedAccount(id);

		const first = await begin(id, `${id}/p1.json`, 10);
		expect(first.active).toBeUndefined();

		const second = await begin(id, `${id}/p2.json`, 20);
		expect(second.active).toBe(true);
		expect(second.jobId).toBe(first.jobId);
	});

	it("returns a cooldown when the last completed sync is too recent", async () => {
		const id = "00000000-0000-0000-0000-00000000be03";
		await seedAccount(id);

		// A just-completed extension_sync with no active siblings → cooldown gate.
		await db()`
      INSERT INTO job(account_id, type, status, completed_at)
      VALUES (${id}::uuid, 'extension_sync', 'completed', now())
    `;

		const result = await begin(id, `${id}/p.json`, 10);
		expect(result.cooldown).toBe(true);
		expect(result.retryAfterSeconds).toBeGreaterThan(0);
	});

	it("does NOT self-heal a running parent whose heartbeat is fresh, even when started_at is old", async () => {
		const id = "00000000-0000-0000-0000-00000000be04";
		await seedAccount(id);

		// Simulate a long-running but legitimately live worker: started_at and
		// created_at are old (>10 min), but heartbeat_at is recent.
		await db()`
      INSERT INTO job(account_id, type, status, started_at, created_at, heartbeat_at, progress)
      VALUES (
        ${id}::uuid,
        'extension_sync',
        'running',
        now() - interval '20 minutes',
        now() - interval '20 minutes',
        now() - interval '15 seconds',
        '{"payload_path":"x","phase_job_ids":{"liked_songs":"00000000-0000-4000-8000-000000000aa1","playlists":"00000000-0000-4000-8000-000000000aa2","playlist_tracks":"00000000-0000-4000-8000-000000000aa3"}}'::jsonb
      )
    `;

		// A new sync attempt should see the parent as still active (not healed).
		const result = await begin(id, `${id}/p.json`, 10);
		expect(result.active).toBe(true);

		// The running parent must still be running (not failed by the self-heal).
		const rows = await db()`
      SELECT status::text AS status FROM job
      WHERE account_id = ${id}::uuid AND type = 'extension_sync'
    `;
		expect(rows[0].status).toBe("running");
	});

	it("self-heals a PENDING parent with old created_at (worker-down lockout case)", async () => {
		const id = "00000000-0000-0000-0000-00000000be05";
		await seedAccount(id);

		// A pending parent that was never picked up (worker was down).
		await db()`
      INSERT INTO job(account_id, type, status, created_at)
      VALUES (
        ${id}::uuid,
        'extension_sync',
        'pending',
        now() - interval '20 minutes'
      )
    `;

		// A new sync attempt should self-heal the stale pending parent and proceed.
		const result = await begin(id, `${id}/p.json`, 10);

		// Should enqueue a new job (not return active).
		expect(result.active).toBeUndefined();
		expect(result.cooldown).toBeUndefined();
		expect(result.jobId).toBeTruthy();

		// The old pending parent must now be failed (healed), and a new pending one created.
		const rows = await db()`
      SELECT status::text AS status FROM job
      WHERE account_id = ${id}::uuid AND type = 'extension_sync'
      ORDER BY created_at
    `;
		expect(rows).toHaveLength(2);
		expect(rows[0].status).toBe("failed");
		expect(rows[1].status).toBe("pending");
	});

	it("does NOT fail phase rows that belong to a still-active parent", async () => {
		const id = "00000000-0000-0000-0000-00000000be06";
		await seedAccount(id);

		// Phase job ids that will be owned by the running parent.
		const likedId = "00000000-0000-4000-8000-000000000bb1";
		const playlistsId = "00000000-0000-4000-8000-000000000bb2";
		const tracksId = "00000000-0000-4000-8000-000000000bb3";

		// Insert old (>10 min) phase rows that the running parent owns.
		await db()`
      INSERT INTO job(id, account_id, type, status, created_at)
      VALUES
        (${likedId}::uuid,     ${id}::uuid, 'sync_liked_songs',    'running', now() - interval '20 minutes'),
        (${playlistsId}::uuid, ${id}::uuid, 'sync_playlists',      'running', now() - interval '20 minutes'),
        (${tracksId}::uuid,    ${id}::uuid, 'sync_playlist_tracks','running', now() - interval '20 minutes')
    `;

		const progress = {
			payload_path: "x",
			phase_job_ids: {
				liked_songs: likedId,
				playlists: playlistsId,
				playlist_tracks: tracksId,
			},
		};
		// Running parent with a fresh heartbeat that references the phase jobs.
		// Use sql.json() to pass the JSONB value natively — passing a plain JS string
		// with ::jsonb cast through postgres.js parameterization stores it as a JSONB
		// string type (not an object), which breaks progress->'phase_job_ids' extraction.
		const client = db();
		await client`
      INSERT INTO job(account_id, type, status, started_at, created_at, heartbeat_at, progress)
      VALUES (
        ${id}::uuid,
        'extension_sync',
        'running',
        now() - interval '20 minutes',
        now() - interval '20 minutes',
        now() - interval '10 seconds',
        ${client.json(progress)}
      )
    `;

		// A new sync attempt — the parent is live (fresh heartbeat), should see active.
		const result = await begin(id, `${id}/p.json`, 10);
		expect(result.active).toBe(true);

		// Phase rows must still be running (not healed/failed).
		const phaseRows = await db()`
      SELECT id::text AS id, status::text AS status FROM job
      WHERE account_id = ${id}::uuid
        AND type IN ('sync_liked_songs','sync_playlists','sync_playlist_tracks')
      ORDER BY id
    `;
		expect(phaseRows).toHaveLength(3);
		expect(phaseRows.every((r) => r.status === "running")).toBe(true);
	});
});
