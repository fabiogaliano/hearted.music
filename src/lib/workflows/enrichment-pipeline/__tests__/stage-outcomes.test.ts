import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/shared/errors/database";

const mockRecordStageFailure = vi.fn().mockResolvedValue(Result.ok(undefined));
const mockResolveStageFailures = vi.fn().mockResolvedValue(Result.ok(0));

vi.mock("../record-failure", () => ({
	recordStageFailure: (params: Record<string, unknown>) =>
		mockRecordStageFailure(params),
}));

vi.mock("@/lib/platform/jobs/item-failures", () => ({
	resolveJobStageFailures: (params: Record<string, unknown>) =>
		mockResolveStageFailures(params),
}));

import { FAILURE_CODES } from "../failure-policy";
import {
	finalizeStageOutcome,
	makeThrownOutcome,
	StageAccountingError,
	type StageOutcome,
	summarizeOutcome,
	validateOutcome,
} from "../stage-outcomes";

beforeEach(() => {
	vi.clearAllMocks();
	mockRecordStageFailure.mockResolvedValue(Result.ok(undefined));
	mockResolveStageFailures.mockResolvedValue(Result.ok(0));
});

describe("validateOutcome", () => {
	it("returns null for a valid attempted outcome", () => {
		const outcome: StageOutcome = {
			kind: "attempted",
			stage: "audio_features",
			candidateSongIds: ["a", "b"],
			attemptedSongIds: ["a", "b"],
			succeededSongIds: ["a"],
			failures: [
				{
					songId: "b",
					failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
					message: "transient",
				},
			],
		};
		expect(validateOutcome(outcome)).toBeNull();
	});

	it("returns null for a skipped outcome", () => {
		const outcome: StageOutcome = {
			kind: "skipped",
			stage: "audio_features",
			candidateSongIds: ["a"],
		};
		expect(validateOutcome(outcome)).toBeNull();
	});

	it("rejects overlapping succeeded and failed song IDs", () => {
		const outcome: StageOutcome = {
			kind: "attempted",
			stage: "genre_tagging",
			candidateSongIds: ["a"],
			attemptedSongIds: ["a"],
			succeededSongIds: ["a"],
			failures: [
				{
					songId: "a",
					failureCode: FAILURE_CODES.PERMANENT,
					message: "permanent",
				},
			],
		};
		const err = validateOutcome(outcome);
		if (err === null) {
			throw new Error("Expected validation error");
		}
		expect(err.kind).toBe("overlap");
		expect(err.songIds).toEqual(["a"]);
	});

	it("rejects attempted song IDs that are not part of the candidate set", () => {
		const outcome: StageOutcome = {
			kind: "attempted",
			stage: "audio_features",
			candidateSongIds: ["a"],
			attemptedSongIds: ["a", "b"],
			succeededSongIds: ["a"],
			failures: [
				{
					songId: "b",
					failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
					message: "unexpected",
				},
			],
		};
		const err = validateOutcome(outcome);
		if (err === null) {
			throw new Error("Expected validation error");
		}
		expect(err.kind).toBe("attempted_not_in_candidates");
		expect(err.songIds).toEqual(["b"]);
	});

	it("rejects succeeded song IDs that were not attempted", () => {
		const outcome: StageOutcome = {
			kind: "attempted",
			stage: "song_embedding",
			candidateSongIds: ["a", "b"],
			attemptedSongIds: ["a"],
			succeededSongIds: ["b"],
			failures: [],
		};
		const err = validateOutcome(outcome);
		if (err === null) {
			throw new Error("Expected validation error");
		}
		expect(err.kind).toBe("succeeded_not_in_attempted");
		expect(err.songIds).toEqual(["b"]);
	});

	it("rejects duplicate attempted song IDs", () => {
		const outcome: StageOutcome = {
			kind: "attempted",
			stage: "audio_features",
			candidateSongIds: ["a", "b"],
			attemptedSongIds: ["a", "a", "b"],
			succeededSongIds: ["a"],
			failures: [
				{
					songId: "b",
					failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
					message: "transient",
				},
			],
		};
		const err = validateOutcome(outcome);
		if (err === null) {
			throw new Error("Expected validation error");
		}
		expect(err.kind).toBe("duplicate_attempted");
		expect(err.songIds).toEqual(["a"]);
	});

	it("rejects duplicate succeeded song IDs", () => {
		const outcome: StageOutcome = {
			kind: "attempted",
			stage: "genre_tagging",
			candidateSongIds: ["a", "b"],
			attemptedSongIds: ["a", "b"],
			succeededSongIds: ["a", "a"],
			failures: [
				{
					songId: "b",
					failureCode: FAILURE_CODES.PERMANENT,
					message: "failed",
				},
			],
		};
		const err = validateOutcome(outcome);
		if (err === null) {
			throw new Error("Expected validation error");
		}
		expect(err.kind).toBe("duplicate_succeeded");
		expect(err.songIds).toEqual(["a"]);
	});

	it("rejects failed song IDs that were not attempted", () => {
		const outcome: StageOutcome = {
			kind: "attempted",
			stage: "song_analysis",
			candidateSongIds: ["a", "b"],
			attemptedSongIds: ["a"],
			succeededSongIds: ["a"],
			failures: [
				{
					songId: "b",
					failureCode: FAILURE_CODES.PERMANENT,
					message: "was never attempted",
				},
			],
		};
		const err = validateOutcome(outcome);
		if (err === null) {
			throw new Error("Expected validation error");
		}
		expect(err.kind).toBe("failed_not_in_attempted");
		expect(err.songIds).toEqual(["b"]);
	});

	it("rejects duplicate failure entries for the same song", () => {
		const outcome: StageOutcome = {
			kind: "attempted",
			stage: "song_analysis",
			candidateSongIds: ["a"],
			attemptedSongIds: ["a"],
			succeededSongIds: [],
			failures: [
				{
					songId: "a",
					failureCode: FAILURE_CODES.ANALYSIS_INPUTS_MISSING,
					message: "missing lyrics",
				},
				{
					songId: "a",
					failureCode: FAILURE_CODES.ANALYSIS_INPUTS_MISSING,
					message: "still missing lyrics",
				},
			],
		};
		const err = validateOutcome(outcome);
		if (err === null) {
			throw new Error("Expected validation error");
		}
		expect(err.kind).toBe("duplicate_failed");
		expect(err.songIds).toEqual(["a"]);
	});
});

