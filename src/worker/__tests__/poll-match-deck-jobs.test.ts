import * as Sentry from "@sentry/bun";
import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	captureAheadForSession,
	readSessionResumePosition,
} from "@/lib/domains/taste/match-review-queue/card-materializer";
import type { DeckJob } from "@/lib/domains/taste/match-review-queue/deck-jobs";
import {
	completeDeckJob,
	deferDeckJob,
	enqueueDeckJob,
	markDeadDeckJobs,
	sweepStaleDeckJobs,
} from "@/lib/domains/taste/match-review-queue/deck-jobs";
import { buildProposalsForAccountOrientation } from "@/lib/domains/taste/match-review-queue/proposal-builder";
import { appendSessionsForAccountOrientation } from "@/lib/domains/taste/match-review-queue/session-appender";
import { log } from "@/lib/observability/logger";
import { DatabaseError } from "@/lib/shared/errors/database";
import {
	dispatchDeckJob,
	runClaimedDeckJob,
	runMatchDeckJobSweepTick,
} from "../poll-match-deck-jobs";

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
	markDeadDeckJobs: vi.fn(),
	sweepStaleDeckJobs: vi.fn(),
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

function job(overrides: Partial<DeckJob> = {}): DeckJob {
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
		payload: overrides.payload ?? {},
		created_at: overrides.created_at ?? "2026-07-07T00:00:00Z",
		updated_at: overrides.updated_at ?? "2026-07-07T00:00:00Z",
	};
}

describe("runMatchDeckJobSweepTick", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses the shared lease for both sweep and mark-dead, and logs dead letters", async () => {
		vi.mocked(sweepStaleDeckJobs).mockResolvedValue(
			Result.ok([job({ id: "stale-1" })]),
		);
		vi.mocked(markDeadDeckJobs).mockResolvedValue(
			Result.ok([job({ id: "dead-1", kind: "capture_ahead", status: "dead" })]),
		);

		await runMatchDeckJobSweepTick();

		expect(sweepStaleDeckJobs).toHaveBeenCalledWith(900);
		expect(markDeadDeckJobs).toHaveBeenCalledWith(900);
		expect(log.warn).toHaveBeenCalledWith("match-deck-swept-stale-jobs", {
			count: 1,
			jobIds: ["stale-1"],
		});
		expect(log.error).toHaveBeenCalledWith("match-deck-job-dead-lettered", {
			jobId: "dead-1",
			kind: "capture_ahead",
			accountId: "acct-1",
			orientation: "song",
		});
	});

	it("logs a mark-dead failure and stops before dead-letter logging", async () => {
		vi.mocked(sweepStaleDeckJobs).mockResolvedValue(Result.ok([]));
		vi.mocked(markDeadDeckJobs).mockResolvedValue(
			Result.err(
				new DatabaseError({
					code: "rpc_error",
					message: "mark-dead failed",
				}),
			),
		);

		await runMatchDeckJobSweepTick();

		expect(log.error).toHaveBeenCalledWith("match-deck-mark-dead-error", {
			error: "mark-dead failed",
		});
		expect(log.error).not.toHaveBeenCalledWith(
			"match-deck-job-dead-lettered",
			expect.anything(),
		);
	});
});

// ---------------------------------------------------------------------------
// dispatchDeckJob (P3.2) — direct unit tests over the exported dispatch
// function, isolating per-kind outcome/error handling from the poll loop's
// claim/settle machinery (covered separately below).
// ---------------------------------------------------------------------------

