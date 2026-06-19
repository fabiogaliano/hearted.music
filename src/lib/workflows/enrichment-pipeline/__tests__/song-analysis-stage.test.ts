import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSongAnalysisGet = vi.fn();
const mockAnalyzeSongBatch = vi.fn();
const mockCreateSongBatchAnalyzerDeps = vi.fn();

vi.mock("@/lib/domains/enrichment/content-analysis/queries", () => ({
	get: (ids: string[]) => mockSongAnalysisGet(ids),
}));

vi.mock(
	"@/lib/domains/enrichment/content-analysis/song-batch-analysis",
	() => ({
		analyzeSongBatch: (...args: unknown[]) => mockAnalyzeSongBatch(...args),
		createSongBatchAnalyzerDeps: (...args: unknown[]) =>
			mockCreateSongBatchAnalyzerDeps(...args),
	}),
);

import type { AnalysisFailureClassification } from "@/lib/domains/enrichment/content-analysis/failure-classification";
import type { PipelineBatch } from "../batch";
import type { StageOutcome } from "../stage-outcomes";
import { runSongAnalysis } from "../stages/song-analysis";
import type { EnrichmentContext } from "../types";

function classification(
	isRetryable: boolean,
	extra: Partial<AnalysisFailureClassification> = {},
): AnalysisFailureClassification {
	return {
		isRetryable,
		cause: isRetryable ? "llm_rate_limit" : "unknown",
		message: isRetryable ? "transient failure" : "permanent failure",
		...extra,
	};
}

function makeBatch(songIds: string[]): PipelineBatch {
	const now = new Date().toISOString();
	return {
		songIds,
		songs: songIds.map((id) => ({
			id,
			spotify_id: `sp-${id}`,
			name: id,
			artists: ["test"],
			artist_ids: [],
			genres: [],
			album_id: null,
			album_name: null,
			image_url: null,
			preview_url: null,
			duration_ms: null,
			popularity: null,
			isrc: null,
			release_year: null,
			release_year_checked_at: null,
			vocal_gender: null,
			language: null,
			language_confidence: null,
			language_secondary: null,
			language_checked_at: null,
			created_at: now,
			updated_at: now,
		})),
		spotifyIdBySongId: new Map(songIds.map((id) => [id, `sp-${id}`])),
	};
}

function makeCtx(): EnrichmentContext {
	return {
		accountId: "account-1",
		embeddingService: {} as EnrichmentContext["embeddingService"],
		profilingService: {} as EnrichmentContext["profilingService"],
		jobId: "job-1",
	};
}

function emptyBatchOutcome() {
	return {
		analyzedSongIds: [],
		failedSongIds: [],
		failureClassifications: new Map<string, AnalysisFailureClassification>(),
		skippedConfirmedInputsMissing: [],
		skippedUnconfirmedLyrics: [],
		skippedUnconfirmedAudio: [],
		skippedUnconfirmedBoth: [],
		retryCandidateSongIds: [],
		blockedSkipErrors: new Map<string, unknown>(),
	};
}

function expectAttempted(
	outcome: StageOutcome,
): Extract<StageOutcome, { kind: "attempted" }> {
	if (outcome.kind !== "attempted") {
		throw new Error(`Expected attempted outcome, got ${outcome.kind}`);
	}
	return outcome;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockSongAnalysisGet.mockResolvedValue(Result.ok(new Map()));
	mockCreateSongBatchAnalyzerDeps.mockReturnValue(
		Result.ok({
			lyricsService: null,
			songAnalysisService: {},
			concurrency: 5,
		}),
	);
	mockAnalyzeSongBatch.mockResolvedValue(emptyBatchOutcome());
});

describe("runSongAnalysis: returns StageOutcome", () => {
	it("returns skipped when all candidates already have analyses", async () => {
		mockSongAnalysisGet.mockResolvedValue(
			Result.ok(new Map([["s1", { id: "a1" }]])),
		);

		const outcome = await runSongAnalysis(makeCtx(), makeBatch(["s1"]));

		expect(outcome.kind).toBe("skipped");
		expect(outcome.candidateSongIds).toEqual(["s1"]);
	});
});