describe("summarizeOutcome", () => {
	it("returns zeroes for a skipped outcome", () => {
		expect(
			summarizeOutcome({
				kind: "skipped",
				stage: "song_analysis",
				candidateSongIds: ["a", "b"],
			}),
		).toEqual({ total: 0, succeeded: 0, failed: 0 });
	});

	it("derives counts from attempted outcome IDs", () => {
		expect(
			summarizeOutcome({
				kind: "attempted",
				stage: "song_embedding",
				candidateSongIds: ["a", "b", "c"],
				attemptedSongIds: ["a", "b", "c"],
				succeededSongIds: ["a", "b"],
				failures: [
					{
						songId: "c",
						failureCode: FAILURE_CODES.PERMANENT,
						message: "failed",
					},
				],
			}),
		).toEqual({ total: 3, succeeded: 2, failed: 1 });
	});
});

describe("makeThrownOutcome", () => {
	it("creates one failure per candidate with the thrown error message", () => {
		const error = new Error("Provider API 500");
		const outcome = makeThrownOutcome(
			"audio_features",
			["s1", "s2", "s3"],
			error,
			FAILURE_CODES.PROVIDER_TRANSIENT,
		);

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") return;

		expect(outcome.failures).toHaveLength(3);
		expect(outcome.succeededSongIds).toEqual([]);
		expect(outcome.attemptedSongIds).toEqual(["s1", "s2", "s3"]);

		for (const f of outcome.failures) {
			expect(f.failureCode).toBe(FAILURE_CODES.PROVIDER_TRANSIENT);
			expect(f.message).toBe("Provider API 500");
		}

		const summary = summarizeOutcome(outcome);
		expect(summary.failed).toBe(3);
		expect(summary.succeeded).toBe(0);
	});

	it("handles non-Error thrown values", () => {
		const outcome = makeThrownOutcome(
			"genre_tagging",
			["s1"],
			"plain string error",
			FAILURE_CODES.PROVIDER_TRANSIENT,
		);

		if (outcome.kind !== "attempted") return;
		expect(outcome.failures).toHaveLength(1);
		const [failure] = outcome.failures;
		if (!failure) {
			throw new Error("Expected thrown outcome failure");
		}
		expect(failure.message).toBe("plain string error");
	});
});

