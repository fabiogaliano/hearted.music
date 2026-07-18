import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/bun", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/domains/enrichment/audio-feature-backfill/jobs");
vi.mock("@/lib/domains/enrichment/audio-feature-backfill/service");
vi.mock("@/lib/domains/enrichment/audio-feature-backfill/wake");

import {
	heartbeatBackfillJob,
	sweepStaleBackfillJobs,
} from "@/lib/domains/enrichment/audio-feature-backfill/jobs";
import { processBackfillJob } from "@/lib/domains/enrichment/audio-feature-backfill/service";
import type { BackfillJob } from "@/lib/domains/enrichment/audio-feature-backfill/types";
import { wakeEnrichmentForSong } from "@/lib/domains/enrichment/audio-feature-backfill/wake";
import { DatabaseError } from "@/lib/shared/errors/database";
import {
	runAudioFeatureBackfillSweepTick,
	runClaimedAudioFeatureBackfillJob,
} from "../poll-audio-feature-backfill";

function sweptJob(overrides: Partial<BackfillJob>): BackfillJob {
	return {
		id: "j",
		song_id: "s",
		status: "pending",
		...overrides,
	} as BackfillJob;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe("runClaimedAudioFeatureBackfillJob", () => {
	it("aborts external processing after a definitive lease loss", async () => {
		vi.useFakeTimers();
		vi.mocked(processBackfillJob).mockImplementation(
			async (_job, _workerId, options) =>
				new Promise((resolve) => {
					options?.signal?.addEventListener("abort", () => resolve("skipped"), {
						once: true,
					});
				}),
		);
		vi.mocked(heartbeatBackfillJob).mockResolvedValue(
			Result.err(
				new DatabaseError({
					code: "backfill_lease_lost",
					message: "lease lost",
				}),
			),
		);

		const run = runClaimedAudioFeatureBackfillJob(
			sweptJob({ status: "running" }),
		);
		await vi.advanceTimersByTimeAsync(30_000);
		await run;

		const processOptions = vi.mocked(processBackfillJob).mock.calls[0]?.[2];
		expect(processOptions?.signal?.aborted).toBe(true);
	});
});

describe("runAudioFeatureBackfillSweepTick", () => {
	it("wakes enrichment only for swept rows that terminalized to failed", async () => {
		vi.mocked(sweepStaleBackfillJobs).mockResolvedValue(
			Result.ok([
				sweptJob({ id: "j1", song_id: "song-failed", status: "failed" }),
				sweptJob({ id: "j2", song_id: "song-pending", status: "pending" }),
			]),
		);

		await runAudioFeatureBackfillSweepTick();

		expect(wakeEnrichmentForSong).toHaveBeenCalledTimes(1);
		expect(wakeEnrichmentForSong).toHaveBeenCalledWith("song-failed");
	});

	it("does not wake when nothing was swept", async () => {
		vi.mocked(sweepStaleBackfillJobs).mockResolvedValue(Result.ok([]));

		await runAudioFeatureBackfillSweepTick();

		expect(wakeEnrichmentForSong).not.toHaveBeenCalled();
	});
});
