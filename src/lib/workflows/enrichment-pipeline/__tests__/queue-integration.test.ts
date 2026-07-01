import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@/lib/platform/jobs/repository";

let activeJobResponse: { data: unknown; error: unknown };
let insertJobResponse: { data: unknown; error: unknown };
// When set to a non-empty array, select-path calls shift from here instead
// of reading activeJobResponse. Allows per-call sequencing for race tests.
let activeJobResponseQueue: { data: unknown; error: unknown }[] = [];
// Captures the row passed to .insert() so tests can assert the serialized
// payload rather than the mock's echoed return value.
let lastInsertPayload: Record<string, unknown> | null = null;

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(() => ({
		from: vi.fn((_table: string) => {
			const chain = {
				select: vi.fn().mockReturnThis(),
				insert: vi.fn().mockReturnThis(),
				update: vi.fn().mockReturnThis(),
				upsert: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				in: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				single: vi.fn(),
			};

			let isInsertPath = false;

			chain.insert = vi.fn((payload: Record<string, unknown>) => {
				isInsertPath = true;
				lastInsertPayload = payload;
				return chain;
			});

			chain.single = vi.fn(() => {
				if (isInsertPath) {
					return insertJobResponse;
				}
				if (activeJobResponseQueue.length > 0) {
					return activeJobResponseQueue.shift();
				}
				return activeJobResponse;
			});

			return chain;
		}),
	})),
}));

import {
	createEnrichmentJob,
	ensureEnrichmentJob,
	getActiveEnrichmentJob,
	getOrCreateEnrichmentJob,
} from "@/lib/platform/jobs/library-processing-queue";
import { makeInitialProgress } from "../progress";

const ACCOUNT_ID = "acct-test-123";

function fakeJob(overrides: Partial<Job> = {}): Job {
	return {
		id: "job-existing-456",
		account_id: ACCOUNT_ID,
		type: "enrichment",
		status: "pending",
		progress: { total: 0, done: 0, succeeded: 0, failed: 0 },
		error: null,
		created_at: "2026-03-15T00:00:00Z",
		started_at: null,
		completed_at: null,
		heartbeat_at: null,
		...overrides,
	} as Job;
}

const defaultProgress = makeInitialProgress(5, 1, 0);

