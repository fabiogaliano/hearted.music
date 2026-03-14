import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Result } from "better-result";
import type { EnrichmentStageResult } from "../types";
import type { PipelineBatch } from "../batch";

vi.mock("@/lib/domains/enrichment/embeddings/service", () => ({
	EmbeddingService: vi.fn(),
}));

vi.mock("@/lib/domains/taste/playlist-profiling/service", () => ({
	createPlaylistProfilingService: vi.fn(() => ({ fake: "profilingService" })),
}));

vi.mock("../batch", () => ({
	selectPipelineBatch: vi.fn(),
}));

vi.mock("../stages/audio-features", () => ({
	runAudioFeaturesStage: vi.fn(),
}));

vi.mock("../stages/song-analysis", () => ({
	runSongAnalysisStage: vi.fn(),
}));

vi.mock("../stages/song-embedding", () => ({
	runSongEmbeddingStage: vi.fn(),
}));

vi.mock("../stages/playlist-profiling", () => ({
	runPlaylistProfilingStage: vi.fn(),
}));

vi.mock("../stages/genre-tagging", () => ({
	runGenreTaggingStage: vi.fn(),
}));

vi.mock("../stages/matching", () => ({
	runMatchingStage: vi.fn(),
}));

vi.mock("@/lib/domains/library/playlists/queries", () => ({
	getDestinationPlaylists: vi.fn(),
}));

