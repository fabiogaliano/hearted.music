import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/shared/errors/database";
import { activeDeckRpc, deckPlaylistCardRpc } from "@/test/fixtures";

// ---------------------------------------------------------------------------
// Mocks — the entry's miss path orchestrates the hash, the RPC, the latest
// snapshot, the proposal builder and the deck-job queue. All are mocked so the
// test is DB-free; captureServerError is mocked to keep the best-effort
// branches off Sentry and let us assert the trace.
// ---------------------------------------------------------------------------

const mockResolveVisibilityConfigHash = vi.fn();
const mockCallStartOrResumeMatchDeck = vi.fn();
const mockGetLatestMatchSnapshot = vi.fn();
const mockBuildOneProposal = vi.fn();
const mockEnqueueDeckJob = vi.fn();
const mockFindInFlightBuildProposalsJob = vi.fn();
const mockCaptureServerError = vi.fn();

vi.mock("../visibility-config-hash", () => ({
	resolveVisibilityConfigHash: (...a: unknown[]) =>
		mockResolveVisibilityConfigHash(...a),
}));

vi.mock("../deck-read-queries", async (importOriginal) => ({
	...(await importOriginal()),
	callStartOrResumeMatchDeck: (...a: unknown[]) =>
		mockCallStartOrResumeMatchDeck(...a),
}));

vi.mock("@/lib/domains/taste/song-matching/queries", () => ({
	getLatestMatchSnapshot: (...a: unknown[]) => mockGetLatestMatchSnapshot(...a),
}));

vi.mock("../proposal-builder", () => ({
	buildOneProposal: (...a: unknown[]) => mockBuildOneProposal(...a),
}));

vi.mock("../deck-jobs", () => ({
	enqueueDeckJob: (...a: unknown[]) => mockEnqueueDeckJob(...a),
	findInFlightBuildProposalsJob: (...a: unknown[]) =>
		mockFindInFlightBuildProposalsJob(...a),
}));

vi.mock("@/lib/observability/capture-server-error", () => ({
	captureServerError: (...a: unknown[]) => mockCaptureServerError(...a),
}));

import { resolveMatchDeck } from "../deck-entry";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HASH = "vc_playlist_0.5_rtf";
const NOW_MS = 1_700_000_000_000;

const MISS_RPC = { status: "miss" as const, reason: "no_ready_proposal" };

/** Entry for a playlist deck whose first start_or_resume call misses. */
function enterMissedDeck() {
	return resolveMatchDeck("acct-1", "playlist", "entry");
}

beforeEach(() => {
	vi.clearAllMocks();
	// The entry reads Date.now() once; pin it so the hash and build assertions
	// can name the value instead of reading it back from a mock.
	vi.useFakeTimers({ now: NOW_MS, toFake: ["Date"] });
	mockResolveVisibilityConfigHash.mockResolvedValue(
		Result.ok({ hash: HASH, minScore: 0.5 }),
	);
	// The entry's own call misses; the miss path's re-invoke promotes.
	mockCallStartOrResumeMatchDeck
		.mockResolvedValueOnce(Result.ok(MISS_RPC))
		.mockResolvedValue(Result.ok(activeDeckRpc(deckPlaylistCardRpc(2, 2))));
	mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
	mockBuildOneProposal.mockResolvedValue(Result.ok(undefined));
	mockEnqueueDeckJob.mockResolvedValue(Result.ok(null));
	mockFindInFlightBuildProposalsJob.mockResolvedValue(Result.ok(null));
});

afterEach(() => {
	vi.useRealTimers();
});