describe("runSongAnalysis: analysis-input gate (tri-state)", () => {
	it("maps confirmed-missing to analysis_inputs_missing failures", async () => {
		mockAnalyzeSongBatch.mockResolvedValue({
			...emptyBatchOutcome(),
			skippedConfirmedInputsMissing: ["skip-me"],
			failedSongIds: [],
		});
		mockSongAnalysisGet
			.mockResolvedValueOnce(Result.ok(new Map()))
			.mockResolvedValueOnce(Result.ok(new Map()));

		const outcome = expectAttempted(
			await runSongAnalysis(makeCtx(), makeBatch(["skip-me"])),
		);

		expect(outcome.failures).toHaveLength(1);
		expect(outcome.failures[0]).toMatchObject({
			songId: "skip-me",
			failureCode: "analysis_inputs_missing",
		});
		expect(outcome.succeededSongIds).toEqual([]);
	});

	it("maps skippedUnconfirmedLyrics to analysis_blocked_lyrics_unavailable", async () => {
		mockAnalyzeSongBatch.mockResolvedValue({
			...emptyBatchOutcome(),
			skippedUnconfirmedLyrics: ["lyrics-down"],
		});
		mockSongAnalysisGet
			.mockResolvedValueOnce(Result.ok(new Map()))
			.mockResolvedValueOnce(Result.ok(new Map()));

		const outcome = expectAttempted(
			await runSongAnalysis(makeCtx(), makeBatch(["lyrics-down"])),
		);

		expect(outcome.failures).toHaveLength(1);
		expect(outcome.failures[0]).toMatchObject({
			songId: "lyrics-down",
			failureCode: "analysis_blocked_lyrics_unavailable",
		});
	});

	it("maps skippedUnconfirmedAudio to analysis_blocked_audio_unavailable", async () => {
		mockAnalyzeSongBatch.mockResolvedValue({
			...emptyBatchOutcome(),
			skippedUnconfirmedAudio: ["audio-down"],
		});
		mockSongAnalysisGet
			.mockResolvedValueOnce(Result.ok(new Map()))
			.mockResolvedValueOnce(Result.ok(new Map()));

		const outcome = expectAttempted(
			await runSongAnalysis(makeCtx(), makeBatch(["audio-down"])),
		);

		expect(outcome.failures).toHaveLength(1);
		expect(outcome.failures[0]).toMatchObject({
			songId: "audio-down",
			failureCode: "analysis_blocked_audio_unavailable",
		});
	});

	it("maps skippedUnconfirmedBoth to analysis_blocked_both_unavailable", async () => {
		mockAnalyzeSongBatch.mockResolvedValue({
			...emptyBatchOutcome(),
			skippedUnconfirmedBoth: ["everything-down"],
		});
		mockSongAnalysisGet
			.mockResolvedValueOnce(Result.ok(new Map()))
			.mockResolvedValueOnce(Result.ok(new Map()));

		const outcome = expectAttempted(
			await runSongAnalysis(makeCtx(), makeBatch(["everything-down"])),
		);

		expect(outcome.failures).toHaveLength(1);
		expect(outcome.failures[0]).toMatchObject({
			songId: "everything-down",
			failureCode: "analysis_blocked_both_unavailable",
		});
	});

	it("does not double-classify skipped songs as permanent", async () => {
		mockAnalyzeSongBatch.mockResolvedValue({
			...emptyBatchOutcome(),
			skippedConfirmedInputsMissing: ["confirmed"],
			skippedUnconfirmedLyrics: ["lyrics"],
			skippedUnconfirmedAudio: ["audio"],
			skippedUnconfirmedBoth: ["both"],
			failedSongIds: [],
		});
		mockSongAnalysisGet
			.mockResolvedValueOnce(Result.ok(new Map()))
			.mockResolvedValueOnce(Result.ok(new Map()));

		const outcome = expectAttempted(
			await runSongAnalysis(
				makeCtx(),
				makeBatch(["confirmed", "lyrics", "audio", "both"]),
			),
		);

		expect(outcome.failures).toHaveLength(4);
		const codes = outcome.failures.map((f) => f.failureCode);
		expect(codes).not.toContain("permanent");
	});

	it("does not report a skipped song as failed when shared analysis appears by post-run lookup", async () => {
		mockAnalyzeSongBatch.mockResolvedValue({
			...emptyBatchOutcome(),
			skippedConfirmedInputsMissing: ["shared-success"],
		});
		mockSongAnalysisGet
			.mockResolvedValueOnce(Result.ok(new Map()))
			.mockResolvedValueOnce(
				Result.ok(new Map([["shared-success", { id: "analysis-1" }]])),
			);

		const outcome = expectAttempted(
			await runSongAnalysis(makeCtx(), makeBatch(["shared-success"])),
		);

		expect(outcome.succeededSongIds).toEqual(["shared-success"]);
		expect(outcome.failures).toEqual([]);
	});
});

