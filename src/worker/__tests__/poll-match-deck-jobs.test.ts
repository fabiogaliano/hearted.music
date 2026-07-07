import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeckJob } from "@/lib/domains/taste/match-review-queue/deck-jobs";
import {
	markDeadDeckJobs,
	sweepStaleDeckJobs,
} from "@/lib/domains/taste/match-review-queue/deck-jobs";
import { log } from "@/lib/observability/logger";
import { DatabaseError } from "@/lib/shared/errors/database";
import { runMatchDeckJobSweepTick } from "../poll-match-deck-jobs";

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
