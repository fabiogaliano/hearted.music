import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/bun", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/domains/enrichment/audio-feature-backfill/jobs");
vi.mock("@/lib/domains/enrichment/audio-feature-backfill/service");
vi.mock("@/lib/domains/enrichment/audio-feature-backfill/wake");

import { sweepStaleBackfillJobs } from "@/lib/domains/enrichment/audio-feature-backfill/jobs";
import type { BackfillJob } from "@/lib/domains/enrichment/audio-feature-backfill/types";
import { wakeEnrichmentForSong } from "@/lib/domains/enrichment/audio-feature-backfill/wake";
import { runAudioFeatureBackfillSweepTick } from "../poll-audio-feature-backfill";

function sweptJob(overrides: Partial<BackfillJob>): BackfillJob {
	return {
		id: "j",
		song_id: "s",
		status: "pending",
		...overrides,
	} as BackfillJob;
}

beforeEach(() => vi.clearAllMocks());

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