describe("runSongAnalysis: genuine analysis failures", () => {
	it("maps genuinely failed songs to permanent when post-run confirms no analysis and failure is not transient", async () => {
		const failureClassifications = new Map<
			string,
			AnalysisFailureClassification
		>();
		failureClassifications.set("llm-fail", classification(false));
		mockAnalyzeSongBatch.mockResolvedValue({
			...emptyBatchOutcome(),
			failedSongIds: ["llm-fail"],
			failureClassifications,
		});
		mockSongAnalysisGet
			.mockResolvedValueOnce(Result.ok(new Map()))
			.mockResolvedValueOnce(Result.ok(new Map()));

		const outcome = expectAttempted(
			await runSongAnalysis(makeCtx(), makeBatch(["llm-fail"])),
		);

		expect(outcome.failures).toHaveLength(1);
		expect(outcome.failures[0]).toMatchObject({
			songId: "llm-fail",
			failureCode: "permanent",
		});
		expect(outcome.succeededSongIds).toEqual([]);
	});

	it("maps LLM rate-limit failures to provider_transient and preserves retry metadata", async () => {
		const failureClassifications = new Map<
			string,
			AnalysisFailureClassification
		>();
		failureClassifications.set(
			"rate-limited",
			classification(true, {
				cause: "llm_rate_limit",
				retryAfterMs: 5000,
				provider: "google",
			}),
		);
		mockAnalyzeSongBatch.mockResolvedValue({
			...emptyBatchOutcome(),
			failedSongIds: ["rate-limited"],
			failureClassifications,
		});
		mockSongAnalysisGet
			.mockResolvedValueOnce(Result.ok(new Map()))
			.mockResolvedValueOnce(Result.ok(new Map()));

		const outcome = expectAttempted(
			await runSongAnalysis(makeCtx(), makeBatch(["rate-limited"])),
		);

		expect(outcome.failures).toHaveLength(1);
		expect(outcome.failures[0]).toMatchObject({
			songId: "rate-limited",
			failureCode: "provider_transient",
			retryAfterMs: 5000,
			provider: "google",
			causeTag: "llm_rate_limit",
		});
	});

	it("does not classify as permanent if post-run check shows analysis exists", async () => {
		mockAnalyzeSongBatch.mockResolvedValue({
			...emptyBatchOutcome(),
			analyzedSongIds: ["s1"],
			failedSongIds: ["s1"],
		});
		mockSongAnalysisGet
			.mockResolvedValueOnce(Result.ok(new Map()))
			.mockResolvedValueOnce(Result.ok(new Map([["s1", { id: "a1" }]])));

		const outcome = expectAttempted(
			await runSongAnalysis(makeCtx(), makeBatch(["s1"])),
		);

		const permanentFailures = outcome.failures.filter(
			(f) => f.failureCode === "permanent",
		);
		expect(permanentFailures).toHaveLength(0);
		expect(outcome.succeededSongIds).toContain("s1");
	});
});

describe("runSongAnalysis: post-run lookup failure", () => {
	it("maps uncertain songs to analysis_postrun_lookup_unavailable", async () => {
		const { DatabaseError } = await import("@/lib/shared/errors/database");

		mockAnalyzeSongBatch.mockResolvedValue({
			...emptyBatchOutcome(),
			failedSongIds: ["uncertain"],
		});
		mockSongAnalysisGet
			.mockResolvedValueOnce(Result.ok(new Map()))
			.mockResolvedValueOnce(
				Result.err(
					new DatabaseError({ code: "FAIL", message: "post-run down" }),
				),
			);

		const outcome = expectAttempted(
			await runSongAnalysis(makeCtx(), makeBatch(["uncertain"])),
		);

		expect(outcome.failures).toHaveLength(1);
		expect(outcome.failures[0]).toMatchObject({
			songId: "uncertain",
			failureCode: "analysis_postrun_lookup_unavailable",
		});
		expect(outcome.succeededSongIds).toEqual([]);
	});

	it("excludes skip-bucket songs from uncertain set during lookup failure", async () => {
		const { DatabaseError } = await import("@/lib/shared/errors/database");

		mockAnalyzeSongBatch.mockResolvedValue({
			...emptyBatchOutcome(),
			skippedUnconfirmedBoth: ["both-down"],
			skippedConfirmedInputsMissing: ["confirmed-missing"],
			failedSongIds: ["uncertain-llm"],
		});
		mockSongAnalysisGet
			.mockResolvedValueOnce(Result.ok(new Map()))
			.mockResolvedValueOnce(
				Result.err(
					new DatabaseError({ code: "FAIL", message: "post-run down" }),
				),
			);

		const outcome = expectAttempted(
			await runSongAnalysis(
				makeCtx(),
				makeBatch(["both-down", "confirmed-missing", "uncertain-llm"]),
			),
		);

		const byId = new Map(outcome.failures.map((f) => [f.songId, f]));
		expect(byId.get("both-down")?.failureCode).toBe(
			"analysis_blocked_both_unavailable",
		);
		expect(byId.get("confirmed-missing")?.failureCode).toBe(
			"analysis_inputs_missing",
		);
		expect(byId.get("uncertain-llm")?.failureCode).toBe(
			"analysis_postrun_lookup_unavailable",
		);
		expect(outcome.failures.some((f) => f.failureCode === "permanent")).toBe(
			false,
		);
	});
});

