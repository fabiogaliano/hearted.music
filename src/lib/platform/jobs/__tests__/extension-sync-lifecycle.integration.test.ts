/**
 * Extension-sync parent job lifecycle against the real SQL:
 * claim_pending_extension_sync_job (20260612090100), and
 * sweep_stale_extension_sync_jobs, mark_dead_extension_sync_jobs and
 * claim_extension_sync_payload_cleanup (20260612090200), plus the
 * compare-and-set status writes in repository.ts / lifecycle.ts. The worker
 * suites mock all of these, so the lease fence only exists here.
 *
 * Expected values come from the SQL: the claim flips the oldest pending parent
 * to running with attempts+1 and started_at/heartbeat_at stamped; the sweep
 * re-pends running parents whose heartbeat is older than the threshold while
 * attempts < max_attempts; mark_dead fails exhausted ones with a fixed error;
 * the payload cleanup strips `payload_path` from terminal parents and returns
 * each path exactly once.
 *
 * The claim is global and ordered by created_at, so seeded parents carry an
 * ancient created_at to win over unrelated local rows. Auto-skipped unless
 * DATABASE_URL and SUPABASE_URL point at the local stack.
 */

import { Result } from "better-result";
import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	claimExtensionSyncJob,
	claimExtensionSyncPayloadCleanup,
	markDeadExtensionSyncJobs,
	sweepStaleExtensionSyncJobs,
} from "../extension-sync-jobs";
import { completeJob, settleClaimedJob, startJob } from "../lifecycle";
import type { Job } from "../repository";

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

const STALE_THRESHOLD = "5 minutes";
const STALE_AGE_SECONDS = 600;

let accountId: string | null = null;

function account(): string {
	if (!accountId) throw new Error("fixture not seeded");
	return accountId;
}

async function seedJob(opts: {
	type?: "extension_sync" | "sync_liked_songs";
	status?: "pending" | "failed";
	maxAttempts?: number;
	payloadPath?: string;
}): Promise<string> {
	const id = crypto.randomUUID();
	const progress = opts.payloadPath ? { payload_path: opts.payloadPath } : {};
	await db()`
    INSERT INTO job(id, account_id, type, status, attempts, max_attempts, created_at, progress)
    VALUES (
      ${id}, ${account()}, ${opts.type ?? "extension_sync"}, ${opts.status ?? "pending"},
      0, ${opts.maxAttempts ?? 3}, '2000-01-01T00:00:00Z', ${db().json(progress)}
    )
  `;
	return id;
}

async function claim(): Promise<Job> {
	const claimed = await claimExtensionSyncJob();
	if (Result.isError(claimed)) throw claimed.error;
	if (!claimed.value) throw new Error("nothing claimable");
	return claimed.value;
}

async function stallHeartbeat(jobId: string): Promise<void> {
	await db()`UPDATE job SET heartbeat_at = now() - make_interval(secs => ${STALE_AGE_SECONDS}) WHERE id = ${jobId}`;
}

async function sweptIds(): Promise<string[]> {
	const swept = await sweepStaleExtensionSyncJobs(STALE_THRESHOLD);
	if (Result.isError(swept)) throw swept.error;
	return swept.value.map((j) => j.id);
}

interface JobRow {
	status: string;
	attempts: number;
	error: string | null;
	started_is_null: boolean;
	heartbeat_is_null: boolean;
	completed_is_null: boolean;
	has_payload_path: boolean;
}

async function readJob(id: string): Promise<JobRow> {
	const rows = await db()<JobRow[]>`
    SELECT status, attempts, error,
           started_at IS NULL AS started_is_null,
           heartbeat_at IS NULL AS heartbeat_is_null,
           completed_at IS NULL AS completed_is_null,
           progress ? 'payload_path' AS has_payload_path
    FROM job WHERE id = ${id}
  `;
	const row = rows[0];
	if (!row) throw new Error(`job ${id} missing`);
	return row;
}

beforeEach(async () => {
	if (!IS_LOCAL) return;
	accountId = crypto.randomUUID();
	await db()`INSERT INTO account(id, spotify_id) VALUES (${accountId}, ${`test-${accountId}`})`;
});

afterEach(async () => {
	if (!IS_LOCAL || !accountId) return;
	await db()`DELETE FROM account WHERE id = ${accountId}`;
	accountId = null;
});

afterAll(async () => {
	await sql?.end();
});

