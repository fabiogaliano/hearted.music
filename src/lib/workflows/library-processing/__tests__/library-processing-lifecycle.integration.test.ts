/**
 * Library-processing job lifecycle against the real SQL:
 * claim_pending_library_processing_job, sweep_stale_library_processing_jobs and
 * mark_dead_library_processing_jobs (20260625050000 / 20260327200650), plus the
 * worker-side finalize in src/worker/finalize.ts. The runner suites mock all of
 * these, so the claim/sweep interplay and the settlement fence only exist here.
 *
 * Expected values come from the SQL: the claim flips pending→running,
 * attempts+1, stamps started_at/heartbeat_at, and skips rows whose
 * available_at is in the future; the sweep re-pends running rows whose
 * heartbeat is older than the threshold while attempts < max_attempts
 * (started_at/heartbeat_at cleared); mark_dead fails running rows past the
 * threshold with attempts >= max_attempts. Each claim increments `attempts`,
 * so (status = 'running', attempts) identifies one claim of the row.
 *
 * The claim is global, so seeded jobs carry the maximum queue_priority and an
 * ancient created_at to win its ORDER BY over unrelated local rows.
 * Auto-skipped unless DATABASE_URL and SUPABASE_URL point at the local stack.
 */

import { Result } from "better-result";
import postgres from "postgres";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { getLatestJobExecutionMeasurement } from "@/lib/platform/jobs/execution-measurements";
import {
	claimLibraryProcessingJob,
	markDeadLibraryProcessingJobs,
	sweepStaleLibraryProcessingJobs,
} from "@/lib/platform/jobs/library-processing-queue";
import {
	type Job,
	updateHeartbeat,
	updateJobProgress,
} from "@/lib/platform/jobs/repository";
import { makeWorkerOutcomes } from "@/test/fixtures";
import {
	finalizeJob,
	requeueLibraryProcessingJobForRetry,
} from "@/worker/finalize";
import {
	findTerminalActiveRefs,
	getOrCreateLibraryProcessingState,
	persistLibraryProcessingState,
	swapActiveJobRef,
} from "../queries";
import { applyLibraryProcessingChange } from "../service";
import { changeOf, workerOutcomeFromMeasurement } from "../worker-outcome";

// The real client, except that a transaction can be made to commit and then
// throw, as when the connection drops before the COMMIT reply arrives.
const replyLoss = vi.hoisted(() => ({ nextBegin: false }));
vi.mock("postgres", async (importOriginal) => {
	const real = (await importOriginal<{ default: typeof postgres }>()).default;
	const connect = (...args: Parameters<typeof real>) => {
		const client = real(...args);
		return new Proxy(client, {
			get(target, prop, receiver) {
				if (prop !== "begin") return Reflect.get(target, prop, receiver);
				return async (...beginArgs: Parameters<typeof target.begin>) => {
					const committed = await target.begin(...beginArgs);
					if (replyLoss.nextBegin) {
						replyLoss.nextBegin = false;
						throw new Error("connection reset after COMMIT");
					}
					return committed;
				};
			},
		});
	};
	return { default: connect };
});

function outcomesFor(job: Job) {
	return makeWorkerOutcomes({ jobId: job.id, accountId: job.account_id });
}

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

async function seedPendingJob(
	type: "enrichment" | "match_snapshot_refresh",
	opts: { maxAttempts?: number } = {},
): Promise<string> {
	const id = crypto.randomUUID();
	await db()`
    INSERT INTO job(
      id, account_id, type, status, attempts, max_attempts, queue_priority,
      available_at, created_at, progress
    ) VALUES (
      ${id}, ${account()}, ${type}, 'pending', 0, ${opts.maxAttempts ?? 3},
      2147483647, '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z',
      ${db().json({ done: 4, total: 5, succeeded: 3, failed: 1 })}
    )
  `;
	return id;
}

async function claim(): Promise<Job> {
	const claimed = await claimLibraryProcessingJob();
	if (Result.isError(claimed)) throw claimed.error;
	if (!claimed.value) throw new Error("nothing claimable");
	return claimed.value;
}

