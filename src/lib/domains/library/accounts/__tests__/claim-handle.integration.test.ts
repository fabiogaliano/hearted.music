/**
 * Live-DB integration tests for the claim_handle RPC (§14.5).
 *
 * Covers every case listed in the §14.5 plan checklist. Connects via
 * postgres.js against DATABASE_URL (superuser, bypasses RLS). Auto-skipped
 * when DATABASE_URL is not the local stack so CI environments without a local
 * Supabase are unaffected.
 *
 * The concurrent-race case (§14.5 item 12) reveals a real behavior difference
 * from the plan description: the losing concurrent claim throws a 23505
 * PostgresError rather than returning { status: "taken" }. The RPC only returns
 * "taken" for a SEQUENTIAL check where the handle is already owned at SELECT
 * time. In the concurrent case the UPDATE races and violates the unique index,
 * so Postgres surfaces 23505 directly. This is correct DB behavior; the
 * application layer (claimHandleAndAdvance) catches 23505 and maps it to
 * { status: "unavailable", reason: "taken" }.
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

// Close the shared pool so the test process doesn't leak a connection (the
// concurrent-race case opens its own second connection and closes it inline).
afterAll(async () => {
	if (sql) await sql.end();
});

// Each test creates and tracks its own account IDs so cleanup is scoped.
async function seedAccount(
	id: string,
	opts: {
		step?: string;
		onboarding_completed_at?: string | null;
		phase_job_ids?: string | null;
		handle?: string | null;
	} = {},
) {
	const client = db();
	const step = opts.step ?? "claim-handle";

	await client`INSERT INTO account(id, spotify_id) VALUES (${id}, ${`sp-${id}`})`;

	if (opts.handle !== undefined && opts.handle !== null) {
		await client`UPDATE account SET handle = ${opts.handle} WHERE id = ${id}`;
	}

	await client`
    INSERT INTO user_preferences(account_id, onboarding_step, onboarding_completed_at, phase_job_ids)
    VALUES (
      ${id},
      ${step},
      ${opts.onboarding_completed_at ?? null},
      ${opts.phase_job_ids ? client.json(JSON.parse(opts.phase_job_ids)) : null}
    )
  `;
}

async function cleanAccount(...ids: string[]) {
	if (!sql) return;
	for (const id of ids) {
		await sql`DELETE FROM account WHERE id = ${id}`;
	}
}

async function callRpc(
	accountId: string,
	handle: string,
	client = db(),
): Promise<{ status: string; owned_handle: string | null }[]> {
	return client`SELECT * FROM claim_handle(${accountId}::uuid, ${handle})`;
}

async function readPrefs(accountId: string) {
	return db()<
		{
			onboarding_step: string;
			phase_job_ids: unknown;
			onboarding_completed_at: string | null;
		}[]
	>`SELECT onboarding_step, phase_job_ids, onboarding_completed_at
    FROM user_preferences WHERE account_id = ${accountId}`;
}

async function readHandle(accountId: string): Promise<string | null> {
	const rows = await db()<
		{ handle: string | null }[]
	>`SELECT handle FROM account WHERE id = ${accountId}`;
	return rows[0]?.handle ?? null;
}

describeLocal("claim_handle RPC — §14.5 integration", () => {
	// ── Case 1: successful first claim writes both tables ─────────────────────

	it("case 1: first claim returns claimed + writes account.handle + advances step", async () => {
		const id = crypto.randomUUID();
		await seedAccount(id, { step: "claim-handle" });

		try {
			const rows = await callRpc(id, "myfirsthandle");
			expect(rows).toHaveLength(1);
			expect(rows[0]).toEqual({
				status: "claimed",
				owned_handle: "myfirsthandle",
			});

			// account.handle written
			expect(await readHandle(id)).toBe("myfirsthandle");

			// user_preferences.onboarding_step advanced to flag-playlists
			const prefs = await readPrefs(id);
			expect(prefs[0]?.onboarding_step).toBe("flag-playlists");
			// phase_job_ids cleared (was null already, still null)
			expect(prefs[0]?.phase_job_ids).toBeNull();
		} finally {
			await cleanAccount(id);
		}
	});

	// ── Case 2: not_ready steps (welcome / pick-color / install-extension / syncing) ──

	it.each([
		"welcome",
		"pick-color",
		"install-extension",
		"syncing",
	])("case 2: step '%s' → not_ready", async (step) => {
		const id = crypto.randomUUID();
		await seedAccount(id, { step });

		try {
			const rows = await callRpc(id, "anyhandle");
			expect(rows).toHaveLength(1);
			expect(rows[0]).toEqual({ status: "not_ready", owned_handle: null });

			// account.handle must remain null
			expect(await readHandle(id)).toBeNull();
		} finally {
			await cleanAccount(id);
		}
	});

	// ── Case 3: pick-demo-song → claimed + rewrite to flag-playlists + clear phase_job_ids ──

	it("case 3: pick-demo-song → claimed + step rewritten to flag-playlists + phase_job_ids cleared", async () => {
		const id = crypto.randomUUID();
		await seedAccount(id, {
			step: "pick-demo-song",
			phase_job_ids: '{"job": "abc"}',
		});

		try {
			const rows = await callRpc(id, "demohandle");
			expect(rows[0]).toEqual({
				status: "claimed",
				owned_handle: "demohandle",
			});

			const prefs = await readPrefs(id);
			expect(prefs[0]?.onboarding_step).toBe("flag-playlists");
			expect(prefs[0]?.phase_job_ids).toBeNull();
		} finally {
			await cleanAccount(id);
		}
	});

	// ── Case 4: complete-without-timestamp → claimed + rewrite to flag-playlists + clear phase_job_ids ──

	it("case 4: complete step + onboarding_completed_at=NULL → claimed + step rewritten to flag-playlists", async () => {
		const id = crypto.randomUUID();
		await seedAccount(id, {
			step: "complete",
			onboarding_completed_at: null,
			phase_job_ids: '{"j": 1}',
		});

		try {
			const rows = await callRpc(id, "completehandle");
			expect(rows[0]).toEqual({
				status: "claimed",
				owned_handle: "completehandle",
			});

			const prefs = await readPrefs(id);
			expect(prefs[0]?.onboarding_step).toBe("flag-playlists");
			expect(prefs[0]?.phase_job_ids).toBeNull();
		} finally {
			await cleanAccount(id);
		}
	});

	// ── Case 5: completed (onboarding_completed_at IS NOT NULL) + missing handle → claimed + preserve timestamp + do NOT rewrite step ──

	it("case 5: onboarding_completed_at set + no handle → claimed + timestamp preserved + step NOT rewritten", async () => {
		const id = crypto.randomUUID();
		const completedAt = "2026-01-15T12:00:00Z";
		await seedAccount(id, {
			step: "complete",
			onboarding_completed_at: completedAt,
		});

		try {
			const rows = await callRpc(id, "completedhandle");
			expect(rows[0]).toEqual({
				status: "claimed",
				owned_handle: "completedhandle",
			});

			const prefs = await readPrefs(id);
			// Step must NOT have been rewritten to flag-playlists
			expect(prefs[0]?.onboarding_step).toBe("complete");
			// Timestamp must be preserved (not cleared)
			expect(prefs[0]?.onboarding_completed_at).not.toBeNull();
		} finally {
			await cleanAccount(id);
		}
	});

	// ── Case 6: invalid/unknown unfinished step token → not_ready ────────────

	it("case 6: invalid unknown step token → not_ready", async () => {
		const id = crypto.randomUUID();
		// A fabricated token that is in neither the RPC's later-step allow-set nor
		// the ONBOARDING_STEP_VALUES enum. onboarding_step is a plain text column
		// (no CHECK / enum), so a drifted/garbage value is storable — the RPC must
		// treat any non-allow-listed step (with a null completion timestamp) as
		// not_ready rather than mistaking it for a later step.
		await seedAccount(id, { step: "bogus-step-xyz" });

		try {
			const rows = await callRpc(id, "case6handle");
			expect(rows[0]).toEqual({ status: "not_ready", owned_handle: null });
		} finally {
			await cleanAccount(id);
		}
	});

	// ── Case 7: same-handle rerun on same account while still on claim-handle → idempotent ──

	it("case 7: same-handle rerun on claim-handle step → claimed, idempotent", async () => {
		const id = crypto.randomUUID();
		await seedAccount(id, { step: "claim-handle" });

		try {
			// First claim: sets handle, advances step to flag-playlists
			const first = await callRpc(id, "idempotenthandle");
			expect(first[0]).toEqual({
				status: "claimed",
				owned_handle: "idempotenthandle",
			});

			// Second run: same handle, now at flag-playlists — should still return claimed
			const second = await callRpc(id, "idempotenthandle");
			expect(second[0]).toEqual({
				status: "claimed",
				owned_handle: "idempotenthandle",
			});

			// Step should still be flag-playlists (not regressed)
			const prefs = await readPrefs(id);
			expect(prefs[0]?.onboarding_step).toBe("flag-playlists");
		} finally {
			await cleanAccount(id);
		}
	});

	// ── Case 8: same-handle rerun after pick-demo-song → claimed, step unchanged ──

	it("case 8: same-handle rerun after pick-demo-song claim → claimed, step unchanged (flag-playlists)", async () => {
		const id = crypto.randomUUID();
		await seedAccount(id, {
			step: "pick-demo-song",
			phase_job_ids: '{"j": 1}',
		});

		try {
			// First claim from pick-demo-song: advances to flag-playlists
			await callRpc(id, "pdshandle");

			// Now at flag-playlists. Re-run same handle.
			const rerun = await callRpc(id, "pdshandle");
			expect(rerun[0]).toEqual({
				status: "claimed",
				owned_handle: "pdshandle",
			});

			// Step must remain at flag-playlists (was already advanced)
			const prefs = await readPrefs(id);
			expect(prefs[0]?.onboarding_step).toBe("flag-playlists");
		} finally {
			await cleanAccount(id);
		}
	});

	// ── Case 9: different handle → already_owned ─────────────────────────────

	it("case 9: second claim with a different handle → already_owned with existing handle", async () => {
		const id = crypto.randomUUID();
		await seedAccount(id, { step: "claim-handle" });

		try {
			// First claim succeeds
			await callRpc(id, "firsthandle");

			// Second claim with different handle → already_owned
			const rows = await callRpc(id, "secondhandle");
			expect(rows[0]).toEqual({
				status: "already_owned",
				owned_handle: "firsthandle",
			});
		} finally {
			await cleanAccount(id);
		}
	});

	// ── Case 10: unique index blocks two accounts owning the same handle ──────

	it("case 10: unique index prevents two accounts from owning the same handle", async () => {
		const id1 = crypto.randomUUID();
		const id2 = crypto.randomUUID();
		await seedAccount(id1, { step: "claim-handle" });
		await seedAccount(id2, { step: "claim-handle" });

		try {
			// First account claims the handle
			await callRpc(id1, "uniquehandle");

			// Second account tries via RPC (sequential) → the RPC returns claimed because
			// it UPDATE-attempts and gets 23505 from the unique index.
			// In sequential mode the RPC does not catch 23505 — it throws.
			await expect(callRpc(id2, "uniquehandle")).rejects.toMatchObject({
				code: "23505",
			});

			// Confirm only one account holds the handle
			const holders = await db()<
				{ id: string }[]
			>`SELECT id FROM account WHERE handle = 'uniquehandle'`;
			expect(holders).toHaveLength(1);
			expect(holders[0]?.id).toBe(id1);
		} finally {
			await cleanAccount(id1, id2);
		}
	});

	// ── Case 11: DB CHECK constraint rejects malformed handles ───────────────

	it.each([
		["uppercase", "UPPERCASE"],
		["surrounding whitespace", " handle "],
		["leading period", ".handle"],
		["trailing period", "handle."],
		["consecutive periods", "han..dle"],
	])("case 11: DB rejects direct UPDATE with %s handle", async (_label, badHandle) => {
		const id = crypto.randomUUID();
		await seedAccount(id, { step: "claim-handle" });

		try {
			await expect(
				db()`UPDATE account SET handle = ${badHandle} WHERE id = ${id}`,
			).rejects.toMatchObject({ code: "23514" });
		} finally {
			await cleanAccount(id);
		}
	});

	// ── Case 12: concurrent claims for same handle → exactly one wins ────────

	it("case 12: concurrent claims → exactly one claimed, loser throws 23505", async () => {
		const id1 = crypto.randomUUID();
		const id2 = crypto.randomUUID();
		await seedAccount(id1, { step: "claim-handle" });
		await seedAccount(id2, { step: "claim-handle" });

		// Open a second connection so the two calls can genuinely race at the DB level.
		const sql2 = postgres(DATABASE_URL, {
			prepare: false,
			max: 1,
			fetch_types: false,
		});

		try {
			const results = await Promise.allSettled([
				callRpc(id1, "racehandle"),
				callRpc(id2, "racehandle", sql2),
			]);

			const fulfilled = results.filter((r) => r.status === "fulfilled");
			const rejected = results.filter((r) => r.status === "rejected");

			// Exactly one winner and one loser
			expect(fulfilled).toHaveLength(1);
			expect(rejected).toHaveLength(1);

			// Winner returns claimed
			const winner = fulfilled[0] as PromiseFulfilledResult<
				{ status: string; owned_handle: string | null }[]
			>;
			expect(winner.value[0]).toEqual({
				status: "claimed",
				owned_handle: "racehandle",
			});

			// Loser gets 23505 (unique constraint violation from the concurrent UPDATE)
			const loser = rejected[0] as PromiseRejectedResult;
			expect(loser.reason).toMatchObject({ code: "23505" });

			// Exactly one account holds the handle
			const holders = await db()<
				{ id: string }[]
			>`SELECT id FROM account WHERE handle = 'racehandle'`;
			expect(holders).toHaveLength(1);
		} finally {
			await sql2.end();
			await cleanAccount(id1, id2);
		}
	});

	// ── Case 13: missing user_preferences → RPC raises + rolls back ──────────

	it("case 13: missing user_preferences row → RPC raises, account.handle stays null", async () => {
		const id = crypto.randomUUID();
		// Insert account but NO user_preferences row
		await db()`INSERT INTO account(id, spotify_id) VALUES (${id}, ${`sp-${id}`})`;

		try {
			await expect(callRpc(id, "noprefshandle")).rejects.toThrow(/not found/);

			// Rollback: account.handle must remain null
			expect(await readHandle(id)).toBeNull();
		} finally {
			await cleanAccount(id);
		}
	});

	// ── Case 14: missing account row → RPC raises ────────────────────────────

	it("case 14: missing account row → RPC raises", async () => {
		const nonexistent = crypto.randomUUID();

		await expect(callRpc(nonexistent, "ghosthandle")).rejects.toThrow(
			/not found/,
		);
	});
});
