import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/shared/errors/database";
import { SyncFailedError } from "@/lib/shared/errors/domain/sync";

const mockStartJob = vi.fn();
const mockCompleteJob = vi.fn();
const mockFailJob = vi.fn();

vi.mock("@/lib/platform/jobs/lifecycle", () => ({
	startJob: (...args: unknown[]) => mockStartJob(...args),
	completeJob: (...args: unknown[]) => mockCompleteJob(...args),
	failJob: (...args: unknown[]) => mockFailJob(...args),
}));

const { runPhase } = await import("../sync-helpers");

describe("runPhase", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockStartJob.mockResolvedValue(Result.ok({ id: "job-1" }));
		mockCompleteJob.mockResolvedValue(Result.ok({ id: "job-1" }));
		mockFailJob.mockResolvedValue(Result.ok({ id: "job-1" }));
	});

	it("returns an error when completeJob fails instead of silently succeeding", async () => {
		const completeError = new DatabaseError({
			code: "db_error",
			message: "complete failed",
		});
		mockCompleteJob.mockResolvedValueOnce(Result.err(completeError));

		const result = await runPhase("job-1", async () => Result.ok({ total: 1 }));

		expect(Result.isError(result)).toBe(true);
		if (Result.isOk(result)) {
			throw new Error("expected result to be an error");
		}
		expect(result.error).toBe(completeError);
		expect(mockCompleteJob).toHaveBeenCalledWith("job-1");
	});

	it("returns a lifecycle error when failJob cleanup fails", async () => {
		const syncError = new SyncFailedError(
			"liked_songs",
			"acct-1",
			"spotify exploded",
		);
		const cleanupError = new DatabaseError({
			code: "db_error",
			message: "fail cleanup failed",
		});
		mockFailJob.mockResolvedValueOnce(Result.err(cleanupError));

		const result = await runPhase("job-1", async () => Result.err(syncError));

		expect(Result.isError(result)).toBe(true);
		if (Result.isOk(result)) {
			throw new Error("expected result to be an error");
		}
		expect(result.error).toBe(cleanupError);
		expect(mockFailJob).toHaveBeenCalledWith("job-1", syncError.message);
	});
});
