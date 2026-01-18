/**
 * AnalysisPipeline - Orchestrates batch song/playlist analysis with job tracking.
 *
 * Responsibilities:
 * - Create and manage analysis jobs via data/jobs.ts
 * - Orchestrate batch song analysis with concurrency control
 * - Report progress for SSE streaming (Phase 5)
 * - Handle rate limiting with exponential backoff
 *
 * Merges functionality from old_app's:
 * - TrackPrefetchService (data prefetching)
 * - PlaylistBatchProcessor (batch orchestration)
 * - ProgressNotifier (progress reporting)
 *
 * Uses:
 * - SongAnalysisService for individual song analysis
 * - PlaylistAnalysisService for playlist analysis
 * - data/jobs.ts for job lifecycle management
 * - Result<T, Error> for composable error handling
 */

import { Result } from "better-result";
import { z } from "zod";
import * as jobs from "@/lib/data/jobs";
import * as songs from "@/lib/data/songs";
import * as analysis from "@/lib/data/analysis";
import type { DbError } from "@/lib/errors/data";
import type { JobProgress } from "@/lib/data/jobs";
import { SongAnalysisService, type AnalyzeSongInput } from "./song-analysis";
import { PlaylistAnalysisService, type AnalyzePlaylistInput } from "./playlist-analysis";
import { LlmService, type LlmProviderName } from "../llm/service";

// ============================================================================
// Zod Schemas (single source of truth)
// ============================================================================

/** Pipeline configuration */
export const PipelineConfigSchema = z.object({
	/** Max concurrent LLM calls */
	concurrency: z.number().min(1).max(10).default(5),
	/** Max retries per item */
	maxRetries: z.number().min(0).max(5).default(2),
	/** Base delay for exponential backoff (ms) */
	backoffBaseMs: z.number().min(100).max(5000).default(500),
	/** Max delay cap (ms) */
	backoffCapMs: z.number().min(1000).max(60000).default(30000),
	/** LLM provider to use */
	provider: z.enum(["google", "anthropic", "openai"]).default("google"),
});
export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;

/** Progress callback signature */
export type ProgressCallback = (progress: JobProgress) => void | Promise<void>;

// ============================================================================
// Types
// ============================================================================

/** Song to be analyzed */
export interface SongToAnalyze {
	songId: string;
	artist: string;
	title: string;
	lyrics: string;
}

/** Playlist to be analyzed */
export interface PlaylistToAnalyze {
	playlistId: string;
	name: string;
	description?: string;
	tracks: Array<{ name: string; artist: string }>;
}

/** Result of running the analysis pipeline */
export interface PipelineResult {
	jobId: string;
	succeeded: number;
	failed: number;
	total: number;
}

type PipelineError = DbError;

// ============================================================================
// Pipeline
// ============================================================================

export class AnalysisPipeline {
	private readonly config: PipelineConfig;
	private readonly llm: LlmService;
	private readonly songAnalysis: SongAnalysisService;
	private readonly playlistAnalysis: PlaylistAnalysisService;

	constructor(config: Partial<PipelineConfig> = {}) {
		this.config = PipelineConfigSchema.parse(config);
		this.llm = new LlmService({
			provider: this.config.provider,
			apiKey: this.getApiKey(this.config.provider),
		});
		this.songAnalysis = new SongAnalysisService(this.llm);
		this.playlistAnalysis = new PlaylistAnalysisService(this.llm);
	}

	/**
	 * Runs song analysis pipeline for an account.
	 * Creates a job, analyzes songs, and reports progress.
	 */
	async analyzeSongs(
		accountId: string,
		songsToAnalyze: SongToAnalyze[],
		onProgress?: ProgressCallback,
	): Promise<Result<PipelineResult, PipelineError>> {
		// 1. Create job
		const jobResult = await jobs.createJob(accountId, "song_analysis");
		if (Result.isError(jobResult)) {
			return Result.err(jobResult.error);
		}
		const job = jobResult.value;

		// 2. Mark job as running
		const runningResult = await jobs.markJobRunning(job.id);
		if (Result.isError(runningResult)) {
			return Result.err(runningResult.error);
		}

		// 3. Initialize progress
		const progress: JobProgress = {
			total: songsToAnalyze.length,
			done: 0,
			succeeded: 0,
			failed: 0,
		};

		await this.updateProgress(job.id, progress, onProgress);

		// 4. Prefetch audio features for all songs
		const songIds = songsToAnalyze.map(s => s.songId);
		const audioFeaturesResult = await analysis.getSongAudioFeaturesBatch(songIds);
		const audioFeaturesMap = Result.isOk(audioFeaturesResult)
			? audioFeaturesResult.value
			: new Map();

		// 5. Process songs with concurrency control
		const chunks = this.chunkArray(songsToAnalyze, this.config.concurrency);

		for (const chunk of chunks) {
			const promises = chunk.map(async (song) => {
				const input: AnalyzeSongInput = {
					songId: song.songId,
					artist: song.artist,
					title: song.title,
					lyrics: song.lyrics,
					audioFeatures: audioFeaturesMap.get(song.songId) ?? null,
				};

				const result = await this.songAnalysis.analyzeSong(input);
				return { songId: song.songId, result };
			});

			const results = await Promise.all(promises);

			// Update progress after each chunk
			for (const { result } of results) {
				progress.done++;
				if (Result.isOk(result)) {
					progress.succeeded++;
				} else {
					progress.failed++;
				}
			}

			await this.updateProgress(job.id, progress, onProgress);
		}

		// 6. Mark job as completed or failed
		if (progress.succeeded > 0) {
			await jobs.markJobCompleted(job.id);
		} else {
			await jobs.markJobFailed(job.id, "All songs failed analysis");
		}

		return Result.ok({
			jobId: job.id,
			succeeded: progress.succeeded,
			failed: progress.failed,
			total: progress.total,
		});
	}