import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { createPlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";
import { selectPipelineBatch } from "../batch";
import { runAudioFeaturesStage } from "../stages/audio-features";
import { runSongAnalysisStage } from "../stages/song-analysis";
import { runSongEmbeddingStage } from "../stages/song-embedding";
import { runPlaylistProfilingStage } from "../stages/playlist-profiling";
import { runGenreTaggingStage } from "../stages/genre-tagging";
import { runMatchingStage } from "../stages/matching";
import { getDestinationPlaylists } from "@/lib/domains/library/playlists/queries";
import {
	runEnrichmentPipeline,
	runSongEnrichment,
	runDestinationProfiling,
	runMatching,
} from "../orchestrator";

const mockEmbeddingService = EmbeddingService as unknown as ReturnType<
	typeof vi.fn
>;
const mockCreateProfilingService =
	createPlaylistProfilingService as unknown as ReturnType<typeof vi.fn>;
const mockSelectBatch = selectPipelineBatch as ReturnType<typeof vi.fn>;

const mockAudioFeatures = runAudioFeaturesStage as ReturnType<typeof vi.fn>;
const mockSongAnalysis = runSongAnalysisStage as ReturnType<typeof vi.fn>;
const mockSongEmbedding = runSongEmbeddingStage as ReturnType<typeof vi.fn>;
const mockPlaylistProfiling = runPlaylistProfilingStage as ReturnType<
	typeof vi.fn
>;
const mockGenreTagging = runGenreTaggingStage as ReturnType<typeof vi.fn>;
const mockMatching = runMatchingStage as ReturnType<typeof vi.fn>;
const mockGetDestinationPlaylists = getDestinationPlaylists as ReturnType<
	typeof vi.fn
>;

const fakeBatch: PipelineBatch = {
	songIds: ["s1", "s2"],
	songs: [
		{
			id: "s1",
			spotify_id: "sp1",
			name: "Song 1",
			artists: ["Artist 1"],
			genres: [],
		} as any,
		{
			id: "s2",
			spotify_id: "sp2",
			name: "Song 2",
			artists: ["Artist 2"],
			genres: [],
		} as any,
	],
	spotifyIdBySongId: new Map([
		["s1", "sp1"],
		["s2", "sp2"],
	]),
};

function completedResult(
	stage: EnrichmentStageResult["stage"],
	jobId: string | null = `job-${stage}`,
): EnrichmentStageResult {
	return {
		stage,
		status: "completed",
		jobId,
		succeeded: 1,
		failed: 0,
		notReady: 0,
		done: 0,
	};
}

const fakePlaylists = [
	{ id: "pl1", name: "Chill" } as any,
	{ id: "pl2", name: "Energy" } as any,
];

function profilingOutput(
	result: EnrichmentStageResult = completedResult("playlist_profiling"),
	playlists = fakePlaylists,
) {
	return { result, playlists };
}

function setupAllStagesCompleted() {
	mockAudioFeatures.mockResolvedValue(completedResult("audio_features"));
	mockGenreTagging.mockResolvedValue(completedResult("genre_tagging"));
	mockSongAnalysis.mockResolvedValue(completedResult("song_analysis"));
	mockSongEmbedding.mockResolvedValue(completedResult("song_embedding"));
	mockPlaylistProfiling.mockResolvedValue(profilingOutput());
	mockMatching.mockResolvedValue(completedResult("matching"));
}

describe("runSongEnrichment", () => {
	const savedEnv = process.env;

	beforeEach(() => {
		vi.restoreAllMocks();
		process.env = { ...savedEnv };
		delete process.env.PIPELINE_BATCH_SIZE;
		delete process.env.PIPELINE_MAX_SONGS;

		mockEmbeddingService.mockImplementation(() => ({
			fake: "embeddingService",
		}));
		mockCreateProfilingService.mockReturnValue({
			fake: "profilingService",
		});
		mockSelectBatch.mockResolvedValue(fakeBatch);
	});

	afterEach(() => {
		process.env = savedEnv;
	});

	it("runs only 4 song-side stages in dependency order", async () => {
		const callOrder: string[] = [];

		mockAudioFeatures.mockImplementation(async () => {
			callOrder.push("audio_features");
			return completedResult("audio_features");
		});
		mockGenreTagging.mockImplementation(async () => {
			callOrder.push("genre_tagging");
			return completedResult("genre_tagging");
		});
		mockSongAnalysis.mockImplementation(async () => {
			callOrder.push("song_analysis");
			return completedResult("song_analysis");
		});
		mockSongEmbedding.mockImplementation(async () => {
			callOrder.push("song_embedding");
			return completedResult("song_embedding");
		});

		const result = await runSongEnrichment("acct-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.stages).toHaveLength(4);

		const afIdx = callOrder.indexOf("audio_features");
		const gtIdx = callOrder.indexOf("genre_tagging");
		const saIdx = callOrder.indexOf("song_analysis");
		const seIdx = callOrder.indexOf("song_embedding");

		expect(afIdx).toBeLessThan(saIdx);
		expect(gtIdx).toBeLessThan(saIdx);
		expect(saIdx).toBeLessThan(seIdx);

		// Does not call destination stages
		expect(mockPlaylistProfiling).not.toHaveBeenCalled();
		expect(mockMatching).not.toHaveBeenCalled();
	});

	it("returns early with 4 skipped stages on empty batch", async () => {
		mockSelectBatch.mockResolvedValue({
			songIds: [],
			songs: [],
			spotifyIdBySongId: new Map(),
		});

		const result = await runSongEnrichment("acct-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.stages).toHaveLength(4);
		for (const stage of result.value.stages) {
			expect(stage.status).toBe("skipped");
			if (stage.status === "skipped") {
				expect(stage.reason).toBe("empty batch");
			}
		}
	});

	it("respects batchSize option", async () => {
		setupAllStagesCompleted();

		await runSongEnrichment("acct-1", { batchSize: 42 });

		expect(mockSelectBatch).toHaveBeenCalledWith("acct-1", 42);
	});

	it("returns PipelineBootstrapError when EmbeddingService throws", async () => {
		mockEmbeddingService.mockImplementation(() => {
			throw new Error("missing API key");
		});

		const result = await runSongEnrichment("acct-1");

		expect(Result.isError(result)).toBe(true);
		if (!Result.isError(result)) return;
		expect(result.error._tag).toBe("PipelineBootstrapError");
	});
});

describe("runDestinationProfiling", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		mockEmbeddingService.mockImplementation(() => ({
			fake: "embeddingService",
		}));
		mockCreateProfilingService.mockReturnValue({
			fake: "profilingService",
		});
	});

	it("runs only playlist_profiling stage", async () => {
		mockPlaylistProfiling.mockResolvedValue(profilingOutput());

		const result = await runDestinationProfiling("acct-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.stages).toHaveLength(1);
		expect(result.value.stages[0].stage).toBe("playlist_profiling");
		expect(result.value.stages[0].status).toBe("completed");

		expect(mockAudioFeatures).not.toHaveBeenCalled();
		expect(mockMatching).not.toHaveBeenCalled();
	});

	it("catches profiling errors and returns failed stage", async () => {
		mockPlaylistProfiling.mockRejectedValue(new Error("profiling boom"));

		const result = await runDestinationProfiling("acct-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.stages[0].status).toBe("failed");
		if (result.value.stages[0].status === "failed") {
			expect(result.value.stages[0].error).toBe("profiling boom");
		}
	});
});

describe("runMatching", () => {
	const savedEnv = process.env;

	beforeEach(() => {
		vi.restoreAllMocks();
		process.env = { ...savedEnv };
		delete process.env.PIPELINE_BATCH_SIZE;
		delete process.env.PIPELINE_MAX_SONGS;

		mockEmbeddingService.mockImplementation(() => ({
			fake: "embeddingService",
		}));
		mockCreateProfilingService.mockReturnValue({
			fake: "profilingService",
		});
		mockSelectBatch.mockResolvedValue(fakeBatch);
		mockGetDestinationPlaylists.mockResolvedValue(Result.ok(fakePlaylists));
	});

	afterEach(() => {
		process.env = savedEnv;
	});

	it("runs only matching stage with loaded playlists", async () => {
		mockMatching.mockResolvedValue(completedResult("matching"));

		const result = await runMatching("acct-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.stages).toHaveLength(1);
		expect(result.value.stages[0].stage).toBe("matching");

		expect(mockMatching).toHaveBeenCalledWith(
			expect.objectContaining({ accountId: "acct-1" }),
			fakeBatch,
			fakePlaylists,
		);

		expect(mockAudioFeatures).not.toHaveBeenCalled();
		expect(mockPlaylistProfiling).not.toHaveBeenCalled();
	});

	it("returns a failed matching stage when getDestinationPlaylists fails", async () => {
		mockGetDestinationPlaylists.mockResolvedValue(
			Result.err({ _tag: "DbError", message: "db error" }),
		);

		const result = await runMatching("acct-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.stages).toEqual([
			{
				stage: "matching",
				status: "failed",
				jobId: null,
				error: "Failed to get destination playlists: db error",
			},
		]);
		expect(mockMatching).not.toHaveBeenCalled();
	});
});

describe("runEnrichmentPipeline", () => {
	const savedEnv = process.env;

	beforeEach(() => {
		vi.restoreAllMocks();
		process.env = { ...savedEnv };
		delete process.env.PIPELINE_BATCH_SIZE;
		delete process.env.PIPELINE_MAX_SONGS;

		mockEmbeddingService.mockImplementation(() => ({
			fake: "embeddingService",
		}));
		mockCreateProfilingService.mockReturnValue({
			fake: "profilingService",
		});
		mockSelectBatch.mockResolvedValue(fakeBatch);
		mockGetDestinationPlaylists.mockResolvedValue(Result.ok(fakePlaylists));
	});

	afterEach(() => {
		process.env = savedEnv;
	});

	it("runs all 6 stages in sequential composition order", async () => {
		const callOrder: string[] = [];

		mockAudioFeatures.mockImplementation(async () => {
			callOrder.push("audio_features");
			return completedResult("audio_features");
		});
		mockGenreTagging.mockImplementation(async () => {
			callOrder.push("genre_tagging");
			return completedResult("genre_tagging");
		});
		mockPlaylistProfiling.mockImplementation(async () => {
			callOrder.push("playlist_profiling");
			return profilingOutput();
		});
		mockSongAnalysis.mockImplementation(async () => {
			callOrder.push("song_analysis");
			return completedResult("song_analysis");
		});
		mockSongEmbedding.mockImplementation(async () => {
			callOrder.push("song_embedding");
			return completedResult("song_embedding");
		});
		mockMatching.mockImplementation(async () => {
			callOrder.push("matching");
			return completedResult("matching");
		});

		const result = await runEnrichmentPipeline("acct-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		// Song stages before destination stages
		const afIdx = callOrder.indexOf("audio_features");
		const gtIdx = callOrder.indexOf("genre_tagging");
		const saIdx = callOrder.indexOf("song_analysis");
		const seIdx = callOrder.indexOf("song_embedding");
		const ppIdx = callOrder.indexOf("playlist_profiling");
		const mIdx = callOrder.indexOf("matching");

		expect(afIdx).toBeLessThan(saIdx);
		expect(gtIdx).toBeLessThan(saIdx);
		expect(saIdx).toBeLessThan(seIdx);
		expect(seIdx).toBeLessThan(ppIdx);
		expect(ppIdx).toBeLessThan(mIdx);

		expect(result.value.stages).toHaveLength(6);
	});

	it("passes batch to song stages and ctx-only to playlist_profiling", async () => {
		setupAllStagesCompleted();

		await runEnrichmentPipeline("acct-1");

		// Song stages receive (ctx, batch)
		expect(mockAudioFeatures.mock.calls[0]).toHaveLength(2);
		expect(mockAudioFeatures.mock.calls[0][1]).toBe(fakeBatch);
		expect(mockGenreTagging.mock.calls[0]).toHaveLength(2);
		expect(mockGenreTagging.mock.calls[0][1]).toBe(fakeBatch);
		expect(mockSongAnalysis.mock.calls[0][1]).toBe(fakeBatch);
		expect(mockSongEmbedding.mock.calls[0][1]).toBe(fakeBatch);

		// Playlist profiling receives only ctx
		expect(mockPlaylistProfiling.mock.calls[0]).toHaveLength(1);
	});

	it("respects batchSize option", async () => {
		setupAllStagesCompleted();

		await runEnrichmentPipeline("acct-1", { batchSize: 42 });

		expect(mockSelectBatch).toHaveBeenCalledWith("acct-1", 42);
	});

	it("prefers PIPELINE_BATCH_SIZE env var over options.batchSize", async () => {
		setupAllStagesCompleted();
		process.env.PIPELINE_BATCH_SIZE = "99";

		await runEnrichmentPipeline("acct-1", { batchSize: 10 });

		expect(mockSelectBatch).toHaveBeenCalledWith("acct-1", 99);
	});

	it("falls back to PIPELINE_MAX_SONGS env var", async () => {
		setupAllStagesCompleted();
		process.env.PIPELINE_MAX_SONGS = "77";

		await runEnrichmentPipeline("acct-1", { batchSize: 10 });

		expect(mockSelectBatch).toHaveBeenCalledWith("acct-1", 77);
	});

	it("defaults batchSize to 5 when no option or env var", async () => {
		setupAllStagesCompleted();

		await runEnrichmentPipeline("acct-1");

		expect(mockSelectBatch).toHaveBeenCalledWith("acct-1", 5);
	});

	it("returns early with all 6 skipped if batch is empty", async () => {
		mockSelectBatch.mockResolvedValue({
			songIds: [],
			songs: [],
			spotifyIdBySongId: new Map(),
		});

		const result = await runEnrichmentPipeline("acct-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.stages).toHaveLength(6);
		for (const stage of result.value.stages) {
			expect(stage.status).toBe("skipped");
		}

		expect(mockAudioFeatures).not.toHaveBeenCalled();
		expect(mockSongAnalysis).not.toHaveBeenCalled();
		expect(mockPlaylistProfiling).not.toHaveBeenCalled();
		expect(mockMatching).not.toHaveBeenCalled();
	});

	it("continues running subsequent stages when an earlier stage throws", async () => {
		mockAudioFeatures.mockRejectedValue(new Error("audio boom"));
		mockGenreTagging.mockResolvedValue(completedResult("genre_tagging"));
		mockPlaylistProfiling.mockResolvedValue(profilingOutput());
		mockSongAnalysis.mockResolvedValue(completedResult("song_analysis"));
		mockSongEmbedding.mockRejectedValue(new Error("embedding boom"));
		mockMatching.mockResolvedValue(completedResult("matching"));

		const result = await runEnrichmentPipeline("acct-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.stages).toHaveLength(6);

		const byStage = new Map(result.value.stages.map((s) => [s.stage, s]));

		expect(byStage.get("audio_features")!.status).toBe("failed");
		expect(byStage.get("genre_tagging")!.status).toBe("completed");
		expect(byStage.get("playlist_profiling")!.status).toBe("completed");
		expect(byStage.get("song_analysis")!.status).toBe("completed");
		expect(byStage.get("song_embedding")!.status).toBe("failed");
		expect(byStage.get("matching")!.status).toBe("completed");

		const audio = byStage.get("audio_features")!;
		expect(audio.status === "failed" && audio.error).toBe("audio boom");
	});

	it("returns PipelineBootstrapError when EmbeddingService constructor throws", async () => {
		mockEmbeddingService.mockImplementation(() => {
			throw new Error("missing API key");
		});

		const result = await runEnrichmentPipeline("acct-1");

		expect(Result.isError(result)).toBe(true);
		if (!Result.isError(result)) return;

		expect(result.error._tag).toBe("PipelineBootstrapError");
		expect(result.error.message).toBe("Failed to initialize EmbeddingService");

		expect(mockAudioFeatures).not.toHaveBeenCalled();
	});

	it("collects jobIds from completed and failed stages into stageJobIds", async () => {
		mockAudioFeatures.mockResolvedValue(
			completedResult("audio_features", "job-af-123"),
		);
		mockGenreTagging.mockResolvedValue(completedResult("genre_tagging"));
		mockPlaylistProfiling.mockRejectedValue(new Error("profiling error"));
		mockSongAnalysis.mockResolvedValue({
			stage: "song_analysis",
			status: "skipped",
		} satisfies EnrichmentStageResult);
		mockSongEmbedding.mockResolvedValue(
			completedResult("song_embedding", null),
		);
		mockMatching.mockResolvedValue({
			stage: "matching",
			status: "failed",
			jobId: "job-match-456",
			error: "partial failure",
			succeeded: 0,
			failed: 3,
		} satisfies EnrichmentStageResult);

		const result = await runEnrichmentPipeline("acct-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		const { stageJobIds } = result.value;

		expect(stageJobIds.audio_features).toBe("job-af-123");
		expect(stageJobIds.matching).toBe("job-match-456");

		expect(stageJobIds.song_analysis).toBeUndefined();
		expect(stageJobIds.song_embedding).toBeUndefined();
		expect(stageJobIds.playlist_profiling).toBeUndefined();
	});

	it("does not run destination stages when batch is empty", async () => {
		mockSelectBatch.mockResolvedValue({
			songIds: [],
			songs: [],
			spotifyIdBySongId: new Map(),
		});

		const result = await runEnrichmentPipeline("acct-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.stages).toHaveLength(6);

		const profiling = result.value.stages.find(
			(s) => s.stage === "playlist_profiling",
		);
		const matching = result.value.stages.find((s) => s.stage === "matching");

		expect(profiling?.status).toBe("skipped");
		expect(matching?.status).toBe("skipped");
		if (profiling?.status === "skipped") {
			expect(profiling.reason).toBe("empty batch");
		}

		expect(mockPlaylistProfiling).not.toHaveBeenCalled();
		expect(mockMatching).not.toHaveBeenCalled();
	});

	it("provides profilingService in context for bootstrap behavior", async () => {
		setupAllStagesCompleted();

		await runEnrichmentPipeline("acct-1");

		const ctx = mockPlaylistProfiling.mock.calls[0][0];
		expect(ctx.profilingService).toBeDefined();
		expect(ctx.profilingService).toEqual({ fake: "profilingService" });
	});

	it("records totalDurationMs", async () => {
		setupAllStagesCompleted();

		const result = await runEnrichmentPipeline("acct-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(typeof result.value.totalDurationMs).toBe("number");
		expect(result.value.totalDurationMs).toBeGreaterThanOrEqual(0);
	});

	it("includes reason on skipped stages when batch is empty", async () => {
		mockSelectBatch.mockResolvedValue({
			songIds: [],
			songs: [],
			spotifyIdBySongId: new Map(),
		});

		const result = await runEnrichmentPipeline("acct-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		for (const stage of result.value.stages) {
			expect(stage.status).toBe("skipped");
			if (stage.status === "skipped") {
				expect(stage.reason).toBe("empty batch");
			}
		}
	});
});