describe("dispatchDeckJob", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("build_proposals: builds, chains append_sessions, and settles ok (happy path)", async () => {
		vi.mocked(buildProposalsForAccountOrientation).mockResolvedValue(
			Result.ok(undefined),
		);
		vi.mocked(enqueueDeckJob).mockResolvedValue(Result.ok(null));

		const result = await dispatchDeckJob(
			job({ kind: "build_proposals", payload: { snapshotId: "snap-1" } }),
		);

		expect(Result.isError(result)).toBe(false);
		expect(enqueueDeckJob).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "append_sessions" }),
		);
		expect(Sentry.captureException).not.toHaveBeenCalled();
	});

	it("append_sessions: a handler error is returned (poll loop defers on this)", async () => {
		vi.mocked(appendSessionsForAccountOrientation).mockResolvedValue(
			Result.err(new DatabaseError({ code: "boom", message: "db exploded" })),
		);

		const result = await dispatchDeckJob(
			job({ kind: "append_sessions", payload: { snapshotId: "snap-1" } }),
		);

		expect(Result.isError(result)).toBe(true);
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

	it("append_sessions: superseded settles ok with NO defer signal and NO Sentry capture", async () => {
		vi.mocked(appendSessionsForAccountOrientation).mockResolvedValue(
			Result.ok({ kind: "superseded" }),
		);

		const result = await dispatchDeckJob(
			job({ kind: "append_sessions", payload: { snapshotId: "snap-1" } }),
		);

		expect(Result.isError(result)).toBe(false);
		expect(Sentry.captureException).not.toHaveBeenCalled();
	});

	it("M5: applied append with appendedCount > 0 chains capture_ahead with the exact idempotency key", async () => {
		vi.mocked(appendSessionsForAccountOrientation).mockResolvedValue(
			Result.ok({ kind: "applied", appendedCount: 3, sessionId: "sess-1" }),
		);
		vi.mocked(readSessionResumePosition).mockResolvedValue(Result.ok(7));
		vi.mocked(enqueueDeckJob).mockResolvedValue(Result.ok(null));

		await dispatchDeckJob(
			job({
				kind: "append_sessions",
				orientation: "playlist",
				account_id: "acct-9",
				payload: { snapshotId: "snap-1" },
			}),
		);

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

		await dispatchDeckJob(
			job({
				kind: "append_sessions",
				orientation: "song",
				account_id: "acct-9",
				payload: { snapshotId: "snap-1" },
			}),
		);

		expect(enqueueDeckJob).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "capture_ahead",
				sessionId: "sess-2",
				idempotencyKey: "capture:acct-9:song:sess-2:none",
			}),
		);
	});

	it("is silent when append_sessions applies zero cards", async () => {
		vi.mocked(appendSessionsForAccountOrientation).mockResolvedValue(
			Result.ok({ kind: "applied", appendedCount: 0, sessionId: "sess-3" }),
		);

		const result = await dispatchDeckJob(
			job({
				kind: "append_sessions",
				orientation: "song",
				account_id: "acct-9",
				payload: { snapshotId: "snap-1" },
			}),
		);

		expect(Result.isError(result)).toBe(false);
		expect(enqueueDeckJob).not.toHaveBeenCalled();
	});

	it("is silent when append_sessions does not apply a snapshot", async () => {
		vi.mocked(appendSessionsForAccountOrientation).mockResolvedValue(
			Result.ok({ kind: "superseded" }),
		);

		const result = await dispatchDeckJob(
			job({
				kind: "append_sessions",
				orientation: "song",
				account_id: "acct-9",
				payload: { snapshotId: "snap-1" },
			}),
		);

		expect(Result.isError(result)).toBe(false);
	});

	it("capture_ahead: happy path captures the window from the session's resume position", async () => {
		vi.mocked(readSessionResumePosition).mockResolvedValue(Result.ok(4));
		vi.mocked(captureAheadForSession).mockResolvedValue(Result.ok(undefined));

		const result = await dispatchDeckJob(
			job({ kind: "capture_ahead", session_id: "sess-3" }),
		);

		expect(Result.isError(result)).toBe(false);
		expect(captureAheadForSession).toHaveBeenCalledWith(
			expect.objectContaining({ sessionId: "sess-3", fromPosition: 4 }),
		);
		expect(Sentry.captureException).not.toHaveBeenCalled();
	});

	it("capture_ahead: a handler error is returned and captured (P1.2 symmetry)", async () => {
		vi.mocked(readSessionResumePosition).mockResolvedValue(Result.ok(0));
		vi.mocked(captureAheadForSession).mockResolvedValue(
			Result.err(
				new DatabaseError({ code: "boom", message: "capture failed" }),
			),
		);

		const result = await dispatchDeckJob(
			job({ kind: "capture_ahead", session_id: "sess-4" }),
		);

		expect(Result.isError(result)).toBe(true);
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
});

// ---------------------------------------------------------------------------
// runClaimedDeckJob — the claim → dispatch → settle lifecycle, extracted from
// the poll loop's fire-and-forget task specifically so this is testable
// without running the live while-loop (it idles on the global Bun.sleep,
// which the vitest node pool this suite runs under doesn't provide).
// ---------------------------------------------------------------------------

describe("runClaimedDeckJob", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("claim → dispatch → complete (happy path)", async () => {
		const testJob = job({
			id: "job-happy",
			kind: "capture_ahead",
			session_id: "s1",
		});
		vi.mocked(readSessionResumePosition).mockResolvedValue(Result.ok(0));
		vi.mocked(captureAheadForSession).mockResolvedValue(Result.ok(undefined));
		vi.mocked(completeDeckJob).mockResolvedValue(Result.ok(true));

		await runClaimedDeckJob(testJob);

		expect(completeDeckJob).toHaveBeenCalledWith("job-happy");
		expect(deferDeckJob).not.toHaveBeenCalled();
	});

	it("handler error → defer (job deferred, not completed)", async () => {
		const testJob = job({
			id: "job-fail",
			kind: "capture_ahead",
			session_id: "s1",
		});
		vi.mocked(readSessionResumePosition).mockResolvedValue(Result.ok(0));
		vi.mocked(captureAheadForSession).mockResolvedValue(
			Result.err(new DatabaseError({ code: "boom", message: "nope" })),
		);
		vi.mocked(deferDeckJob).mockResolvedValue(Result.ok(true));

		await runClaimedDeckJob(testJob);

		expect(deferDeckJob).toHaveBeenCalledWith("job-fail", 30);
		expect(completeDeckJob).not.toHaveBeenCalled();
	});

	it("N2: a 0-row complete settle logs the match-deck-settlement-guard-hit warn", async () => {
		const testJob = job({
			id: "job-raced",
			kind: "capture_ahead",
			session_id: "s1",
		});
		vi.mocked(readSessionResumePosition).mockResolvedValue(Result.ok(0));
		vi.mocked(captureAheadForSession).mockResolvedValue(Result.ok(undefined));
		// 0-row match: the settlement guard fired (job concurrently dead-lettered).
		vi.mocked(completeDeckJob).mockResolvedValue(Result.ok(false));

		await runClaimedDeckJob(testJob);

		expect(log.warn).toHaveBeenCalledWith("match-deck-settlement-guard-hit", {
			settlement: "complete",
			jobId: "job-raced",
			kind: "capture_ahead",
		});
	});
});