describe("Queue integration: getOrCreateEnrichmentJob", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		activeJobResponse = {
			data: null,
			error: { code: "PGRST116", message: "not found" },
		};
		insertJobResponse = { data: null, error: null };
		activeJobResponseQueue = [];
		lastInsertPayload = null;
	});

	describe("sync-triggered queueing (no active job)", () => {
		it("creates a new job when no active job exists", async () => {
			const newJob = fakeJob({ id: "job-new-789" });
			activeJobResponse = {
				data: null,
				error: { code: "PGRST116", message: "not found" },
			};
			insertJobResponse = { data: newJob, error: null };

			const result = await getOrCreateEnrichmentJob(
				ACCOUNT_ID,
				defaultProgress,
			);

			expect(result).toBeOk();
			if (Result.isOk(result)) {
				expect(result.value.id).toBe("job-new-789");
				expect(result.value.type).toBe("enrichment");
				expect(result.value.status).toBe("pending");
			}
		});

		it("passes initial progress to createEnrichmentJob", async () => {
			const progress = makeInitialProgress(10, 3, 0);
			const newJob = fakeJob({ id: "job-batch-10", progress });
			activeJobResponse = {
				data: null,
				error: { code: "PGRST116", message: "not found" },
			};
			insertJobResponse = { data: newJob, error: null };

			const result = await getOrCreateEnrichmentJob(ACCOUNT_ID, progress);

			expect(result).toBeOk();
			// The mock echoes any id, so the id alone proves nothing. Assert the
			// serialized progress actually reached the insert payload — dropping it
			// upstream is the regression this test exists to catch.
			expect(lastInsertPayload).toMatchObject({
				account_id: ACCOUNT_ID,
				type: "enrichment",
				status: "pending",
			});
			expect(
				(lastInsertPayload as { progress: Record<string, unknown> }).progress,
			).toMatchObject({ batchSize: 10, batchSequence: 3 });
		});

		it("persists selectionMode in the serialized insert payload", async () => {
			// The scheduler computes first_match_bootstrap when no first-visible card
			// exists yet. If the serializer drops it, the worker silently falls back to
			// normal selection — the regression this test guards.
			const progress = makeInitialProgress(5, 0, 0, "first_match_bootstrap");
			const newJob = fakeJob({ id: "job-bootstrap-1", progress });
			activeJobResponse = {
				data: null,
				error: { code: "PGRST116", message: "not found" },
			};
			insertJobResponse = { data: newJob, error: null };

			const result = await getOrCreateEnrichmentJob(ACCOUNT_ID, progress);

			expect(result).toBeOk();
			expect(
				(lastInsertPayload as { progress: Record<string, unknown> }).progress,
			).toMatchObject({ selectionMode: "first_match_bootstrap" });
		});

		it("serializes the default normal selectionMode", async () => {
			const progress = makeInitialProgress(5, 0, 0);
			const newJob = fakeJob({ id: "job-normal-1", progress });
			activeJobResponse = {
				data: null,
				error: { code: "PGRST116", message: "not found" },
			};
			insertJobResponse = { data: newJob, error: null };

			await getOrCreateEnrichmentJob(ACCOUNT_ID, progress);

			expect(
				(lastInsertPayload as { progress: Record<string, unknown> }).progress,
			).toMatchObject({ selectionMode: "normal" });
		});
	});

	describe("onboarding-triggered queue reuse (active job exists)", () => {
		it("returns existing active job without creating a new one", async () => {
			const existingJob = fakeJob({
				id: "job-existing-456",
				status: "pending",
			});
			activeJobResponse = { data: existingJob, error: null };

			const result = await getOrCreateEnrichmentJob(
				ACCOUNT_ID,
				defaultProgress,
			);

			expect(result).toBeOk();
			if (Result.isOk(result)) {
				expect(result.value.id).toBe("job-existing-456");
			}
		});

		it("returns running job as active (not just pending)", async () => {
			const runningJob = fakeJob({ id: "job-running-111", status: "running" });
			activeJobResponse = { data: runningJob, error: null };

			const result = await getOrCreateEnrichmentJob(
				ACCOUNT_ID,
				defaultProgress,
			);

			expect(result).toBeOk();
			if (Result.isOk(result)) {
				expect(result.value.id).toBe("job-running-111");
				expect(result.value.status).toBe("running");
			}
		});
	});

	describe("error handling", () => {
		it("propagates database error from getActiveEnrichmentJob", async () => {
			activeJobResponse = {
				data: null,
				error: { code: "PGRST301", message: "connection refused" },
			};

			const result = await getOrCreateEnrichmentJob(
				ACCOUNT_ID,
				defaultProgress,
			);

			expect(result).toBeErr();
			if (Result.isError(result)) {
				expect(result.error._tag).toBe("DatabaseError");
				expect(result.error.message).toBe("connection refused");
			}
		});

		it("propagates database error from createEnrichmentJob", async () => {
			activeJobResponse = {
				data: null,
				error: { code: "PGRST116", message: "not found" },
			};
			insertJobResponse = {
				data: null,
				error: {
					code: "23503",
					message: "foreign key violation",
					details: "account_id does not exist",
				},
			};

			const result = await getOrCreateEnrichmentJob(
				ACCOUNT_ID,
				defaultProgress,
			);

			expect(result).toBeErr();
			if (Result.isError(result)) {
				expect(result.error._tag).toBe("ConstraintError");
			}
		});
	});

	describe("unique-violation fallback", () => {
		it("falls back to reading the winner's job on unique constraint violation", async () => {
			const winnerJob = fakeJob({ id: "job-winner-777" });

			// Sequence: 1st read → not found, insert → unique violation,
			// 2nd read (fallback) → winner's row
			activeJobResponseQueue = [
				{ data: null, error: { code: "PGRST116", message: "not found" } },
				{ data: winnerJob, error: null },
			];
			insertJobResponse = {
				data: null,
				error: {
					code: "23505",
					message: "duplicate key",
					details: "idx_unique_active_enrichment_per_account",
				},
			};

			const result = await getOrCreateEnrichmentJob(
				ACCOUNT_ID,
				defaultProgress,
			);

			expect(result).toBeOk();
			if (Result.isOk(result)) {
				expect(result.value.id).toBe("job-winner-777");
			}
		});
	});

	describe("concurrent trigger safety", () => {
		it("both callers get a valid job when one creates and one reuses", async () => {
			const newJob = fakeJob({ id: "job-concurrent-001" });
			// First call: no active job, creates one
			// Second call: active job exists, reuses it
			activeJobResponse = {
				data: null,
				error: { code: "PGRST116", message: "not found" },
			};
			insertJobResponse = { data: newJob, error: null };

			const result1Promise = getOrCreateEnrichmentJob(
				ACCOUNT_ID,
				defaultProgress,
			);

			// After first call creates the job, simulate it being visible
			activeJobResponse = { data: newJob, error: null };

			const result2Promise = getOrCreateEnrichmentJob(
				ACCOUNT_ID,
				defaultProgress,
			);

			const [result1, result2] = await Promise.all([
				result1Promise,
				result2Promise,
			]);

			expect(result1).toBeOk();
			expect(result2).toBeOk();

			if (Result.isOk(result1) && Result.isOk(result2)) {
				expect(result1.value.id).toBe("job-concurrent-001");
				expect(result2.value.id).toBe("job-concurrent-001");
			}
		});
	});
});

