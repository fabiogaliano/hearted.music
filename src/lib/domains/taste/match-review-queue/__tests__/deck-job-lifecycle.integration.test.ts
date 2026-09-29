/**
 * Deck-job lifecycle against the real SQL: claim_pending_match_review_deck_job
 * and sweep_stale_match_review_deck_jobs (latest: 20260929100000),
 * mark_dead_match_review_deck_jobs (20260706000011), and the direct-UPDATE
 * settlements and release in deck-jobs.ts fenced on `status = 'running'` plus
 * the claim token (locked_by). The worker suite mocks every one of these, so the
 * compare-and-set and the claim's attempts/available_at gates only exist here.
 *
 * Expected values come from the SQL: claim flips pending→running, attempts+1,
 * heartbeat_at=now(), and skips rows with available_at in the future or
 * attempts >= max_attempts; sweep re-pends running rows with heartbeat older
 * than the lease and attempts remaining (available_at=now(), heartbeat NULL);
 * mark_dead terminalizes exhausted pending rows and exhausted running rows
 * past the lease.
 *
 * The claim is global (not account-scoped), so claimed jobs are seeded as the
 * highest-priority kind with an ancient available_at to win the ORDER BY over
 * any unrelated local row. Auto-skipped unless DATABASE_URL and SUPABASE_URL
 * both point at the local stack.
 */

import { Result } from "better-result";
import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type ClaimedDeckJob,
	claimDeckJob,
	completeDeckJob,
	deferDeckJob,
	heartbeatDeckJob,
	markDeadDeckJobs,
	releaseDeckJob,
	sweepStaleDeckJobs,
} from "../deck-jobs";

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

// Mirrors DECK_JOB_LEASE_SECONDS in src/worker/sweep.ts.
const LEASE_SECONDS = 900;

// Seeded running rows stand in for a claim, so they carry a known token.
const SEED_TOKEN = "seeded-claim-token";

let accountId: string | null = null;

function account(): string {
	if (!accountId) throw new Error("fixture not seeded");
	return accountId;
}

interface SeedJob {
	status: "pending" | "running";
	orientation?: "song" | "playlist";
	attempts?: number;
	maxAttempts?: number;
	/** Seconds before DB now(); null leaves heartbeat_at NULL. */
	heartbeatAgeSeconds?: number | null;
}

async function seedJob(opts: SeedJob): Promise<string> {
	const id = crypto.randomUUID();
	const heartbeatAge = opts.heartbeatAgeSeconds ?? null;
	await db()`
    INSERT INTO match_review_deck_job(
      id, account_id, orientation, kind, idempotency_key, status,
      attempts, max_attempts, available_at, heartbeat_at, locked_by
    ) VALUES (
      ${id}, ${account()}, ${opts.orientation ?? "song"}, ${"capture_ahead"},
      ${`test:${id}`}, ${opts.status}, ${opts.attempts ?? 0},
      ${opts.maxAttempts ?? 3}, ${"2000-01-01T00:00:00Z"}::timestamptz,
      CASE WHEN ${heartbeatAge}::int IS NULL THEN NULL
           ELSE now() - make_interval(secs => ${heartbeatAge}::int) END,
      ${opts.status === "running" ? SEED_TOKEN : null}
    )
  `;
	return id;
}

interface JobRow {
	status: string;
	attempts: number;
	locked_by: string | null;
	heartbeat_is_null: boolean;
	available_epoch_ms: number;
	available_is_past: boolean;
	heartbeat_age_seconds: number | null;
}

async function readJob(id: string): Promise<JobRow> {
	const rows = await db()<JobRow[]>`
    SELECT status,
           attempts,
           locked_by,
           heartbeat_at IS NULL AS heartbeat_is_null,
           (extract(epoch FROM available_at) * 1000)::float8 AS available_epoch_ms,
           available_at <= now() AS available_is_past,
           extract(epoch FROM now() - heartbeat_at)::float8 AS heartbeat_age_seconds
    FROM match_review_deck_job WHERE id = ${id}
  `;
	const row = rows[0];
	if (!row) throw new Error(`deck job ${id} missing`);
	return row;
}

async function claimOwn(): Promise<string | null> {
	const claimed = await claimDeckJob();
	if (Result.isError(claimed)) throw claimed.error;
	return claimed.value?.id ?? null;
}

/** Claims `jobId`, asserting it wins the global claim. */
async function claimJob(jobId: string): Promise<ClaimedDeckJob> {
	const claimed = await claimDeckJob();
	if (Result.isError(claimed)) throw claimed.error;
	expect(claimed.value?.id).toBe(jobId);
	if (!claimed.value) throw new Error(`deck job ${jobId} not claimed`);
	return claimed.value;
}

async function claimToken(jobId: string): Promise<string> {
	return (await claimJob(jobId)).locked_by;
}

beforeEach(async () => {
	if (!IS_LOCAL) return;
	accountId = crypto.randomUUID();
	await db()`INSERT INTO account(id, spotify_id) VALUES (${accountId}, ${`test-${accountId}`})`;
});

