import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";
import { updateHeartbeat } from "@/lib/platform/jobs/repository";
import { DatabaseError } from "@/lib/shared/errors/database";
import { makeJob } from "@/test/fixtures";
import { startHeartbeat } from "../job-lease";

vi.mock("@/lib/platform/jobs/repository", () => ({
	updateHeartbeat: vi.fn(),
}));

vi.mock("@/lib/observability/logger", () => ({
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../config", () => ({
	workerConfig: { heartbeatIntervalMs: 1000 },
}));

const job = makeJob();

describe("startHeartbeat", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("signals leaseLost once a renewal is superseded, and stops renewing", async () => {
		vi.useFakeTimers();
		vi.mocked(updateHeartbeat)
			.mockResolvedValueOnce(Result.ok("applied"))
			.mockResolvedValueOnce(Result.ok("superseded"));
		const heartbeat = startHeartbeat(job);

		await vi.advanceTimersByTimeAsync(1000);
		expect(heartbeat.leaseLost.aborted).toBe(false);

		await vi.advanceTimersByTimeAsync(1000);
		expect(heartbeat.leaseLost.aborted).toBe(true);

		await vi.advanceTimersByTimeAsync(5000);
		expect(updateHeartbeat).toHaveBeenCalledTimes(2);
		heartbeat.stop();
	});

	it("keeps the lease on a failed renewal", async () => {
		vi.useFakeTimers();
		vi.mocked(updateHeartbeat).mockResolvedValue(
			Result.err(new DatabaseError({ code: "ECONNRESET", message: "blip" })),
		);
		const heartbeat = startHeartbeat(job);

		await vi.advanceTimersByTimeAsync(3000);

		expect(heartbeat.leaseLost.aborted).toBe(false);
		heartbeat.stop();
	});
});
