import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@/lib/platform/jobs/repository";

let activeJobResponse: { data: unknown; error: unknown };
let insertJobResponse: { data: unknown; error: unknown };
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
				maybeSingle: vi.fn(() => activeJobResponse),
			};

			chain.insert = vi.fn((payload: Record<string, unknown>) => {
				lastInsertPayload = payload;
				return chain;
			});

			chain.single = vi.fn(() => insertJobResponse);

			return chain;
		}),
	})),
}));

import {
	ensureEnrichmentJob,
	getActiveEnrichmentJob,
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

describe("getActiveEnrichmentJob", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns null when no active enrichment job exists", async () => {
		activeJobResponse = { data: null, error: null };

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

describe("ensureEnrichmentJob", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		activeJobResponse = { data: null, error: null };
		insertJobResponse = { data: null, error: null };
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