afterEach(async () => {
	if (!IS_LOCAL || !accountId) return;
	// Account cascade clears the deck jobs.
	await db()`DELETE FROM account WHERE id = ${accountId}`;
	accountId = null;
});

afterAll(async () => {
	await sql?.end();
});

describe.skipIf(!IS_LOCAL)("claim → settle", () => {
	it("claim leases the job with one attempt consumed; complete terminalizes it", async () => {
		const jobId = await seedJob({ status: "pending" });

		const token = await claimToken(jobId);
		const running = await readJob(jobId);
		expect(running.status).toBe("running");
		expect(running.attempts).toBe(1);
		expect(running.heartbeat_is_null).toBe(false);

		expect(await completeDeckJob(jobId, token)).toHaveOkValue(true);
		expect((await readJob(jobId)).status).toBe("completed");
	});

	it("defer re-pends with the backoff and keeps the attempt; the claim waits out available_at", async () => {
		const jobId = await seedJob({ status: "pending" });
		const token = await claimToken(jobId);

		const before = Date.now();
		expect(await deferDeckJob(jobId, token, 30)).toHaveOkValue(true);
		const after = Date.now();

		const deferred = await readJob(jobId);
		expect(deferred.status).toBe("pending");
		expect(deferred.attempts).toBe(1);
		expect(deferred.heartbeat_is_null).toBe(true);
		expect(deferred.available_epoch_ms).toBeGreaterThanOrEqual(before + 30_000);
		expect(deferred.available_epoch_ms).toBeLessThanOrEqual(after + 30_000);

		expect(await claimOwn()).not.toBe(jobId);

		await db()`UPDATE match_review_deck_job SET available_at = now() - interval '1 second' WHERE id = ${jobId}`;
		expect(await claimOwn()).toBe(jobId);
		expect((await readJob(jobId)).attempts).toBe(2);
	});

	it("a job deferred on its final attempt is never reclaimed and is dead-lettered", async () => {
		const jobId = await seedJob({ status: "pending", maxAttempts: 1 });
		const token = await claimToken(jobId);
		expect(await deferDeckJob(jobId, token, 30)).toHaveOkValue(true);
		await db()`UPDATE match_review_deck_job SET available_at = now() - interval '1 second' WHERE id = ${jobId}`;

		expect(await claimOwn()).not.toBe(jobId);

		const dead = await markDeadDeckJobs(LEASE_SECONDS);
		if (Result.isError(dead)) throw dead.error;
		expect(dead.value.map((j) => j.id)).toContain(jobId);
		expect((await readJob(jobId)).status).toBe("dead");
	});
});

describe.skipIf(!IS_LOCAL)(
	"settlement compare-and-set on status + claim token",
	() => {
		it("a late settle cannot resurrect a job the sweep tick dead-lettered", async () => {
			const jobId = await seedJob({
				status: "running",
				attempts: 3,
				maxAttempts: 3,
				heartbeatAgeSeconds: LEASE_SECONDS + 300,
			});

			// Same order as the sweep tick's deck steps: sweep leaves exhausted jobs
			// alone, mark_dead terminalizes them.
			const swept = await sweepStaleDeckJobs(LEASE_SECONDS);
			if (Result.isError(swept)) throw swept.error;
			expect(swept.value.map((j) => j.id)).not.toContain(jobId);
			const dead = await markDeadDeckJobs(LEASE_SECONDS);
			if (Result.isError(dead)) throw dead.error;
			expect(dead.value.map((j) => j.id)).toContain(jobId);

			expect(await completeDeckJob(jobId, SEED_TOKEN)).toHaveOkValue(false);
			expect(await deferDeckJob(jobId, SEED_TOKEN, 30)).toHaveOkValue(false);
			expect((await readJob(jobId)).status).toBe("dead");
		});

		it("a late settle after the sweep re-pended the job leaves it pending and claimable", async () => {
			const jobId = await seedJob({
				status: "running",
				attempts: 1,
				heartbeatAgeSeconds: LEASE_SECONDS + 300,
			});
			const swept = await sweepStaleDeckJobs(LEASE_SECONDS);
			if (Result.isError(swept)) throw swept.error;
			expect(swept.value.map((j) => j.id)).toContain(jobId);

			expect(await completeDeckJob(jobId, SEED_TOKEN)).toHaveOkValue(false);
			expect(await deferDeckJob(jobId, SEED_TOKEN, 30)).toHaveOkValue(false);
			const row = await readJob(jobId);
			expect(row.status).toBe("pending");
			// A leaked defer would have pushed available_at 30s into the future.
			expect(row.available_is_past).toBe(true);
		});

		it("stale worker's settle after sweep+reclaim must not affect the new run", async () => {
			const jobId = await seedJob({ status: "pending" });
			const staleToken = await claimToken(jobId);

			// The first run's worker stalls past the lease; the sweep re-pends the job
			// and a second worker reclaims it while the first is still alive.
			await db()`UPDATE match_review_deck_job SET heartbeat_at = now() - make_interval(secs => ${LEASE_SECONDS + 60}) WHERE id = ${jobId}`;
			const swept = await sweepStaleDeckJobs(LEASE_SECONDS);
			if (Result.isError(swept)) throw swept.error;
			expect(swept.value.map((j) => j.id)).toContain(jobId);
			const liveToken = await claimToken(jobId);
			// Backdated so a leaked stale heartbeat is observable.
			await db()`UPDATE match_review_deck_job SET heartbeat_at = now() - interval '60 seconds' WHERE id = ${jobId}`;

			expect(await heartbeatDeckJob(jobId, staleToken)).toHaveOkValue(false);
			expect(await completeDeckJob(jobId, staleToken)).toHaveOkValue(false);
			expect(await deferDeckJob(jobId, staleToken, 30)).toHaveOkValue(false);

			const row = await readJob(jobId);
			expect(row.status).toBe("running");
			expect(row.attempts).toBe(2);
			expect(row.heartbeat_age_seconds).toBeGreaterThanOrEqual(59);

			expect(await heartbeatDeckJob(jobId, liveToken)).toHaveOkValue(true);
			expect(await completeDeckJob(jobId, liveToken)).toHaveOkValue(true);
		});

		it("double complete is idempotent and a defer cannot re-open a completed job", async () => {
			const jobId = await seedJob({ status: "pending" });
			const token = await claimToken(jobId);

			expect(await completeDeckJob(jobId, token)).toHaveOkValue(true);
			expect(await completeDeckJob(jobId, token)).toHaveOkValue(false);
			expect(await deferDeckJob(jobId, token, 30)).toHaveOkValue(false);
			expect((await readJob(jobId)).status).toBe("completed");
		});

		it("double defer does not push the retry out again", async () => {
			const jobId = await seedJob({ status: "pending" });
			const token = await claimToken(jobId);

			expect(await deferDeckJob(jobId, token, 30)).toHaveOkValue(true);
			const first = await readJob(jobId);
			expect(await deferDeckJob(jobId, token, 600)).toHaveOkValue(false);
			const second = await readJob(jobId);
			expect(second.status).toBe("pending");
			expect(second.available_epoch_ms).toBe(first.available_epoch_ms);
		});
	},
);

