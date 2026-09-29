/**
 * Deck-job lifecycle against the real SQL: claim_pending_match_review_deck_job
 * and mark_dead_match_review_deck_jobs (latest: 20260706000011),
 * sweep_stale_match_review_deck_jobs (20260706000006), and the direct-UPDATE
 * settlements in deck-jobs.ts whose only guard is `status = 'running'`. The
 * worker suite mocks every one of these, so the compare-and-set and the
 * claim's attempts/available_at gates only exist here.
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
	claimDeckJob,
	completeDeckJob,
	deferDeckJob,
	markDeadDeckJobs,
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

// Mirrors DECK_JOB_LEASE_SECONDS in src/worker/poll-match-deck-jobs.ts.
const LEASE_SECONDS = 900;

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
      attempts, max_attempts, available_at, heartbeat_at
    ) VALUES (
      ${id}, ${account()}, ${opts.orientation ?? "song"}, ${"capture_ahead"},
      ${`test:${id}`}, ${opts.status}, ${opts.attempts ?? 0},
      ${opts.maxAttempts ?? 3}, ${"2000-01-01T00:00:00Z"}::timestamptz,
      CASE WHEN ${heartbeatAge}::int IS NULL THEN NULL
           ELSE now() - make_interval(secs => ${heartbeatAge}::int) END
    )
  `;
	return id;
}

interface JobRow {
	status: string;
	attempts: number;
	heartbeat_is_null: boolean;
	available_epoch_ms: number;
	available_is_past: boolean;
}

async function readJob(id: string): Promise<JobRow> {
	const rows = await db()<JobRow[]>`
    SELECT status,
           attempts,
           heartbeat_at IS NULL AS heartbeat_is_null,
           (extract(epoch FROM available_at) * 1000)::float8 AS available_epoch_ms,
           available_at <= now() AS available_is_past
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

		expect(await claimOwn()).toBe(jobId);
		const running = await readJob(jobId);
		expect(running.status).toBe("running");
		expect(running.attempts).toBe(1);
		expect(running.heartbeat_is_null).toBe(false);

		expect(await completeDeckJob(jobId)).toHaveOkValue(true);
		expect((await readJob(jobId)).status).toBe("completed");
	});

	it("defer re-pends with the backoff and keeps the attempt; the claim waits out available_at", async () => {
		const jobId = await seedJob({ status: "pending" });
		expect(await claimOwn()).toBe(jobId);

		const before = Date.now();
		expect(await deferDeckJob(jobId, 30)).toHaveOkValue(true);
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
		expect(await claimOwn()).toBe(jobId);
		expect(await deferDeckJob(jobId, 30)).toHaveOkValue(true);
		await db()`UPDATE match_review_deck_job SET available_at = now() - interval '1 second' WHERE id = ${jobId}`;

		expect(await claimOwn()).not.toBe(jobId);

		const dead = await markDeadDeckJobs(LEASE_SECONDS);
		if (Result.isError(dead)) throw dead.error;
		expect(dead.value.map((j) => j.id)).toContain(jobId);
		expect((await readJob(jobId)).status).toBe("dead");
	});
});

describe.skipIf(!IS_LOCAL)("settlement compare-and-set on status", () => {
	it("a late settle cannot resurrect a job the sweep tick dead-lettered", async () => {
		const jobId = await seedJob({
			status: "running",
			attempts: 3,
			maxAttempts: 3,
			heartbeatAgeSeconds: LEASE_SECONDS + 300,
		});

		// Same order as runMatchDeckJobSweepTick: sweep leaves exhausted jobs
		// alone, mark_dead terminalizes them.
		const swept = await sweepStaleDeckJobs(LEASE_SECONDS);
		if (Result.isError(swept)) throw swept.error;
		expect(swept.value.map((j) => j.id)).not.toContain(jobId);
		const dead = await markDeadDeckJobs(LEASE_SECONDS);
		if (Result.isError(dead)) throw dead.error;
		expect(dead.value.map((j) => j.id)).toContain(jobId);

		expect(await completeDeckJob(jobId)).toHaveOkValue(false);
		expect(await deferDeckJob(jobId, 30)).toHaveOkValue(false);
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

		expect(await completeDeckJob(jobId)).toHaveOkValue(false);
		expect(await deferDeckJob(jobId, 30)).toHaveOkValue(false);
		const row = await readJob(jobId);
		expect(row.status).toBe("pending");
		// A leaked defer would have pushed available_at 30s into the future.
		expect(row.available_is_past).toBe(true);
	});

	it("double complete is idempotent and a defer cannot re-open a completed job", async () => {
		const jobId = await seedJob({ status: "pending" });
		expect(await claimOwn()).toBe(jobId);

		expect(await completeDeckJob(jobId)).toHaveOkValue(true);
		expect(await completeDeckJob(jobId)).toHaveOkValue(false);
		expect(await deferDeckJob(jobId, 30)).toHaveOkValue(false);
		expect((await readJob(jobId)).status).toBe("completed");
	});

	it("double defer does not push the retry out again", async () => {
		const jobId = await seedJob({ status: "pending" });
		expect(await claimOwn()).toBe(jobId);

		expect(await deferDeckJob(jobId, 30)).toHaveOkValue(true);
		const first = await readJob(jobId);
		expect(await deferDeckJob(jobId, 600)).toHaveOkValue(false);
		const second = await readJob(jobId);
		expect(second.status).toBe("pending");
		expect(second.available_epoch_ms).toBe(first.available_epoch_ms);
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