describe("runSongAnalysis: success classification", () => {
	it("classifies songs present in post-run lookup as succeeded", async () => {
		mockAnalyzeSongBatch.mockResolvedValue({
			...emptyBatchOutcome(),
			analyzedSongIds: ["s1", "s2"],
		});
		mockSongAnalysisGet
			.mockResolvedValueOnce(Result.ok(new Map()))
			.mockResolvedValueOnce(
				Result.ok(
					new Map([
						["s1", { id: "a1" }],
						["s2", { id: "a2" }],
					]),
				),
			);

		const outcome = expectAttempted(
			await runSongAnalysis(makeCtx(), makeBatch(["s1", "s2"])),
		);

		expect(outcome.succeededSongIds).toEqual(["s1", "s2"]);
		expect(outcome.failures).toEqual([]);
	});

	it("mixed batch: success + skip + permanent", async () => {
		const failureClassifications = new Map<
			string,
			AnalysisFailureClassification
		>();
		failureClassifications.set("llm-fail", classification(false));
		mockAnalyzeSongBatch.mockResolvedValue({
			...emptyBatchOutcome(),
			analyzedSongIds: ["ok"],
			failedSongIds: ["llm-fail"],
			failureClassifications,
			skippedConfirmedInputsMissing: ["confirmed"],
		});
		mockSongAnalysisGet
			.mockResolvedValueOnce(Result.ok(new Map()))
			.mockResolvedValueOnce(Result.ok(new Map([["ok", { id: "a1" }]])));

		const outcome = expectAttempted(
			await runSongAnalysis(
				makeCtx(),
				makeBatch(["ok", "llm-fail", "confirmed"]),
			),
		);

		expect(outcome.succeededSongIds).toEqual(["ok"]);
		expect(outcome.attemptedSongIds).toEqual(["ok", "llm-fail", "confirmed"]);
		const byId = new Map(outcome.failures.map((f) => [f.songId, f]));
		expect(byId.get("llm-fail")?.failureCode).toBe("permanent");
		expect(byId.get("confirmed")?.failureCode).toBe("analysis_inputs_missing");
	});
});

describe("runSongAnalysis: pipeline config failure", () => {
	it("returns provider_unavailable for all ready songs when deps creation fails (e.g. missing API key)", async () => {
		const { PipelineConfigError } = await import(
			"@/lib/shared/errors/domain/analysis"
		);
		mockCreateSongBatchAnalyzerDeps.mockReturnValue(
			Result.err(new PipelineConfigError("Missing API key", "google")),
		);

		const outcome = expectAttempted(
			await runSongAnalysis(makeCtx(), makeBatch(["s1", "s2"])),
		);

		expect(outcome.failures).toHaveLength(2);
		for (const f of outcome.failures) {
			expect(f.failureCode).toBe("provider_unavailable");
		}
		expect(outcome.succeededSongIds).toEqual([]);
	});
});

describe("runSongAnalysis: does not import failure recording", () => {
	it("the module source does not import recordStageFailure or resolveJobStageFailures", async () => {
		const fs = await import("node:fs");
		const path = await import("node:path");
		const source = fs.readFileSync(
			path.resolve(__dirname, "../stages/song-analysis.ts"),
			"utf-8",
		);
		expect(source).not.toContain("recordStageFailure");
		expect(source).not.toContain("resolveJobStageFailures");
		expect(source).not.toContain("grantAnalysisFailureReplacementCredit");
		expect(source).not.toContain("createAdminSupabaseClient");
	});
});