async function stallHeartbeat(jobId: string): Promise<void> {
	await db()`UPDATE job SET heartbeat_at = now() - make_interval(secs => ${STALE_AGE_SECONDS}) WHERE id = ${jobId}`;
}

async function sweptIds(): Promise<string[]> {
	const swept = await sweepStaleLibraryProcessingJobs(STALE_THRESHOLD);
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
}

async function readJob(id: string): Promise<JobRow> {
	const rows = await db()<JobRow[]>`
    SELECT status, attempts, error,
           started_at IS NULL AS started_is_null,
           heartbeat_at IS NULL AS heartbeat_is_null,
           completed_at IS NULL AS completed_is_null
    FROM job WHERE id = ${id}
  `;
	const row = rows[0];
	if (!row) throw new Error(`job ${id} missing`);
	return row;
}

async function readProgress(id: string): Promise<unknown> {
	const rows = await db()<{ progress: unknown }[]>`
    SELECT progress FROM job WHERE id = ${id}
  `;
	return rows[0]?.progress;
}

async function eventTypes(): Promise<string[]> {
	const rows = await db()<{ type: string }[]>`
    SELECT type FROM account_event WHERE account_id = ${account()} ORDER BY id
  `;
	return rows.map((r) => r.type);
}

async function refreshFreshness(): Promise<{
	settled: string | null;
	active: string | null;
}> {
	const [row] = await db()<{ settled: Date | null; active: string | null }[]>`
    SELECT match_snapshot_refresh_settled_at AS settled,
           match_snapshot_refresh_active_job_id AS active
    FROM library_processing_state WHERE account_id = ${account()}
  `;
	return {
		settled: row?.settled ? row.settled.toISOString() : null,
		active: row?.active ?? null,
	};
}

async function measurementOutcomes(jobId: string): Promise<string[]> {
	const rows = await db()<{ outcome: string }[]>`
    SELECT outcome FROM job_execution_measurement WHERE job_id = ${jobId} ORDER BY created_at
  `;
	return rows.map((r) => r.outcome);
}

/** First run claims, stalls past the threshold, is swept, and a second worker reclaims. */
async function sweepAndReclaim(jobId: string): Promise<{
	stale: Job;
	current: Job;
}> {
	const stale = await claim();
	expect(stale.id).toBe(jobId);
	await stallHeartbeat(jobId);
	expect(await sweptIds()).toContain(jobId);
	const current = await claim();
	expect(current.id).toBe(jobId);
	return { stale, current };
}

beforeEach(async () => {
	if (!IS_LOCAL) return;
	accountId = crypto.randomUUID();
	await db()`INSERT INTO account(id, spotify_id) VALUES (${accountId}, ${`test-${accountId}`})`;
});

afterEach(async () => {
	if (!IS_LOCAL || !accountId) return;
	// Account cascade clears jobs, account_event and library_processing_state.
	await db()`DELETE FROM account WHERE id = ${accountId}`;
	accountId = null;
});

afterAll(async () => {
	await sql?.end();
});

