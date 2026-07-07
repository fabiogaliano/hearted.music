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
const mockFindInFlightBuildProposalsJob = vi.fn();
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
	findInFlightBuildProposalsJob: (...a: unknown[]) =>
		mockFindInFlightBuildProposalsJob(...a),
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
	mockFindInFlightBuildProposalsJob.mockResolvedValue(Result.ok(null));
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

	// -------------------------------------------------------------------------
	// P0 race fix (verification pass 2): the miss handler must never run
	// buildOneProposal concurrently with a worker already building the same
	// (account, orientation) key, and must never surface a 500 for losing a
	// residual race — both degrade to the RPC's own miss shape.
	// -------------------------------------------------------------------------

	it("defers to the worker and skips the inline build when a build_proposals job is already in flight", async () => {
		mockFindInFlightBuildProposalsJob.mockResolvedValue(
			Result.ok({ id: "job-1", status: "pending" }),
		);

		const result = await buildFirstWindowAndPromote(INPUT);

		if (Result.isError(result)) throw new Error("expected ok");
		expect(result.value).toEqual({
			status: "miss",
			reason: "no_ready_proposal",
		});
		expect(mockFindInFlightBuildProposalsJob).toHaveBeenCalledWith(
			"acct-1",
			"playlist",
		);
		// No racing build, and no re-invoke (nothing changed to promote).
		expect(mockBuildOneProposal).not.toHaveBeenCalled();
		expect(mockCallStartOrResumeMatchDeck).not.toHaveBeenCalled();
		// The best-effort full-build enqueue still runs.
		expect(mockEnqueueDeckJob).toHaveBeenCalledTimes(1);
	});

	it("builds inline when the in-flight lookup itself fails (fails open) and traces the lookup error", async () => {
		const lookupError = new DatabaseError({
			code: "w",
			message: "lookup boom",
		});
		// Only the step-0 lookup errors; the post-build re-check returns null so it
		// doesn't fire its own capture and this test stays scoped to step 0.
		mockFindInFlightBuildProposalsJob
			.mockResolvedValueOnce(Result.err(lookupError))
			.mockResolvedValueOnce(Result.ok(null));

		const active = activeRpc();
		mockCallStartOrResumeMatchDeck.mockResolvedValue(Result.ok(active));

		const result = await buildFirstWindowAndPromote(INPUT);

		if (Result.isError(result)) throw new Error("expected ok");
		expect(result.value).toBe(active);
		expect(mockBuildOneProposal).toHaveBeenCalledTimes(1);
		// Asserted via mock.calls (not toHaveBeenCalledWith): better-result's
		// TaggedError/Err implement Symbol.iterator for Result.gen, which panics
		// if vitest's deep-equal driving that iterator to completion when the
		// error instance is passed straight into a matcher.
		expect(mockCaptureServerError).toHaveBeenCalledTimes(1);
		const [erroredArg, contextArg] = mockCaptureServerError.mock.calls[0];
		expect(erroredArg).toBe(lookupError);
		expect(contextArg).toMatchObject({
			operation: "match_deck_miss_in_flight_check",
		});
	});

	// -------------------------------------------------------------------------
	// Post-build re-check (fix pass 3, should-fix 1): a worker can claim the SAME
	// build_proposals key AFTER the step-0 check but DURING the inline build. If it
	// did, the handler must NOT promote its own re-invoke over a possibly-truncated
	// subject set — it defers to the worker instead. The check fails open like
	// step 0. findInFlightBuildProposalsJob is now called twice on the happy path.
	// -------------------------------------------------------------------------

	it("defers to the worker when a build_proposals job appears AFTER step 0 but before the re-invoke (post-build re-check)", async () => {
		mockFindInFlightBuildProposalsJob
			.mockResolvedValueOnce(Result.ok(null))
			.mockResolvedValueOnce(Result.ok({ id: "job-2", status: "running" }));

		const result = await buildFirstWindowAndPromote(INPUT);

		if (Result.isError(result)) throw new Error("expected ok");
		expect(result.value).toEqual({
			status: "miss",
			reason: "no_ready_proposal",
		});
		// The inline build already ran (step 0 was clear), but the worker claimed the
		// same key mid-build, so we defer instead of promoting our own re-invoke.
		expect(mockBuildOneProposal).toHaveBeenCalledTimes(1);
		expect(mockFindInFlightBuildProposalsJob).toHaveBeenCalledTimes(2);
		expect(mockCallStartOrResumeMatchDeck).not.toHaveBeenCalled();
		// The best-effort full-build enqueue still runs (the deferred-to worker path).
		expect(mockEnqueueDeckJob).toHaveBeenCalledTimes(1);
	});

	it("fails open on a post-build lookup error: still re-invokes, returns the active result, and traces the post-build check", async () => {
		mockFindInFlightBuildProposalsJob
			.mockResolvedValueOnce(Result.ok(null))
			.mockResolvedValueOnce(
				Result.err(
					new DatabaseError({ code: "w", message: "post-build lookup boom" }),
				),
			);

		const active = activeRpc();
		mockCallStartOrResumeMatchDeck.mockResolvedValue(Result.ok(active));

		const result = await buildFirstWindowAndPromote(INPUT);

		if (Result.isError(result)) throw new Error("expected ok");
		// A post-build lookup failure must not block the request: fall through to the
		// re-invoke exactly like step 0's fail-open.
		expect(result.value).toBe(active);
		expect(mockCallStartOrResumeMatchDeck).toHaveBeenCalledTimes(1);
		// Asserted via mock.calls (not toHaveBeenCalledWith): better-result errors
		// implement Symbol.iterator and panic under vitest deep-equal.
		expect(mockCaptureServerError).toHaveBeenCalledTimes(1);
		const [, contextArg] = mockCaptureServerError.mock.calls[0];
		expect(contextArg).toMatchObject({
			operation: "match_deck_miss_post_build_check",
		});
	});

	it("degrades a unique_violation from buildOneProposal to the miss result instead of throwing", async () => {
		const raceError = new DatabaseError({
			code: "23505",
			message: "duplicate key value violates unique constraint",
		});
		mockBuildOneProposal.mockResolvedValue(Result.err(raceError));

		const result = await buildFirstWindowAndPromote(INPUT);

		if (Result.isError(result)) throw new Error("expected ok");
		expect(result.value).toEqual({
			status: "miss",
			reason: "no_ready_proposal",
		});
		// The loser never re-invokes (nothing new to promote) but still traces
		// the race and keeps the best-effort full-build enqueue.
		expect(mockCallStartOrResumeMatchDeck).not.toHaveBeenCalled();
		expect(mockEnqueueDeckJob).toHaveBeenCalledTimes(1);
		expect(mockCaptureServerError).toHaveBeenCalledTimes(1);
		const [erroredArg, contextArg] = mockCaptureServerError.mock.calls[0];
		expect(erroredArg).toBe(raceError);
		expect(contextArg).toMatchObject({
			operation: "match_deck_miss_build_race",
		});
	});

	it("still propagates a non-unique_violation build error (root cause, not a race loss)", async () => {
		const buildError = new DatabaseError({ code: "other", message: "boom" });
		mockBuildOneProposal.mockResolvedValue(Result.err(buildError));

		const result = await buildFirstWindowAndPromote(INPUT);

		if (!Result.isError(result)) throw new Error("expected err");
		expect(result.error).toBe(buildError);
		expect(mockEnqueueDeckJob).not.toHaveBeenCalled();
	});
});