describe("getActiveEnrichmentJob", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns null when no active enrichment job exists", async () => {
		activeJobResponse = {
			data: null,
			error: { code: "PGRST116", message: "not found" },
		};

		const result = await getActiveEnrichmentJob(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value).toBeNull();
		}
	});

	it("returns the active job when one exists", async () => {
		const job = fakeJob({ id: "job-active-999" });
		activeJobResponse = { data: job, error: null };

		const result = await getActiveEnrichmentJob(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value).not.toBeNull();
			if (result.value) expect(result.value.id).toBe("job-active-999");
		}
	});
});

describe("createEnrichmentJob", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates a job with enrichment type and pending status", async () => {
		const progress = makeInitialProgress(5, 1, 0);
		const createdJob = fakeJob({
			id: "job-created-222",
			progress,
		});
		insertJobResponse = { data: createdJob, error: null };

		const result = await createEnrichmentJob(ACCOUNT_ID, progress);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.id).toBe("job-created-222");
			expect(result.value.type).toBe("enrichment");
			expect(result.value.status).toBe("pending");
		}
	});

	it("returns error on insert failure", async () => {
		insertJobResponse = {
			data: null,
			error: {
				code: "23505",
				message: "duplicate key",
				details: "unique constraint",
			},
		};

		const result = await createEnrichmentJob(ACCOUNT_ID, defaultProgress);

		expect(result).toBeErr();
		if (Result.isError(result)) {
			expect(result.error._tag).toBe("ConstraintError");
		}
	});
});

describe("ensureEnrichmentJob", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		activeJobResponse = {
			data: null,
			error: { code: "PGRST116", message: "not found" },
		};
		insertJobResponse = { data: null, error: null };
		activeJobResponseQueue = [];
		lastInsertPayload = null;
	});

	it("persists the bootstrap selectionMode in the inserted job progress", async () => {
		// The scheduler creates the enrichment job via ensureEnrichmentJob; this is
		// the exact path where a dropped selectionMode would leave the worker on
		// normal selection during first-match bootstrap.
		const progress = makeInitialProgress(5, 0, 0, "first_match_bootstrap");
		insertJobResponse = {
			data: fakeJob({ id: "job-ensure-bootstrap", progress }),
			error: null,
		};

		const result = await ensureEnrichmentJob({
			accountId: ACCOUNT_ID,
			satisfiesRequestedAt: "2026-03-15T00:00:00Z",
			queuePriority: 100,
			progress,
		});

		expect(result).toBeOk();
		expect(lastInsertPayload).toMatchObject({
			account_id: ACCOUNT_ID,
			type: "enrichment",
			status: "pending",
			satisfies_requested_at: "2026-03-15T00:00:00Z",
			queue_priority: 100,
		});
		expect(
			(lastInsertPayload as { progress: Record<string, unknown> }).progress,
		).toMatchObject({ selectionMode: "first_match_bootstrap" });
	});
});