describe.skipIf(!IS_LOCAL)("claim → settle", () => {
	it("claim leases one attempt; settle completes it and emits exactly one event", async () => {
		const jobId = await seedPendingJob("enrichment");

		const job = await claim();
		expect(job.id).toBe(jobId);
		expect(job.status).toBe("running");
		expect(job.attempts).toBe(1);
		const running = await readJob(jobId);
		expect(running.started_is_null).toBe(false);
		expect(running.heartbeat_is_null).toBe(false);

		expect(
			await finalizeJob(job, outcomesFor(job).enrichmentCompleted),
		).toHaveOkValue("applied");
		const done = await readJob(jobId);
		expect(done.status).toBe("completed");
		expect(done.completed_is_null).toBe(false);
		expect(await eventTypes()).toEqual(["enrichment_completed"]);
		expect(await measurementOutcomes(jobId)).toEqual(["completed"]);
	});

	it("regression: a committed finalize whose reply was lost must report applied, not lease_lost", async () => {
		const jobId = await seedPendingJob("enrichment");
		const job = await claim();
		replyLoss.nextBegin = true;

		const finalized = await finalizeJob(
			job,
			outcomesFor(job).enrichmentCompleted,
		);

		expect(finalized).toHaveOkValue("applied");
		expect((await readJob(jobId)).status).toBe("completed");
		expect(await eventTypes()).toEqual(["enrichment_completed"]);
		expect(await measurementOutcomes(jobId)).toEqual(["completed"]);
	});

	it("a finalized published refresh leaves freshness to the reconciler, and its measurement alone settles it at the job's marker", async () => {
		const marker = "2026-10-01T00:00:00.000Z";
		const jobId = await seedPendingJob("match_snapshot_refresh");
		await db()`UPDATE job SET satisfies_requested_at = ${marker} WHERE id = ${jobId}`;
		await db()`
      INSERT INTO library_processing_state(
        account_id, match_snapshot_refresh_requested_at, match_snapshot_refresh_active_job_id
      ) VALUES (${account()}, ${marker}, ${jobId})
    `;
		const job = await claim();

		expect(
			await finalizeJob(job, outcomesFor(job).refreshPublished),
		).toHaveOkValue("applied");
		expect(await refreshFreshness()).toEqual({
			settled: null,
			active: jobId,
		});

		// What terminal recovery replays when the runner's apply never landed.
		const measurement = await getLatestJobExecutionMeasurement(jobId);
		if (Result.isError(measurement) || !measurement.value) {
			throw new Error("finalize wrote no measurement");
		}
		const outcome = workerOutcomeFromMeasurement(measurement.value);
		if (!outcome) throw new Error("measurement did not decode");
		const applied = await applyLibraryProcessingChange(changeOf(outcome));
		if (Result.isError(applied)) throw new Error(applied.error.kind);

		expect(await refreshFreshness()).toEqual({ settled: marker, active: null });
	});

	it("a job whose available_at is in the future is not claimable", async () => {
		const jobId = await seedPendingJob("enrichment");
		await db()`UPDATE job SET available_at = now() + interval '1 hour' WHERE id = ${jobId}`;

		const claimed = await claimLibraryProcessingJob();
		if (Result.isError(claimed)) throw claimed.error;
		expect(claimed.value?.id).not.toBe(jobId);
		expect((await readJob(jobId)).status).toBe("pending");
	});

	it("requeue for retry re-pends the claim with backoff and the error recorded", async () => {
		const jobId = await seedPendingJob("enrichment");
		const job = await claim();

		expect(
			await requeueLibraryProcessingJobForRetry(job, "boom"),
		).toHaveOkValue(true);
		const row = await readJob(jobId);
		expect(row.status).toBe("pending");
		expect(row.error).toBe("boom");
		expect(row.started_is_null).toBe(true);
		expect(row.heartbeat_is_null).toBe(true);
		expect(await eventTypes()).toEqual([]);
	});
});

describe.skipIf(!IS_LOCAL)("stale sweep and dead-letter", () => {
	it("sweep re-pends a stale running job with attempts left and leaves a live one alone", async () => {
		const staleId = await seedPendingJob("enrichment");
		await claim();
		await stallHeartbeat(staleId);
		const liveId = await seedPendingJob("match_snapshot_refresh");
		await claim();

		const ids = await sweptIds();
		expect(ids).toContain(staleId);
		expect(ids).not.toContain(liveId);

		const swept = await readJob(staleId);
		expect(swept.status).toBe("pending");
		expect(swept.attempts).toBe(1);
		expect(swept.started_is_null).toBe(true);
		expect(swept.heartbeat_is_null).toBe(true);
		expect((await readJob(liveId)).status).toBe("running");

		expect((await claim()).id).toBe(staleId);
		expect((await readJob(staleId)).attempts).toBe(2);
	});

	it("an exhausted stale job is dead-lettered, not swept, and a late settle cannot revive it", async () => {
		const jobId = await seedPendingJob("enrichment", { maxAttempts: 1 });
		const job = await claim();
		await stallHeartbeat(jobId);

		expect(await sweptIds()).not.toContain(jobId);
		const dead = await markDeadLibraryProcessingJobs(STALE_THRESHOLD);
		if (Result.isError(dead)) throw dead.error;
		expect(dead.value.map((j) => j.id)).toContain(jobId);
		const failed = await readJob(jobId);
		expect(failed.status).toBe("failed");
		expect(failed.error).toBe("max attempts exhausted after stale detection");

		// Dead-letter recovery owns the reconcile; the late worker must stay silent.
		const late = await finalizeJob(job, outcomesFor(job).enrichmentCompleted);
		expect((await readJob(jobId)).status).toBe("failed");
		expect(await eventTypes()).toEqual([]);
		expect(late).toHaveOkValue("lease_lost");
	});
});