	/**
	 * Runs playlist analysis pipeline.
	 * Creates a job and analyzes the playlist.
	 */
	async analyzePlaylist(
		accountId: string,
		playlist: PlaylistToAnalyze,
		onProgress?: ProgressCallback,
	): Promise<Result<PipelineResult, PipelineError>> {
		// 1. Create job
		const jobResult = await jobs.createJob(accountId, "playlist_analysis");
		if (Result.isError(jobResult)) {
			return Result.err(jobResult.error);
		}
		const job = jobResult.value;

		// 2. Mark job as running
		const runningResult = await jobs.markJobRunning(job.id);
		if (Result.isError(runningResult)) {
			return Result.err(runningResult.error);
		}

		// 3. Initialize progress
		const progress: JobProgress = {
			total: 1,
			done: 0,
			succeeded: 0,
			failed: 0,
		};

		await this.updateProgress(job.id, progress, onProgress);

		// 4. Analyze playlist
		const input: AnalyzePlaylistInput = {
			playlistId: playlist.playlistId,
			name: playlist.name,
			description: playlist.description,
			tracks: playlist.tracks,
		};

		const result = await this.playlistAnalysis.analyzePlaylist(input);

		// 5. Update progress
		progress.done = 1;
		if (Result.isOk(result)) {
			progress.succeeded = 1;
		} else {
			progress.failed = 1;
		}

		await this.updateProgress(job.id, progress, onProgress);

		// 6. Mark job as completed or failed
		if (Result.isOk(result)) {
			await jobs.markJobCompleted(job.id);
		} else {
			const errorMsg = result.error instanceof Error ? result.error.message : String(result.error);
			await jobs.markJobFailed(job.id, errorMsg);
		}

		return Result.ok({
			jobId: job.id,
			succeeded: progress.succeeded,
			failed: progress.failed,
			total: progress.total,
		});
	}

	/**
	 * Gets songs that need analysis for an account.
	 * Returns songs that don't have existing analysis.
	 */
	async getSongsNeedingAnalysis(
		accountId: string,
		limit = 100,
	): Promise<Result<SongToAnalyze[], PipelineError>> {
		// 1. Get liked songs for account
		const likedSongsResult = await songs.getLikedSongs(accountId);
		if (Result.isError(likedSongsResult)) {
			return Result.err(likedSongsResult.error);
		}

		// Apply limit
		const likedSongs = likedSongsResult.value.slice(0, limit);
		if (likedSongs.length === 0) {
			return Result.ok([]);
		}

		// 2. Get existing analyses
		const songIds = likedSongs.map(ls => ls.song_id);
		const analysesResult = await (analysis.getSongAnalysis(songIds) as unknown as
			Promise<Result<Map<string, analysis.SongAnalysis>, DbError>>);
		if (Result.isError(analysesResult)) {
			return Result.err(analysesResult.error);
		}

		const existingAnalyses = analysesResult.value;

		// 3. Filter to songs without analysis
		// Note: This returns songs that need analysis, but lyrics need to be fetched separately
		const needsAnalysis: SongToAnalyze[] = [];
		for (const likedSong of likedSongs) {
			if (!existingAnalyses.has(likedSong.song_id)) {
				// Get song details
				const songResult = await songs.getSongById(likedSong.song_id);
				if (Result.isOk(songResult) && songResult.value) {
					const song = songResult.value;
					needsAnalysis.push({
						songId: song.id,
						artist: song.artists[0] ?? "Unknown Artist",
						title: song.name,
						lyrics: "", // Lyrics need to be fetched separately (via lyrics service)
					});
				}
			}
		}

		return Result.ok(needsAnalysis);
	}

	// ============================================================================
	// Private Helpers
	// ============================================================================

	/**
	 * Gets API key for provider from environment.
	 */
	private getApiKey(provider: LlmProviderName): string {
		let key: string | undefined;
		switch (provider) {
			case "google":
				key = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GOOGLE_API_KEY;
				break;
			case "anthropic":
				key = process.env.ANTHROPIC_API_KEY;
				break;
			case "openai":
				key = process.env.OPENAI_API_KEY;
				break;
		}

		if (!key || key.trim() === "") {
			throw new Error(`Missing API key for LLM provider "${provider}". Please set the required environment variable.`);
		}

		return key;
	}

	/**
	 * Updates job progress and calls callback.
	 */
	private async updateProgress(
		jobId: string,
		progress: JobProgress,
		onProgress?: ProgressCallback,
	): Promise<void> {
		await jobs.updateJobProgress(jobId, progress);
		if (onProgress) {
			await onProgress(progress);
		}
	}

	/**
	 * Splits array into chunks for concurrency control.
	 */
	private chunkArray<T>(array: T[], size: number): T[][] {
		const chunks: T[][] = [];
		for (let i = 0; i < array.length; i += size) {
			chunks.push(array.slice(i, i + size));
		}
		return chunks;
	}
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Creates an analysis pipeline with default configuration.
 */
export function createAnalysisPipeline(
	config?: Partial<PipelineConfig>,
): AnalysisPipeline {
	return new AnalysisPipeline(config);
}