describe.skipIf(!IS_LOCAL)("claim → settle", () => {
	it("claim leases one attempt; the leaseholder's settle completes the parent", async () => {
		const jobId = await seedJob({});

		const job = await claim();
		expect(job.id).toBe(jobId);
		expect(job.status).toBe("running");
		expect(job.attempts).toBe(1);
		const running = await readJob(jobId);
		expect(running.started_is_null).toBe(false);
		expect(running.heartbeat_is_null).toBe(false);

		expect(await settleClaimedJob(job, "completed")).toHaveOkValue("applied");
		const done = await readJob(jobId);
		expect(done.status).toBe("completed");
		expect(done.completed_is_null).toBe(false);

		// Re-invocation (e.g. a retried settle) is a no-op, not a second write.
		expect(await settleClaimedJob(job, "failed", "late")).toHaveOkValue(
			"superseded",
		);
		expect((await readJob(jobId)).status).toBe("completed");
	});
});

describe.skipIf(!IS_LOCAL)("stale sweep, dead-letter, payload cleanup", () => {
	it("sweep re-pends a stale running parent with attempts left, and it is claimable again", async () => {
		const jobId = await seedJob({});
		await claim();
		await stallHeartbeat(jobId);

		expect(await sweptIds()).toContain(jobId);
		const swept = await readJob(jobId);
		expect(swept.status).toBe("pending");
		expect(swept.attempts).toBe(1);
		expect(swept.started_is_null).toBe(true);
		expect(swept.heartbeat_is_null).toBe(true);

		expect((await claim()).attempts).toBe(2);
	});

	it("sweep leaves a running parent with a fresh heartbeat alone", async () => {
		const jobId = await seedJob({});
		await claim();

		expect(await sweptIds()).not.toContain(jobId);
		expect((await readJob(jobId)).status).toBe("running");
	});

	it("an exhausted stale parent is dead-lettered, not swept, and its late settle is superseded", async () => {
		const jobId = await seedJob({ maxAttempts: 1 });
		const job = await claim();
		await stallHeartbeat(jobId);

		expect(await sweptIds()).not.toContain(jobId);
		const dead = await markDeadExtensionSyncJobs(STALE_THRESHOLD);
		if (Result.isError(dead)) throw dead.error;
		expect(dead.value.map((j) => j.id)).toContain(jobId);
		const failed = await readJob(jobId);
		expect(failed.status).toBe("failed");
		expect(failed.error).toBe("max attempts exhausted after stale detection");

		expect(await settleClaimedJob(job, "completed")).toHaveOkValue(
			"superseded",
		);
		expect((await readJob(jobId)).status).toBe("failed");
	});

	it("payload cleanup returns each terminal parent's path once and never a live one's", async () => {
		const terminalPath = `${account()}/terminal.json`;
		const livePath = `${account()}/live.json`;
		const terminalId = await seedJob({
			status: "failed",
			payloadPath: terminalPath,
		});
		const liveId = await seedJob({ payloadPath: livePath });

		const first = await claimExtensionSyncPayloadCleanup();
		if (Result.isError(first)) throw first.error;
		const mine = first.value.filter((r) => r.accountId === account());
		expect(mine).toEqual([
			{ jobId: terminalId, accountId: account(), payloadPath: terminalPath },
		]);
		expect((await readJob(terminalId)).has_payload_path).toBe(false);
		expect((await readJob(liveId)).has_payload_path).toBe(true);

		const second = await claimExtensionSyncPayloadCleanup();
		if (Result.isError(second)) throw second.error;
		expect(second.value.filter((r) => r.accountId === account())).toEqual([]);
	});
});

describe.skipIf(!IS_LOCAL)(
	"late settle after sweep+reclaim must not overwrite the new run (regression: id-only terminal UPDATE let a stale worker complete a reclaimed extension sync)",
	() => {
		it("the stale worker's settle is superseded; the reclaiming worker's lands", async () => {
			const jobId = await seedJob({});
			const stale = await claim();
			await stallHeartbeat(jobId);
			expect(await sweptIds()).toContain(jobId);
			const current = await claim();
			expect(current.id).toBe(jobId);

			const late = await settleClaimedJob(stale, "completed");
			const afterStale = await readJob(jobId);
			expect(afterStale.status).toBe("running");
			expect(afterStale.attempts).toBe(2);
			expect(afterStale.completed_is_null).toBe(true);
			expect(late).toHaveOkValue("superseded");

			expect(await settleClaimedJob(current, "failed", "boom")).toHaveOkValue(
				"applied",
			);
			const settled = await readJob(jobId);
			expect(settled.status).toBe("failed");
			expect(settled.error).toBe("boom");
		});
	},
);

describe.skipIf(!IS_LOCAL)(
	"unclaimed job transitions are compare-and-set",
	() => {
		it("a failed phase job is terminal: a late start or complete cannot revive it", async () => {
			const phaseId = await seedJob({
				type: "sync_liked_songs",
				status: "failed",
			});

			expect(await startJob(phaseId)).toHaveOkValue("superseded");
			expect(await completeJob(phaseId)).toHaveOkValue("superseded");
			expect((await readJob(phaseId)).status).toBe("failed");
		});
	},
);