describe.skipIf(!IS_LOCAL)(
	"late settle after sweep+reclaim must not overwrite the new run (regression: id-only terminal UPDATE let a stale worker complete a reclaimed job and emit duplicate events)",
	() => {
		it("enrichment: the stale worker's settle is superseded; the reclaiming worker's settle lands once", async () => {
			const jobId = await seedPendingJob("enrichment");
			const { stale, current } = await sweepAndReclaim(jobId);

			const late = await finalizeJob(
				stale,
				outcomesFor(stale).enrichmentCompleted,
			);
			const afterStale = await readJob(jobId);
			expect(afterStale.status).toBe("running");
			expect(afterStale.attempts).toBe(2);
			expect(afterStale.completed_is_null).toBe(true);
			expect(await eventTypes()).toEqual([]);
			expect(late).toHaveOkValue("lease_lost");

			expect(
				await finalizeJob(current, outcomesFor(current).enrichmentCompleted),
			).toHaveOkValue("applied");
			expect((await readJob(jobId)).status).toBe("completed");
			expect(await eventTypes()).toEqual(["enrichment_completed"]);
		});

		it("match refresh: the stale worker neither publishes nor releases the new run's active ref", async () => {
			const jobId = await seedPendingJob("match_snapshot_refresh");
			await db()`
        INSERT INTO library_processing_state(account_id, match_snapshot_refresh_active_job_id)
        VALUES (${account()}, ${jobId})
      `;
			const { stale } = await sweepAndReclaim(jobId);

			const late = await finalizeJob(stale, {
				...outcomesFor(stale).refreshPublished,
				snapshotId: null,
			});
			expect((await readJob(jobId)).status).toBe("running");
			const [state] = await db()<
				{ active: string | null; settled_is_null: boolean }[]
			>`
        SELECT match_snapshot_refresh_active_job_id AS active,
               match_snapshot_refresh_settled_at IS NULL AS settled_is_null
        FROM library_processing_state WHERE account_id = ${account()}
      `;
			expect(state?.active).toBe(jobId);
			expect(state?.settled_is_null).toBe(true);
			expect(await eventTypes()).toEqual([]);
			expect(late).toHaveOkValue("lease_lost");
		});

		it("a stale worker's heartbeat cannot keep a dead reclaiming worker's lease alive (regression: id-only heartbeat masked the new owner's death from the sweep)", async () => {
			const jobId = await seedPendingJob("enrichment");
			const { stale } = await sweepAndReclaim(jobId);
			// The reclaiming worker dies: its heartbeat stops renewing.
			await stallHeartbeat(jobId);

			const late = await updateHeartbeat(stale);

			expect(await sweptIds()).toContain(jobId);
			expect(late).toHaveOkValue("superseded");
		});

		it("a stale worker's progress write cannot overwrite the reclaiming worker's progress (regression: id-only progress UPDATE let a stale write land after reclaim)", async () => {
			const jobId = await seedPendingJob("enrichment");
			const { stale, current } = await sweepAndReclaim(jobId);
			const seeded = { done: 4, total: 5, succeeded: 3, failed: 1 };

			const late = await updateJobProgress(stale, {
				done: 1,
				total: 9,
				succeeded: 1,
				failed: 0,
			});
			expect(await readProgress(jobId)).toEqual(seeded);
			expect(late).toHaveOkValue("superseded");

			const live = { done: 2, total: 5, succeeded: 2, failed: 0 };
			expect(await updateJobProgress(current, live)).toHaveOkValue("applied");
			expect(await readProgress(jobId)).toEqual(live);
		});

		it("a stale worker's requeue cannot re-pend the reclaimed run", async () => {
			const jobId = await seedPendingJob("enrichment");
			const { stale } = await sweepAndReclaim(jobId);

			const late = await requeueLibraryProcessingJobForRetry(
				stale,
				"stale boom",
			);
			const row = await readJob(jobId);
			expect(row.status).toBe("running");
			expect(row.error).toBeNull();
			expect(row.heartbeat_is_null).toBe(false);
			expect(late).toHaveOkValue(false);
		});
	},
);