describe.skipIf(!IS_LOCAL)("release after the poll loop stopped", () => {
	it("refunds the attempt so a job claimed on its final attempt during shutdown runs instead of being dead-lettered", async () => {
		const jobId = await seedJob({ status: "pending", maxAttempts: 1 });
		const claimed = await claimJob(jobId);
		expect((await readJob(jobId)).attempts).toBe(1);

		expect(await releaseDeckJob(claimed)).toHaveOkValue(true);
		const released = await readJob(jobId);
		expect(released.status).toBe("pending");
		expect(released.attempts).toBe(0);
		expect(released.locked_by).toBeNull();
		expect(released.heartbeat_is_null).toBe(true);
		expect(released.available_is_past).toBe(true);

		const dead = await markDeadDeckJobs(LEASE_SECONDS);
		if (Result.isError(dead)) throw dead.error;
		expect(dead.value.map((j) => j.id)).not.toContain(jobId);
		expect(await claimOwn()).toBe(jobId);
		expect((await readJob(jobId)).attempts).toBe(1);
	});

	it("a stale release cannot re-pend or refund a run that reclaimed the job", async () => {
		const jobId = await seedJob({ status: "pending" });
		const stale = await claimJob(jobId);
		await db()`UPDATE match_review_deck_job SET heartbeat_at = now() - make_interval(secs => ${LEASE_SECONDS + 60}) WHERE id = ${jobId}`;
		const swept = await sweepStaleDeckJobs(LEASE_SECONDS);
		if (Result.isError(swept)) throw swept.error;
		expect(swept.value.map((j) => j.id)).toContain(jobId);
		const liveToken = await claimToken(jobId);

		expect(await releaseDeckJob(stale)).toHaveOkValue(false);
		const row = await readJob(jobId);
		expect(row.status).toBe("running");
		expect(row.attempts).toBe(2);
		expect(row.locked_by).toBe(liveToken);
	});
});

describe.skipIf(!IS_LOCAL)("lease-expiry sweep", () => {
	it("reclaims only a running job whose heartbeat outlived the lease, and it is claimable again", async () => {
		const staleId = await seedJob({
			status: "running",
			orientation: "song",
			attempts: 1,
			heartbeatAgeSeconds: LEASE_SECONDS + 60,
		});
		const liveId = await seedJob({
			status: "running",
			orientation: "playlist",
			attempts: 1,
			heartbeatAgeSeconds: LEASE_SECONDS - 60,
		});

		const swept = await sweepStaleDeckJobs(LEASE_SECONDS);
		if (Result.isError(swept)) throw swept.error;
		const sweptIds = swept.value.map((j) => j.id);
		expect(sweptIds).toContain(staleId);
		expect(sweptIds).not.toContain(liveId);

		const reclaimed = await readJob(staleId);
		expect(reclaimed.status).toBe("pending");
		expect(reclaimed.heartbeat_is_null).toBe(true);
		expect(reclaimed.available_is_past).toBe(true);
		expect((await readJob(liveId)).status).toBe("running");

		expect(await claimOwn()).toBe(staleId);
		expect((await readJob(staleId)).attempts).toBe(2);
	});
});