describe("finalizeStageOutcome", () => {
	it("resolves prior failures for succeeded songs", async () => {
		const outcome: StageOutcome = {
			kind: "attempted",
			stage: "audio_features",
			candidateSongIds: ["a", "b"],
			attemptedSongIds: ["a", "b"],
			succeededSongIds: ["a", "b"],
			failures: [],
		};

		const result = await finalizeStageOutcome({
			outcome,
			jobId: "job-1",
			accountId: "acct-1",
		});

		expect(Result.isOk(result)).toBe(true);
		expect(mockResolveStageFailures).toHaveBeenCalledTimes(2);
		expect(mockResolveStageFailures).toHaveBeenCalledWith({
			accountId: "acct-1",
			itemId: "a",
			stage: "audio_features",
		});
	});

	it("records failure rows for failed songs", async () => {
		const outcome: StageOutcome = {
			kind: "attempted",
			stage: "genre_tagging",
			candidateSongIds: ["a"],
			attemptedSongIds: ["a"],
			succeededSongIds: [],
			failures: [
				{
					songId: "a",
					failureCode: FAILURE_CODES.SOURCE_NOT_FOUND,
					message: "not found on Spotify",
				},
			],
		};

		const result = await finalizeStageOutcome({
			outcome,
			jobId: "job-1",
			accountId: "acct-1",
		});

		expect(Result.isOk(result)).toBe(true);
		expect(mockRecordStageFailure).toHaveBeenCalledTimes(1);
		expect(mockRecordStageFailure).toHaveBeenCalledWith(
			expect.objectContaining({
				jobId: "job-1",
				songId: "a",
				stage: "genre_tagging",
				failureCode: "source_not_found",
				errorMessage: "not found on Spotify",
			}),
		);
	});

	it("returns StageSummary with correct counts on success", async () => {
		const outcome: StageOutcome = {
			kind: "attempted",
			stage: "song_embedding",
			candidateSongIds: ["a", "b", "c"],
			attemptedSongIds: ["a", "b", "c"],
			succeededSongIds: ["a", "b"],
			failures: [
				{
					songId: "c",
					failureCode: FAILURE_CODES.PERMANENT,
					message: "embed failed",
				},
			],
		};

		const result = await finalizeStageOutcome({
			outcome,
			jobId: "job-1",
			accountId: "acct-1",
		});

		expect(Result.isOk(result)).toBe(true);
		if (Result.isOk(result)) {
			expect(result.value).toEqual({ total: 3, succeeded: 2, failed: 1 });
		}
	});

	it("returns ok summary for skipped outcomes", async () => {
		const result = await finalizeStageOutcome({
			outcome: {
				kind: "skipped",
				stage: "audio_features",
				candidateSongIds: ["a"],
			},
			jobId: "job-1",
			accountId: "acct-1",
		});

		expect(Result.isOk(result)).toBe(true);
		if (Result.isOk(result)) {
			expect(result.value).toEqual({ total: 0, succeeded: 0, failed: 0 });
		}
		expect(mockResolveStageFailures).not.toHaveBeenCalled();
		expect(mockRecordStageFailure).not.toHaveBeenCalled();
	});

	it("returns StageAccountingError when resolve fails", async () => {
		mockResolveStageFailures.mockResolvedValue(
			Result.err(
				new DatabaseError({ code: "FAIL", message: "resolve rpc down" }),
			),
		);

		const result = await finalizeStageOutcome({
			outcome: {
				kind: "attempted",
				stage: "audio_features",
				candidateSongIds: ["a"],
				attemptedSongIds: ["a"],
				succeededSongIds: ["a"],
				failures: [],
			},
			jobId: "job-1",
			accountId: "acct-1",
		});

		expect(Result.isError(result)).toBe(true);
		if (Result.isError(result)) {
			expect(result.error).toBeInstanceOf(StageAccountingError);
			expect(result.error.phase).toBe("resolve_prior");
		}
	});

	it("returns StageAccountingError when failure-row recording fails", async () => {
		mockRecordStageFailure.mockResolvedValue(
			Result.err(new DatabaseError({ code: "FAIL", message: "insert failed" })),
		);

		const result = await finalizeStageOutcome({
			outcome: {
				kind: "attempted",
				stage: "genre_tagging",
				candidateSongIds: ["a"],
				attemptedSongIds: ["a"],
				succeededSongIds: [],
				failures: [
					{
						songId: "a",
						failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
						message: "err",
					},
				],
			},
			jobId: "job-1",
			accountId: "acct-1",
		});

		expect(Result.isError(result)).toBe(true);
		if (Result.isError(result)) {
			expect(result.error).toBeInstanceOf(StageAccountingError);
			expect(result.error.phase).toBe("record_failures");
		}
	});

	it("returns StageAccountingError when compensation fails", async () => {
		const compensate = vi.fn().mockResolvedValue(
			Result.err(
				new DatabaseError({
					code: "FAIL",
					message: "compensation rpc down",
				}),
			),
		);

		const result = await finalizeStageOutcome({
			outcome: {
				kind: "attempted",
				stage: "song_analysis",
				candidateSongIds: ["a"],
				attemptedSongIds: ["a"],
				succeededSongIds: [],
				failures: [
					{
						songId: "a",
						failureCode: FAILURE_CODES.ANALYSIS_INPUTS_MISSING,
						message: "no inputs",
					},
				],
			},
			jobId: "job-1",
			accountId: "acct-1",
			compensate,
		});

		expect(Result.isError(result)).toBe(true);
		if (Result.isError(result)) {
			expect(result.error).toBeInstanceOf(StageAccountingError);
			expect(result.error.phase).toBe("compensation");
		}
	});

	it("calls compensate only for song_analysis analysis_inputs_missing failures", async () => {
		const compensate = vi.fn().mockResolvedValue(Result.ok(undefined));

		await finalizeStageOutcome({
			outcome: {
				kind: "attempted",
				stage: "song_analysis",
				candidateSongIds: ["a", "b"],
				attemptedSongIds: ["a", "b"],
				succeededSongIds: [],
				failures: [
					{
						songId: "a",
						failureCode: FAILURE_CODES.ANALYSIS_INPUTS_MISSING,
						message: "no inputs",
					},
					{
						songId: "b",
						failureCode: FAILURE_CODES.PERMANENT,
						message: "llm failed",
					},
				],
			},
			jobId: "job-1",
			accountId: "acct-1",
			compensate,
		});

		expect(compensate).toHaveBeenCalledTimes(1);
		expect(compensate).toHaveBeenCalledWith("a");
		const [recordOrder] = mockRecordStageFailure.mock.invocationCallOrder;
		const [compensateOrder] = compensate.mock.invocationCallOrder;
		if (recordOrder === undefined || compensateOrder === undefined) {
			throw new Error("Expected recording and compensation calls");
		}
		expect(recordOrder).toBeLessThan(compensateOrder);
	});

	it("does not compensate when durable failure recording fails", async () => {
		mockRecordStageFailure.mockResolvedValue(
			Result.err(new DatabaseError({ code: "FAIL", message: "insert failed" })),
		);
		const compensate = vi.fn().mockResolvedValue(Result.ok(undefined));

		const result = await finalizeStageOutcome({
			outcome: {
				kind: "attempted",
				stage: "song_analysis",
				candidateSongIds: ["a"],
				attemptedSongIds: ["a"],
				succeededSongIds: [],
				failures: [
					{
						songId: "a",
						failureCode: FAILURE_CODES.ANALYSIS_INPUTS_MISSING,
						message: "no inputs",
					},
				],
			},
			jobId: "job-1",
			accountId: "acct-1",
			compensate,
		});

		expect(Result.isError(result)).toBe(true);
		expect(compensate).not.toHaveBeenCalled();
	});

	it("does not call compensate when no compensate callback provided", async () => {
		const result = await finalizeStageOutcome({
			outcome: {
				kind: "attempted",
				stage: "song_analysis",
				candidateSongIds: ["a"],
				attemptedSongIds: ["a"],
				succeededSongIds: [],
				failures: [
					{
						songId: "a",
						failureCode: FAILURE_CODES.ANALYSIS_INPUTS_MISSING,
						message: "no inputs",
					},
				],
			},
			jobId: "job-1",
			accountId: "acct-1",
		});

		expect(Result.isOk(result)).toBe(true);
	});

	it("does not call compensate for matching failure codes on other stages", async () => {
		const compensate = vi.fn().mockResolvedValue(Result.ok(undefined));

		const result = await finalizeStageOutcome({
			outcome: {
				kind: "attempted",
				stage: "audio_features",
				candidateSongIds: ["a"],
				attemptedSongIds: ["a"],
				succeededSongIds: [],
				failures: [
					{
						songId: "a",
						failureCode: FAILURE_CODES.ANALYSIS_INPUTS_MISSING,
						message: "no inputs",
					},
				],
			},
			jobId: "job-1",
			accountId: "acct-1",
			compensate,
		});

		expect(Result.isOk(result)).toBe(true);
		expect(compensate).not.toHaveBeenCalled();
	});

	it("rejects overlapping succeeded/failed outcome as accounting error", async () => {
		const result = await finalizeStageOutcome({
			outcome: {
				kind: "attempted",
				stage: "audio_features",
				candidateSongIds: ["a"],
				attemptedSongIds: ["a"],
				succeededSongIds: ["a"],
				failures: [
					{
						songId: "a",
						failureCode: FAILURE_CODES.PERMANENT,
						message: "impossible",
					},
				],
			},
			jobId: "job-1",
			accountId: "acct-1",
		});

		expect(Result.isError(result)).toBe(true);
		if (Result.isError(result)) {
			expect(result.error).toBeInstanceOf(StageAccountingError);
			expect(result.error.phase).toBe("validate_outcome");
		}
		expect(mockResolveStageFailures).not.toHaveBeenCalled();
		expect(mockRecordStageFailure).not.toHaveBeenCalled();
	});

	it("records durable non-terminal failures for a retryable per-candidate attempted outcome", async () => {
		// This covers the accounting seam once a caller has already expanded a
		// retryable stage-level failure into one failure per attempted song.
		const outcome: StageOutcome = {
			kind: "attempted",
			stage: "audio_features",
			candidateSongIds: ["s1", "s2"],
			attemptedSongIds: ["s1", "s2"],
			succeededSongIds: [],
			failures: [
				{
					songId: "s1",
					failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
					message: "readiness check DB unavailable",
				},
				{
					songId: "s2",
					failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
					message: "readiness check DB unavailable",
				},
			],
		};

		const result = await finalizeStageOutcome({
			outcome,
			jobId: "job-1",
			accountId: "acct-1",
		});

		expect(Result.isOk(result)).toBe(true);
		expect(mockRecordStageFailure).toHaveBeenCalledTimes(2);
		for (const [params] of mockRecordStageFailure.mock.calls) {
			expect(params).toHaveProperty(
				"failureCode",
				FAILURE_CODES.PROVIDER_TRANSIENT,
			);
		}
	});

	it("finalizes a thrown outcome recording one failure per candidate", async () => {
		const thrown = makeThrownOutcome(
			"audio_features",
			["s1", "s2", "s3"],
			new Error("API timeout"),
			FAILURE_CODES.PROVIDER_TRANSIENT,
		);

		const result = await finalizeStageOutcome({
			outcome: thrown,
			jobId: "job-1",
			accountId: "acct-1",
		});

		expect(Result.isOk(result)).toBe(true);
		if (Result.isOk(result)) {
			expect(result.value).toEqual({ total: 3, succeeded: 0, failed: 3 });
		}
		expect(mockRecordStageFailure).toHaveBeenCalledTimes(3);
		const songIds = mockRecordStageFailure.mock.calls.map(([params]) => {
			if (
				typeof params !== "object" ||
				params === null ||
				!("songId" in params) ||
				typeof params.songId !== "string"
			) {
				throw new Error("Expected failure recording params with songId");
			}
			return params.songId;
		});
		expect(songIds.sort()).toEqual(["s1", "s2", "s3"]);
	});
});