describe.skipIf(!IS_LOCAL)("findTerminalActiveRefs", () => {
	it("returns an active ref only when its embedded job is terminal", async () => {
		const completedId = await seedPendingJob("enrichment");
		const runningId = await seedPendingJob("match_snapshot_refresh");
		await db()`UPDATE job SET status = 'completed', started_at = now(), completed_at = now() WHERE id = ${completedId}`;
		await db()`UPDATE job SET status = 'running', attempts = 1, started_at = now(), heartbeat_at = now() WHERE id = ${runningId}`;
		await db()`
      INSERT INTO library_processing_state(
        account_id, enrichment_active_job_id, match_snapshot_refresh_active_job_id
      ) VALUES (${account()}, ${completedId}, ${runningId})
      ON CONFLICT (account_id) DO UPDATE SET
        enrichment_active_job_id = EXCLUDED.enrichment_active_job_id,
        match_snapshot_refresh_active_job_id = EXCLUDED.match_snapshot_refresh_active_job_id
    `;

		const refs = await findTerminalActiveRefs();
		if (Result.isError(refs)) throw refs.error;

		// The sweep is global; only this account's refs are under test.
		const mine = refs.value.filter((r) => r.state.accountId === account());
		expect(mine.map((r) => [r.workflow, r.job.id])).toEqual([
			["enrichment", completedId],
		]);
	});
});

describe.skipIf(!IS_LOCAL)("library_processing_state compare-and-set", () => {
	async function load() {
		const loaded = await getOrCreateLibraryProcessingState(account());
		if (Result.isError(loaded)) throw loaded.error;
		return loaded.value;
	}

	it("regression: refuses a write built from a read that another runtime has since overtaken", async () => {
		const read = await load();
		// Another runtime writes after our read; the trigger bumps updated_at.
		await db()`UPDATE library_processing_state SET enrichment_requested_at = now() WHERE account_id = ${account()}`;

		const marker = "2026-10-06T00:00:00.000Z";
		const staleWrite = await persistLibraryProcessingState({
			...read,
			matchSnapshotRefresh: {
				...read.matchSnapshotRefresh,
				requestedAt: marker,
			},
		});
		expect(staleWrite).toHaveOkValue(null);

		const reread = await load();
		const freshWrite = await persistLibraryProcessingState({
			...reread,
			matchSnapshotRefresh: {
				...reread.matchSnapshotRefresh,
				requestedAt: marker,
			},
		});
		if (Result.isError(freshWrite)) throw freshWrite.error;
		expect(freshWrite.value?.enrichment.requestedAt).toBe(
			reread.enrichment.requestedAt,
		);
	});

	it("swaps an active ref only from the value it expects", async () => {
		await load();
		const first = await seedPendingJob("enrichment");
		// One active enrichment job per account (partial unique index); the
		// refused swap never writes, so any existing job id serves here.
		const second = await seedPendingJob("match_snapshot_refresh");

		expect(
			await swapActiveJobRef(account(), "enrichment", null, first),
		).toHaveOkValue(true);
		// The ref is no longer null, so a swap that expects null must not land.
		expect(
			await swapActiveJobRef(account(), "enrichment", null, second),
		).toHaveOkValue(false);

		const state = await load();
		expect(state.enrichment.activeJobId).toBe(first);
	});
});
