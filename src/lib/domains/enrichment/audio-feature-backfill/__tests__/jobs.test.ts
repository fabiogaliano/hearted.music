import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({ rpc }),
}));

import { heartbeatBackfillJob } from "../jobs";

beforeEach(() => vi.clearAllMocks());

describe("heartbeatBackfillJob", () => {
	it("extends the lease through the database-fenced heartbeat RPC", async () => {
		rpc.mockResolvedValue({ data: true, error: null });

		const result = await heartbeatBackfillJob("job-1", "worker-1", 900);

		expect(Result.isOk(result)).toBe(true);
		expect(rpc).toHaveBeenCalledWith("heartbeat_audio_feature_backfill_job", {
			p_job_id: "job-1",
			p_worker_id: "worker-1",
			p_lease_seconds: 900,
		});
	});

	it("reports a lost lease when the fenced row no longer matches", async () => {
		rpc.mockResolvedValue({ data: false, error: null });

		const result = await heartbeatBackfillJob("job-1", "worker-1", 900);

		expect(Result.isError(result)).toBe(true);
		if (Result.isOk(result)) throw new Error("expected heartbeat failure");
		expect(result.error).toMatchObject({ code: "backfill_lease_lost" });
	});
});
