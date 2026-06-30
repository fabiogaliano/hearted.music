import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@/lib/platform/jobs/repository";
import type {
	MatchSnapshotRefreshOutcome,
	MatchSnapshotRefreshResult,
} from "@/lib/workflows/match-snapshot-refresh/types";
import { executeMatchSnapshotRefreshJob } from "../execute";

const { mockExecute, mockCaptureWorkerEvent } = vi.hoisted(() => ({
	mockExecute: vi.fn(),
	mockCaptureWorkerEvent: vi.fn(),
}));

vi.mock("@/lib/workflows/match-snapshot-refresh/orchestrator", () => ({
	executeMatchSnapshotRefresh: (...args: unknown[]) => mockExecute(...args),
}));

// Avoid pulling the enrichment orchestrator's heavy ML deps into this test.
vi.mock("@/lib/workflows/enrichment-pipeline/orchestrator", () => ({
	executeWorkerChunk: vi.fn(),
}));

vi.mock("@/lib/platform/jobs/repository", () => ({
	updateHeartbeat: vi.fn(),
}));

vi.mock("@/lib/observability/logger", () => ({
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../config", () => ({
	workerConfig: { heartbeatIntervalMs: 1000 },
}));

vi.mock("../posthog-capture", () => ({
	captureWorkerEvent: (...args: unknown[]) => mockCaptureWorkerEvent(...args),
}));

function makeJob(): Job {
	return {
		id: "job-1",
		account_id: "acct-1",
		progress: { plan: { needsTargetSongEnrichment: false } },
		satisfies_requested_at: null,
		// Only the four fields above are read by executeMatchSnapshotRefreshJob.
	} as unknown as Job;
}

function makeResult(
	overrides: Partial<MatchSnapshotRefreshResult> = {},
): MatchSnapshotRefreshResult {
	return {
		published: true,
		snapshotId: "snap-1",
		matchedSongCount: 42,
		candidateCount: 100,
		playlistCount: 3,
		isEmpty: false,
		noOp: false,
		...overrides,
	};
}

describe("executeMatchSnapshotRefreshJob", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("emits match_snapshot_published with the result counts", async () => {
		mockExecute.mockResolvedValue({
			status: "published",
			result: makeResult(),
		} satisfies MatchSnapshotRefreshOutcome);

		await executeMatchSnapshotRefreshJob(makeJob(), "acct-1");

		expect(mockCaptureWorkerEvent).toHaveBeenCalledWith({
			distinctId: "acct-1",
			event: "match_snapshot_published",
			properties: {
				published: true,
				is_empty: false,
				no_op: false,
				matched_song_count: 42,
				candidate_count: 100,
				playlist_count: 3,
			},
		});
	});

	it("does not emit when the job was superseded", async () => {
		mockExecute.mockResolvedValue({
			status: "superseded",
		} satisfies MatchSnapshotRefreshOutcome);

		const result = await executeMatchSnapshotRefreshJob(makeJob(), "acct-1");

		expect(result.status).toBe("superseded");
		expect(mockCaptureWorkerEvent).not.toHaveBeenCalled();
	});
});
