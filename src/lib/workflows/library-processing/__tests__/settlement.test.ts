import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/shared/errors/database";

const { txMock, beginMock } = vi.hoisted(() => {
	const txMock = vi.fn().mockResolvedValue([]);
	return {
		txMock,
		beginMock: vi.fn(async (cb) => cb(txMock)),
	};
});

vi.mock("postgres", () => ({
	default: () => ({
		begin: beginMock,
	}),
}));

vi.mock("@/lib/account-events/producer", () => ({
	writeAccountEvent: vi.fn(),
}));

import { writeAccountEvent } from "@/lib/account-events/producer";
import type { Job } from "@/lib/platform/jobs/repository";
import { settleEnrichmentJobTerminal } from "../settlement";

function makeJob(overrides: Partial<Job> = {}): Job {
	return {
		id: "job-1",
		account_id: "acct-1",
		type: "enrichment",
		status: "running",
		progress: {
			done: 10,
			total: 20,
			succeeded: 8,
			failed: 2,
		},
		error: null,
		attempts: 1,
		max_attempts: 3,
		created_at: "2026-03-26T00:00:00Z",
		updated_at: "2026-03-26T00:00:00Z",
		started_at: "2026-03-26T00:00:00Z",
		completed_at: null,
		heartbeat_at: "2026-03-26T00:00:00Z",
		queue_priority: 0,
		satisfies_requested_at: null,
		...overrides,
	} as Job;
}

describe("settleEnrichmentJobTerminal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		txMock.mockResolvedValue([]);
		beginMock.mockImplementation(async (cb) => cb(txMock));
	});

	it("writes enrichment_completed account event with correct payload", async () => {
		const job = makeJob();
		const result = await settleEnrichmentJobTerminal(
			job,
			"completed",
			"completed",
		);

		expect(result.isOk()).toBe(true);
		expect(writeAccountEvent).toHaveBeenCalledWith(txMock, {
			accountId: "acct-1",
			type: "enrichment_completed",
			payload: {
				jobId: "job-1",
				counts: { done: 10, total: 20, succeeded: 8, failed: 2 },
			},
		});
	});

	it("writes enrichment_stopped account event with reason", async () => {
		const job = makeJob();
		const result = await settleEnrichmentJobTerminal(
			job,
			"failed",
			"user_cancelled",
			"user aborted",
		);

		expect(result.isOk()).toBe(true);
		expect(writeAccountEvent).toHaveBeenCalledWith(txMock, {
			accountId: "acct-1",
			type: "enrichment_stopped",
			payload: {
				jobId: "job-1",
				reason: "user_cancelled",
				counts: { done: 10, total: 20, succeeded: 8, failed: 2 },
			},
		});
	});

	it("does not write account_event if transaction fails", async () => {
		// Mock the query inside tx to throw
		txMock.mockRejectedValueOnce(new Error("Update failed"));

		const job = makeJob();
		const result = await settleEnrichmentJobTerminal(
			job,
			"completed",
			"completed",
		);

		expect(result.isErr()).toBe(true);
		if (!result.isOk()) {
			expect(result.error).toBeInstanceOf(DatabaseError);
			if (result.error instanceof DatabaseError) {
				expect(result.error.code).toBe("settlement_failed");
			}
		}
		expect(writeAccountEvent).not.toHaveBeenCalled();
	});
});
