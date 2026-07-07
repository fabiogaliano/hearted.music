import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@/lib/platform/jobs/repository";
import type {
	MatchSnapshotRefreshOutcome,
	MatchSnapshotRefreshResult,
} from "@/lib/workflows/match-snapshot-refresh/types";
import { executeMatchSnapshotRefreshJob } from "../execute";

const {
	mockExecute,
	mockCaptureWorkerEvent,
	mockSentryCapture,
	mockEnqueueDeckJob,
	mockResolveVisibilityConfigHash,
} = vi.hoisted(() => ({
	mockExecute: vi.fn(),
	mockCaptureWorkerEvent: vi.fn(),
	mockSentryCapture: vi.fn(),
	mockEnqueueDeckJob: vi.fn(),
	mockResolveVisibilityConfigHash: vi.fn(),
}));

vi.mock("@sentry/bun", () => ({
	captureException: (...args: unknown[]) => mockSentryCapture(...args),
}));

vi.mock("@/lib/domains/taste/match-review-queue/deck-jobs", () => ({
	enqueueDeckJob: (...args: unknown[]) => mockEnqueueDeckJob(...args),
}));

vi.mock(
	"@/lib/domains/taste/match-review-queue/visibility-config-hash",
	() => ({
		resolveVisibilityConfigHash: (...args: unknown[]) =>
			mockResolveVisibilityConfigHash(...args),
	}),
);

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
		// clearAllMocks resets calls but not implementations; drop the per-test
		// throw impl so it can't leak into a later test's Sentry-count assertion.
		mockCaptureWorkerEvent.mockReset();
		// R2 chain: the post-publish build_proposals enqueue is best-effort; default
		// it to success so unrelated assertions aren't perturbed by deck side effects.
		mockEnqueueDeckJob.mockResolvedValue(Result.ok(null));
		mockResolveVisibilityConfigHash.mockImplementation(
			(_accountId: string, orientation: string) =>
				Promise.resolve(
					Result.ok({
						hash: `vc_test_${orientation}`,
						minScore: 0.5,
						policy: {},
					}),
				),
		);
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
				snapshot_id: "snap-1",
			},
		});
	});

	it("swallows a captureWorkerEvent failure and still returns published", async () => {
		mockExecute.mockResolvedValue({
			status: "published",
			result: makeResult(),
		} satisfies MatchSnapshotRefreshOutcome);
		const captureError = new Error("posthog host misconfigured");
		mockCaptureWorkerEvent.mockImplementation(() => {
			throw captureError;
		});

		const result = await executeMatchSnapshotRefreshJob(makeJob(), "acct-1");

		// The snapshot is already published — analytics failure must not change the
		// job outcome.
		expect(result.status).toBe("published");
		expect(mockSentryCapture).toHaveBeenCalledTimes(1);
		const [capturedError, captureContext] =
			mockSentryCapture.mock.calls[0] ?? [];
		expect(capturedError).toBe(captureError);
		expect(captureContext).toMatchObject({
			tags: {
				area: "analytics",
				operation: "capture_match_snapshot_published",
				runtime: "worker",
			},
			extra: { accountId: "acct-1", jobId: "job-1" },
		});
	});

	it("does not emit when the job was superseded", async () => {
		mockExecute.mockResolvedValue({
			status: "superseded",
		} satisfies MatchSnapshotRefreshOutcome);

		const result = await executeMatchSnapshotRefreshJob(makeJob(), "acct-1");

		expect(result.status).toBe("superseded");
		expect(mockCaptureWorkerEvent).not.toHaveBeenCalled();
		expect(mockEnqueueDeckJob).not.toHaveBeenCalled();
	});

	it("enqueues build_proposals for both orientations after a publish (R2)", async () => {
		mockExecute.mockResolvedValue({
			status: "published",
			result: makeResult(),
		} satisfies MatchSnapshotRefreshOutcome);

		await executeMatchSnapshotRefreshJob(makeJob(), "acct-1");

		expect(mockEnqueueDeckJob).toHaveBeenCalledTimes(2);
		expect(mockEnqueueDeckJob).toHaveBeenCalledWith(
			expect.objectContaining({
				accountId: "acct-1",
				orientation: "song",
				kind: "build_proposals",
				idempotencyKey: "build:acct-1:song:snap-1:vc_test_song",
			}),
		);
		expect(mockEnqueueDeckJob).toHaveBeenCalledWith(
			expect.objectContaining({
				accountId: "acct-1",
				orientation: "playlist",
				kind: "build_proposals",
				idempotencyKey: "build:acct-1:playlist:snap-1:vc_test_playlist",
			}),
		);
	});

	it("swallows an enqueue failure (best-effort) and still returns published", async () => {
		mockExecute.mockResolvedValue({
			status: "published",
			result: makeResult(),
		} satisfies MatchSnapshotRefreshOutcome);
		mockEnqueueDeckJob.mockResolvedValue(
			Result.err(new Error("deck enqueue failed")),
		);

		const result = await executeMatchSnapshotRefreshJob(makeJob(), "acct-1");

		expect(result.status).toBe("published");
		// One Sentry capture per orientation whose enqueue failed — never a throw.
		expect(mockSentryCapture).toHaveBeenCalledTimes(2);
	});

	it("skips the enqueue for an orientation whose hash resolution fails, still enqueues the other, and still returns published (M1/P3.4)", async () => {
		mockExecute.mockResolvedValue({
			status: "published",
			result: makeResult(),
		} satisfies MatchSnapshotRefreshOutcome);
		const hashError = new Error("hash resolution failed");
		mockResolveVisibilityConfigHash.mockImplementation(
			(_accountId: string, orientation: string) => {
				if (orientation === "song") {
					return Promise.resolve(Result.err(hashError));
				}
				return Promise.resolve(
					Result.ok({
						hash: `vc_test_${orientation}`,
						minScore: 0.5,
						policy: {},
					}),
				);
			},
		);

		const result = await executeMatchSnapshotRefreshJob(makeJob(), "acct-1");

		// The failed orientation must never enqueue a hash-less (pre-M1) key —
		// it is skipped entirely, not degraded to the old dedupe-prone key.
		expect(mockEnqueueDeckJob).not.toHaveBeenCalledWith(
			expect.objectContaining({ orientation: "song" }),
		);
		expect(mockEnqueueDeckJob).toHaveBeenCalledTimes(1);
		expect(mockEnqueueDeckJob).toHaveBeenCalledWith(
			expect.objectContaining({
				accountId: "acct-1",
				orientation: "playlist",
				kind: "build_proposals",
				idempotencyKey: "build:acct-1:playlist:snap-1:vc_test_playlist",
			}),
		);
		// The hash-resolution failure is captured...
		expect(mockSentryCapture).toHaveBeenCalledWith(
			hashError,
			expect.objectContaining({
				tags: {
					area: "match_deck",
					operation: "resolve_visibility_config_hash",
					runtime: "worker",
				},
			}),
		);
		// ...but the overall job still succeeds — a skipped best-effort enqueue
		// must never fail an already-completed match snapshot refresh.
		expect(result.status).toBe("published");
	});

	it("does not enqueue deck jobs when nothing published (no-op refresh)", async () => {
		mockExecute.mockResolvedValue({
			status: "published",
			result: makeResult({ published: false, snapshotId: null, noOp: true }),
		} satisfies MatchSnapshotRefreshOutcome);

		await executeMatchSnapshotRefreshJob(makeJob(), "acct-1");

		expect(mockEnqueueDeckJob).not.toHaveBeenCalled();
	});
});
