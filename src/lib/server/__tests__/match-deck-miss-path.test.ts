import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StartOrResumeMatchDeckRpcResult } from "@/lib/domains/taste/match-review-queue/deck-read-queries";
import { DatabaseError } from "@/lib/shared/errors/database";

// ---------------------------------------------------------------------------
// Mocks — buildFirstWindowAndPromote orchestrates three DB-bound collaborators.
// All are mocked so the test is DB-free; captureServerError is mocked to keep the
// best-effort enqueue-failure branch off Sentry and let us assert the trace.
// ---------------------------------------------------------------------------

const mockBuildOneProposal = vi.fn();
const mockCallStartOrResumeMatchDeck = vi.fn();
const mockEnqueueDeckJob = vi.fn();
const mockCaptureServerError = vi.fn();

vi.mock("@/lib/domains/taste/match-review-queue/proposal-builder", () => ({
	buildOneProposal: (...a: unknown[]) => mockBuildOneProposal(...a),
}));

vi.mock("@/lib/domains/taste/match-review-queue/deck-read-queries", () => ({
	callStartOrResumeMatchDeck: (...a: unknown[]) =>
		mockCallStartOrResumeMatchDeck(...a),
}));

vi.mock("@/lib/domains/taste/match-review-queue/deck-jobs", () => ({
	enqueueDeckJob: (...a: unknown[]) => mockEnqueueDeckJob(...a),
}));

vi.mock("@/lib/observability/capture-server-error", () => ({
	captureServerError: (...a: unknown[]) => mockCaptureServerError(...a),
}));

import { buildFirstWindowAndPromote } from "../match-deck-miss-path";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INPUT = {
	accountId: "acct-1",
	orientation: "playlist" as const,
	snapshotId: "snap-1",
	preset: "balanced",
	minScore: 0.5,
	visibilityConfigHash: "vc_playlist_0.5_rtf",
	nowMs: 1_700_000_000_000,
	window: 8,
};

function activeRpc(): StartOrResumeMatchDeckRpcResult {
	return {
		status: "active",
		version: 1,
		accountId: "acct-1",
		orientation: "playlist",
		sessionId: "s1",
		snapshotId: "snap-1",
		visibilityConfigHash: "vc_playlist_0.5_rtf",
		revision: 1,
		progress: {
			total: 3,
			remaining: 3,
			caughtUp: false,
			hiddenReviewItemCount: 0,
		},
		itemIds: ["item-1"],
		cards: { current: null, next: null },
	};
}

const MISS_RPC: StartOrResumeMatchDeckRpcResult = {
	status: "miss",
	reason: "no_ready_proposal",
};

beforeEach(() => {
	vi.clearAllMocks();
	mockBuildOneProposal.mockResolvedValue(Result.ok(undefined));
	mockCallStartOrResumeMatchDeck.mockResolvedValue(Result.ok(activeRpc()));
	mockEnqueueDeckJob.mockResolvedValue(Result.ok(null));
});

describe("buildFirstWindowAndPromote", () => {
	it("builds the current preset, re-invokes, and returns the promoted active result", async () => {
		const active = activeRpc();
		mockCallStartOrResumeMatchDeck.mockResolvedValue(Result.ok(active));

		const result = await buildFirstWindowAndPromote(INPUT);

		if (Result.isError(result)) throw new Error("expected ok");
		expect(result.value).toBe(active);

		// buildOneProposal(accountId, orientation, snapshotId, preset, minScore, nowMs)
		expect(mockBuildOneProposal).toHaveBeenCalledWith(
			"acct-1",
			"playlist",
			"snap-1",
			"balanced",
			0.5,
			1_700_000_000_000,
		);
		// Re-invoke uses the SAME hash + window the caller threaded in.
		expect(mockCallStartOrResumeMatchDeck).toHaveBeenCalledWith(
			"acct-1",
			"playlist",
			"vc_playlist_0.5_rtf",
			8,
		);
		// Best-effort full build so the next entry after a preset change is a hit.
		expect(mockEnqueueDeckJob).toHaveBeenCalledWith({
			accountId: "acct-1",
			orientation: "playlist",
			kind: "build_proposals",
			idempotencyKey: "build:acct-1:playlist:snap-1:vc_playlist_0.5_rtf",
			payload: { snapshotId: "snap-1" },
		});
	});

	it("still returns the active result when the best-effort enqueue fails (Result.err)", async () => {
		const active = activeRpc();
		mockCallStartOrResumeMatchDeck.mockResolvedValue(Result.ok(active));
		mockEnqueueDeckJob.mockResolvedValue(
			Result.err(new DatabaseError({ code: "x", message: "enqueue boom" })),
		);

		const result = await buildFirstWindowAndPromote(INPUT);

		// The enqueue failure is traced but never fails the request.
		if (Result.isError(result)) throw new Error("expected ok");
		expect(result.value).toBe(active);
		expect(mockCaptureServerError).toHaveBeenCalledTimes(1);
	});

	it("surfaces the buildOneProposal error and does not promote", async () => {
		const buildError = new DatabaseError({ code: "y", message: "build boom" });
		mockBuildOneProposal.mockResolvedValue(Result.err(buildError));

		const result = await buildFirstWindowAndPromote(INPUT);

		if (!Result.isError(result)) throw new Error("expected err");
		expect(result.error).toBe(buildError);
		// No re-invoke and no enqueue once the build fails.
		expect(mockCallStartOrResumeMatchDeck).not.toHaveBeenCalled();
		expect(mockEnqueueDeckJob).not.toHaveBeenCalled();
	});

	it("returns the miss unchanged when the re-invoke still misses (caller maps to building)", async () => {
		mockCallStartOrResumeMatchDeck.mockResolvedValue(Result.ok(MISS_RPC));

		const result = await buildFirstWindowAndPromote(INPUT);

		if (Result.isError(result)) throw new Error("expected ok");
		expect(result.value.status).toBe("miss");
		// The full build is still enqueued so a later entry becomes a hit.
		expect(mockEnqueueDeckJob).toHaveBeenCalledTimes(1);
	});

	it("surfaces a re-invoke RPC error without enqueuing", async () => {
		const rpcError = new DatabaseError({ code: "z", message: "rpc boom" });
		mockCallStartOrResumeMatchDeck.mockResolvedValue(Result.err(rpcError));

		const result = await buildFirstWindowAndPromote(INPUT);

		if (!Result.isError(result)) throw new Error("expected err");
		expect(result.error).toBe(rpcError);
		expect(mockEnqueueDeckJob).not.toHaveBeenCalled();
	});
});