describe("resolveMatchDeck miss path", () => {
	it("builds the current preset, re-invokes with the same hash and window, and returns the promoted view", async () => {
		const result = await enterMissedDeck();

		if (Result.isError(result)) throw new Error("expected ok");
		expect(result.value.entry).toBe("promoted");
		if (result.value.entry !== "promoted") throw new Error("expected a view");
		expect(result.value.view.sessionId).toBe("s1");

		// One nowMs is threaded into the hash and the build so the re-invoke's
		// branch-2 search key matches the built proposal's hash.
		expect(mockResolveVisibilityConfigHash.mock.calls[0][2]).toBe(NOW_MS);
		// buildOneProposal(accountId, orientation, snapshotId, preset, minScore, nowMs)
		expect(mockBuildOneProposal).toHaveBeenCalledWith(
			"acct-1",
			"playlist",
			"snap-1",
			"balanced",
			0.5,
			NOW_MS,
		);
		// Re-invoke uses the SAME hash + the playlist deck window.
		expect(mockCallStartOrResumeMatchDeck).toHaveBeenCalledTimes(2);
		expect(mockCallStartOrResumeMatchDeck).toHaveBeenNthCalledWith(
			2,
			"acct-1",
			"playlist",
			HASH,
			8,
		);
		// Best-effort full build so the next entry after a preset change is a hit.
		expect(mockEnqueueDeckJob).toHaveBeenCalledWith({
			accountId: "acct-1",
			orientation: "playlist",
			kind: "build_proposals",
			idempotencyKey: `build:acct-1:playlist:snap-1:${HASH}`,
			payload: { snapshotId: "snap-1" },
		});
	});

	it("still returns the promoted view when the best-effort enqueue fails (Result.err)", async () => {
		mockEnqueueDeckJob.mockResolvedValue(
			Result.err(new DatabaseError({ code: "x", message: "enqueue boom" })),
		);

		const result = await enterMissedDeck();

		// The enqueue failure is traced but never fails the request.
		if (Result.isError(result)) throw new Error("expected ok");
		expect(result.value.entry).toBe("promoted");
		expect(mockCaptureServerError).toHaveBeenCalledTimes(1);
	});

	it("surfaces the buildOneProposal error as a miss_build failure and does not promote", async () => {
		const buildError = new DatabaseError({ code: "y", message: "build boom" });
		mockBuildOneProposal.mockResolvedValue(Result.err(buildError));

		const result = await enterMissedDeck();

		if (!Result.isError(result)) throw new Error("expected err");
		expect(result.error.step).toBe("miss_build");
		expect(result.error.cause).toBe(buildError);
		// No re-invoke and no enqueue once the build fails.
		expect(mockCallStartOrResumeMatchDeck).toHaveBeenCalledTimes(1);
		expect(mockEnqueueDeckJob).not.toHaveBeenCalled();
	});

	it("returns building with promotion_incomplete when the re-invoke still misses", async () => {
		mockCallStartOrResumeMatchDeck.mockReset();
		mockCallStartOrResumeMatchDeck.mockResolvedValue(Result.ok(MISS_RPC));

		const result = await enterMissedDeck();

		expect(result).toHaveOkValue({
			entry: "promotion_incomplete",
			view: { status: "building" },
		});
		// The full build is still enqueued so a later entry becomes a hit.
		expect(mockEnqueueDeckJob).toHaveBeenCalledTimes(1);
	});

	it("surfaces a re-invoke RPC error as a miss_build failure without enqueuing", async () => {
		const rpcError = new DatabaseError({ code: "z", message: "rpc boom" });
		mockCallStartOrResumeMatchDeck.mockReset();
		mockCallStartOrResumeMatchDeck
			.mockResolvedValueOnce(Result.ok(MISS_RPC))
			.mockResolvedValueOnce(Result.err(rpcError));

		const result = await enterMissedDeck();

		if (!Result.isError(result)) throw new Error("expected err");
		expect(result.error.step).toBe("miss_build");
		expect(result.error.cause).toBe(rpcError);
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

		const result = await enterMissedDeck();

		expect(result).toHaveOkValue({
			entry: "promotion_incomplete",
			view: { status: "building" },
		});
		expect(mockFindInFlightBuildProposalsJob).toHaveBeenCalledWith(
			"acct-1",
			"playlist",
		);
		// No racing build, and no re-invoke (nothing changed to promote).
		expect(mockBuildOneProposal).not.toHaveBeenCalled();
		expect(mockCallStartOrResumeMatchDeck).toHaveBeenCalledTimes(1);
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

		const result = await enterMissedDeck();

		if (Result.isError(result)) throw new Error("expected ok");
		expect(result.value.entry).toBe("promoted");
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
	// step 0. findInFlightBuildProposalsJob is called twice on the happy path.
	// -------------------------------------------------------------------------

	it("defers to the worker when a build_proposals job appears AFTER step 0 but before the re-invoke (post-build re-check)", async () => {
		mockFindInFlightBuildProposalsJob
			.mockResolvedValueOnce(Result.ok(null))
			.mockResolvedValueOnce(Result.ok({ id: "job-2", status: "running" }));

		const result = await enterMissedDeck();

		expect(result).toHaveOkValue({
			entry: "promotion_incomplete",
			view: { status: "building" },
		});
		// The inline build already ran (step 0 was clear), but the worker claimed the
		// same key mid-build, so we defer instead of promoting our own re-invoke.
		expect(mockBuildOneProposal).toHaveBeenCalledTimes(1);
		expect(mockFindInFlightBuildProposalsJob).toHaveBeenCalledTimes(2);
		expect(mockCallStartOrResumeMatchDeck).toHaveBeenCalledTimes(1);
		// The best-effort full-build enqueue still runs (the deferred-to worker path).
		expect(mockEnqueueDeckJob).toHaveBeenCalledTimes(1);
	});

	it("fails open on a post-build lookup error: still re-invokes, returns the promoted view, and traces the post-build check", async () => {
		mockFindInFlightBuildProposalsJob
			.mockResolvedValueOnce(Result.ok(null))
			.mockResolvedValueOnce(
				Result.err(
					new DatabaseError({ code: "w", message: "post-build lookup boom" }),
				),
			);

		const result = await enterMissedDeck();

		if (Result.isError(result)) throw new Error("expected ok");
		// A post-build lookup failure must not block the request: fall through to the
		// re-invoke exactly like step 0's fail-open.
		expect(result.value.entry).toBe("promoted");
		expect(mockCallStartOrResumeMatchDeck).toHaveBeenCalledTimes(2);
		// Asserted via mock.calls (not toHaveBeenCalledWith): better-result errors
		// implement Symbol.iterator and panic under vitest deep-equal.
		expect(mockCaptureServerError).toHaveBeenCalledTimes(1);
		const [, contextArg] = mockCaptureServerError.mock.calls[0];
		expect(contextArg).toMatchObject({
			operation: "match_deck_miss_post_build_check",
		});
	});

	it("degrades a unique_violation from buildOneProposal to building instead of failing", async () => {
		const raceError = new DatabaseError({
			code: "23505",
			message: "duplicate key value violates unique constraint",
		});
		mockBuildOneProposal.mockResolvedValue(Result.err(raceError));

		const result = await enterMissedDeck();

		expect(result).toHaveOkValue({
			entry: "promotion_incomplete",
			view: { status: "building" },
		});
		// The loser never re-invokes (nothing new to promote) but still traces
		// the race and keeps the best-effort full-build enqueue.
		expect(mockCallStartOrResumeMatchDeck).toHaveBeenCalledTimes(1);
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

		const result = await enterMissedDeck();

		if (!Result.isError(result)) throw new Error("expected err");
		expect(result.error.cause).toBe(buildError);
		expect(mockEnqueueDeckJob).not.toHaveBeenCalled();
	});
});
