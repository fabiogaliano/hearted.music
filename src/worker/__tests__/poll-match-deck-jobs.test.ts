import * as Sentry from "@sentry/bun";
import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	captureAheadForSession,
	readSessionResumePosition,
} from "@/lib/domains/taste/match-review-queue/card-materializer";
import type { ClaimedDeckJob } from "@/lib/domains/taste/match-review-queue/deck-jobs";
import {
	completeDeckJob,
	deferDeckJob,
	enqueueDeckJob,
	heartbeatDeckJob,
} from "@/lib/domains/taste/match-review-queue/deck-jobs";
import { buildProposalsForAccountOrientation } from "@/lib/domains/taste/match-review-queue/proposal-builder";
import { appendSessionsForAccountOrientation } from "@/lib/domains/taste/match-review-queue/session-appender";
import { log } from "@/lib/observability/logger";
import { DatabaseError } from "@/lib/shared/errors/database";
import { workerConfig } from "../config";
import { runClaimedDeckJob } from "../poll-match-deck-jobs";

vi.mock("@sentry/bun", () => ({
	captureException: vi.fn(),
	captureMessage: vi.fn(),
}));
vi.mock("@/lib/domains/taste/match-review-queue/deck-jobs", () => ({
	claimDeckJob: vi.fn(),
	completeDeckJob: vi.fn(),
	deferDeckJob: vi.fn(),
	enqueueDeckJob: vi.fn(),
	heartbeatDeckJob: vi.fn(),
}));
vi.mock("@/lib/domains/taste/match-review-queue/card-materializer", () => ({
	CAPTURE_AHEAD_WINDOW: 3,
	captureAheadForSession: vi.fn(),
	readSessionResumePosition: vi.fn(),
}));
vi.mock("@/lib/domains/taste/match-review-queue/proposal-builder", () => ({
	buildProposalsForAccountOrientation: vi.fn(),
}));
vi.mock("@/lib/domains/taste/match-review-queue/session-appender", () => ({
	appendSessionsForAccountOrientation: vi.fn(),
}));
vi.mock("@/lib/domains/taste/song-matching/queries", () => ({
	getLatestMatchSnapshot: vi.fn(),
}));
vi.mock("@/lib/observability/logger", () => ({
	log: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));
vi.mock("../posthog-capture", () => ({
	captureWorkerEvent: vi.fn(),
}));

function job(overrides: Partial<ClaimedDeckJob> = {}): ClaimedDeckJob {
	return {
		id: overrides.id ?? "job-1",
		account_id: overrides.account_id ?? "acct-1",
		orientation: overrides.orientation ?? "song",
		session_id: overrides.session_id ?? null,
		kind: overrides.kind ?? "build_proposals",
		idempotency_key: overrides.idempotency_key ?? "idem-1",
		status: overrides.status ?? "pending",
		attempts: overrides.attempts ?? 0,
		max_attempts: overrides.max_attempts ?? 3,
		available_at: overrides.available_at ?? "2026-07-07T00:00:00Z",
		heartbeat_at: overrides.heartbeat_at ?? null,
		locked_by: overrides.locked_by ?? "claim-token-1",
		payload: overrides.payload ?? {},
		created_at: overrides.created_at ?? "2026-07-07T00:00:00Z",
		updated_at: overrides.updated_at ?? "2026-07-07T00:00:00Z",
	};
}

// ---------------------------------------------------------------------------
// runClaimedDeckJob — dispatch → settle, driven without the live poll loop.
// Per-kind dispatch outcomes are asserted as the settlement they produce; the
// settlement SQL itself is owned by deck-job-lifecycle.integration.test.ts.
// ---------------------------------------------------------------------------

describe("runClaimedDeckJob", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(completeDeckJob).mockResolvedValue(Result.ok(true));
		vi.mocked(deferDeckJob).mockResolvedValue(Result.ok(true));
	});

	function expectCompleted(jobId: string) {
		expect(completeDeckJob).toHaveBeenCalledWith(jobId, "claim-token-1");
		expect(deferDeckJob).not.toHaveBeenCalled();
	}

	function expectDeferred(jobId: string) {
		expect(deferDeckJob).toHaveBeenCalledWith(jobId, "claim-token-1", 30);
		expect(completeDeckJob).not.toHaveBeenCalled();
	}

	it("build_proposals: builds, chains append_sessions, and completes", async () => {
		vi.mocked(buildProposalsForAccountOrientation).mockResolvedValue(
			Result.ok(undefined),
		);
		vi.mocked(enqueueDeckJob).mockResolvedValue(Result.ok(null));

		await runClaimedDeckJob(
			job({
				id: "job-build",
				kind: "build_proposals",
				payload: { snapshotId: "snap-1" },
			}),
		);

		expectCompleted("job-build");
		expect(enqueueDeckJob).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "append_sessions" }),
		);
		expect(Sentry.captureException).not.toHaveBeenCalled();
	});

	it("append_sessions: a handler error defers and is captured (P1.2 symmetry)", async () => {
		vi.mocked(appendSessionsForAccountOrientation).mockResolvedValue(
			Result.err(new DatabaseError({ code: "boom", message: "db exploded" })),
		);

		await runClaimedDeckJob(
			job({
				id: "job-append-fail",
				kind: "append_sessions",
				payload: { snapshotId: "snap-1" },
			}),
		);

		expectDeferred("job-append-fail");
		expect(Sentry.captureException).toHaveBeenCalledWith(
			expect.any(DatabaseError),
			expect.objectContaining({
				tags: expect.objectContaining({
					area: "match_deck",
					operation: "append_sessions",
					runtime: "worker",
				}),
			}),
		);
	});

	it("append_sessions: superseded completes with NO defer and NO Sentry capture", async () => {
		vi.mocked(appendSessionsForAccountOrientation).mockResolvedValue(
			Result.ok({ kind: "superseded" }),
		);

		await runClaimedDeckJob(
			job({
				id: "job-superseded",
				kind: "append_sessions",
				payload: { snapshotId: "snap-1" },
			}),
		);

		expectCompleted("job-superseded");
		expect(Sentry.captureException).not.toHaveBeenCalled();
	});

	it("M5: applied append with appendedCount > 0 chains capture_ahead with the exact idempotency key", async () => {
		vi.mocked(appendSessionsForAccountOrientation).mockResolvedValue(
			Result.ok({ kind: "applied", appendedCount: 3, sessionId: "sess-1" }),
		);
		vi.mocked(readSessionResumePosition).mockResolvedValue(Result.ok(7));
		vi.mocked(enqueueDeckJob).mockResolvedValue(Result.ok(null));

		await runClaimedDeckJob(
			job({
				id: "job-m5",
				kind: "append_sessions",
				orientation: "playlist",
				account_id: "acct-9",
				payload: { snapshotId: "snap-1" },
			}),
		);

		expectCompleted("job-m5");
		expect(enqueueDeckJob).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "capture_ahead",
				sessionId: "sess-1",
				idempotencyKey: "capture:acct-9:playlist:sess-1:7",
			}),
		);
	});

	it("M5: applied append with a null resumePosition chains capture_ahead keyed with 'none'", async () => {
		vi.mocked(appendSessionsForAccountOrientation).mockResolvedValue(
			Result.ok({ kind: "applied", appendedCount: 1, sessionId: "sess-2" }),
		);
		vi.mocked(readSessionResumePosition).mockResolvedValue(Result.ok(null));
		vi.mocked(enqueueDeckJob).mockResolvedValue(Result.ok(null));

		await runClaimedDeckJob(
			job({
				id: "job-m5-none",
				kind: "append_sessions",
				orientation: "song",
				account_id: "acct-9",
				payload: { snapshotId: "snap-1" },
			}),
		);

		expectCompleted("job-m5-none");
		expect(enqueueDeckJob).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "capture_ahead",
				sessionId: "sess-2",
				idempotencyKey: "capture:acct-9:song:sess-2:none",
			}),
		);
	});

	it("append_sessions applying zero cards completes without chaining capture_ahead", async () => {
		vi.mocked(appendSessionsForAccountOrientation).mockResolvedValue(
			Result.ok({ kind: "applied", appendedCount: 0, sessionId: "sess-3" }),
		);

		await runClaimedDeckJob(
			job({
				id: "job-zero",
				kind: "append_sessions",
				orientation: "song",
				account_id: "acct-9",
				payload: { snapshotId: "snap-1" },
			}),
		);

		expectCompleted("job-zero");
		expect(enqueueDeckJob).not.toHaveBeenCalled();
	});

	it("capture_ahead: captures the window from the session's resume position and completes", async () => {
		vi.mocked(readSessionResumePosition).mockResolvedValue(Result.ok(4));
		vi.mocked(captureAheadForSession).mockResolvedValue(Result.ok(undefined));

		await runClaimedDeckJob(
			job({ id: "job-happy", kind: "capture_ahead", session_id: "sess-3" }),
		);

		expectCompleted("job-happy");
		expect(captureAheadForSession).toHaveBeenCalledWith(
			expect.objectContaining({ sessionId: "sess-3", fromPosition: 4 }),
		);
		expect(Sentry.captureException).not.toHaveBeenCalled();
	});

	it("capture_ahead: a handler error defers and is captured (P1.2 symmetry)", async () => {
		vi.mocked(readSessionResumePosition).mockResolvedValue(Result.ok(0));
		vi.mocked(captureAheadForSession).mockResolvedValue(
			Result.err(
				new DatabaseError({ code: "boom", message: "capture failed" }),
			),
		);

		await runClaimedDeckJob(
			job({ id: "job-fail", kind: "capture_ahead", session_id: "sess-4" }),
		);

		expectDeferred("job-fail");
		expect(Sentry.captureException).toHaveBeenCalledWith(
			expect.any(DatabaseError),
			expect.objectContaining({
				tags: expect.objectContaining({
					area: "match_deck",
					operation: "capture_ahead",
					runtime: "worker",
				}),
			}),
		);
	});

	it("N2: a 0-row complete settle logs the match-deck-settlement-guard-hit warn", async () => {
		vi.mocked(readSessionResumePosition).mockResolvedValue(Result.ok(0));
		vi.mocked(captureAheadForSession).mockResolvedValue(Result.ok(undefined));
		// 0-row match: the settlement guard fired (job concurrently dead-lettered).
		vi.mocked(completeDeckJob).mockResolvedValue(Result.ok(false));

		await runClaimedDeckJob(
			job({ id: "job-raced", kind: "capture_ahead", session_id: "s1" }),
		);

		expect(log.warn).toHaveBeenCalledWith("match-deck-settlement-guard-hit", {
			settlement: "complete",
			jobId: "job-raced",
			kind: "capture_ahead",
		});
	});

	describe("when a heartbeat finds the claim lost mid-run", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});
		afterEach(() => {
			vi.useRealTimers();
		});

		it("stops before the next side effect and does not settle", async () => {
			let finishBuild: () => void = () => {};
			vi.mocked(buildProposalsForAccountOrientation).mockReturnValue(
				new Promise((resolve) => {
					finishBuild = () => resolve(Result.ok(undefined));
				}),
			);
			vi.mocked(heartbeatDeckJob).mockResolvedValue(Result.ok(false));
			vi.mocked(enqueueDeckJob).mockResolvedValue(Result.ok(null));

			const run = runClaimedDeckJob(
				job({
					id: "job-stale",
					kind: "build_proposals",
					payload: { snapshotId: "snap-1" },
				}),
			);
			await vi.advanceTimersByTimeAsync(workerConfig.heartbeatIntervalMs);
			expect(heartbeatDeckJob).toHaveBeenCalledWith(
				"job-stale",
				"claim-token-1",
			);

			finishBuild();
			await run;

			expect(enqueueDeckJob).not.toHaveBeenCalled();
			expect(completeDeckJob).not.toHaveBeenCalled();
			expect(deferDeckJob).not.toHaveBeenCalled();
		});
	});
});
