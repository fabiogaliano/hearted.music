/**
 * AnalysisPipeline - Orchestrates batch song/playlist analysis with job tracking.
 *
 * Responsibilities:
 * - Create and manage analysis jobs via data/jobs.ts
 * - Prefetch lyrics via LyricsService before analysis
 * - Orchestrate batch song analysis with concurrency control
 * - Report progress for SSE streaming (Phase 5)
 * - Finalize job status on completion or failure
 *
 * Merges functionality from old_app's:
 * - TrackPrefetchService (data prefetching)
 * - PlaylistBatchProcessor (batch orchestration)
 * - ProgressNotifier (progress reporting)
 *
 * Uses:
 * - LyricsService for lyrics fetching (Genius API)
 * - SongAnalysisService for individual song analysis
 * - PlaylistAnalysisService for playlist analysis
 * - data/jobs.ts for job lifecycle management
 * - Result<T, Error> for composable error handling
 */

import { Result } from "better-result";
import { z } from "zod";
import * as jobs from "@/lib/data/jobs";
import { startJob, finalizeJob } from "@/lib/services/job-lifecycle";
import * as songs from "@/lib/data/song";
import * as likedSongs from "@/lib/data/liked-song";
import * as songAnalysis from "@/lib/data/song-analysis";
import * as audioFeatures from "@/lib/data/song-audio-feature";
import type { DbError } from "@/lib/errors/database";
import type { JobProgress } from "@/lib/data/jobs";
import { SongAnalysisService, type AnalyzeSongInput } from "./song-analysis";
import { PlaylistAnalysisService, type AnalyzePlaylistInput } from "./playlist-analysis";
import { LlmService, type LlmProviderName } from "../llm/service";
import { LyricsService, type GeniusError } from "../lyrics/service";
import {
	NoLyricsAvailableError,
	PipelineConfigError,
} from "@/lib/errors/domain/analysis";

// Re-export error for consumers
export { PipelineConfigError };

// ============================================================================
// Zod Schemas (single source of truth)
// ============================================================================

/** Pipeline configuration (user-facing, partial) */
export const PipelineConfigSchema = z.object({
	/** Max concurrent LLM calls */
	concurrency: z.number().min(1).max(10).default(5),
	/** LLM provider to use */
	provider: z.enum(["google", "anthropic", "openai"]).default("google"),
});
export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;

/** Internal resolved config (includes API keys from env) */
const ResolvedConfigSchema = PipelineConfigSchema.extend({
	/** Resolved LLM API key */
	llmApiKey: z.string().min(1),
	/** Resolved Genius token (optional - lyrics will be skipped if not set) */
	geniusToken: z.string().optional(),
});
type ResolvedConfig = z.infer<typeof ResolvedConfigSchema>;

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

type PipelineError = DbError | GeniusError;

// ============================================================================
// Prefetch Cache
// ============================================================================

/**
 * Per-batch cache for prefetched lyrics.
 * Stores lyrics text or null for not-found songs.
 */
interface LyricsCacheEntry {
	lyrics: string | null;
	error?: GeniusError;
}

type LyricsCache = Map<string, LyricsCacheEntry>;

// ============================================================================
// Pipeline
// ============================================================================

export class AnalysisPipeline {
	private readonly config: ResolvedConfig;
	private readonly llm: LlmService;
	private readonly lyricsService: LyricsService | null;
	private readonly songAnalysis: SongAnalysisService;
	private readonly playlistAnalysis: PlaylistAnalysisService;

	/**
	 * Internal constructor - use createAnalysisPipeline() factory instead.
	 * This ensures env vars are read in the factory, not in the class.
	 * @internal
	 */
	constructor(config: ResolvedConfig) {
		this.config = config;
		this.llm = new LlmService({
			provider: config.provider,
			apiKey: config.llmApiKey,
		});
		this.songAnalysis = new SongAnalysisService(this.llm);
		this.playlistAnalysis = new PlaylistAnalysisService(this.llm);

		// Initialize lyrics service if token was provided
		this.lyricsService = config.geniusToken
			? new LyricsService({ accessToken: config.geniusToken })
			: null;
	}

	/**
	 * Runs song analysis pipeline for an account.
	 * Creates a job, prefetches lyrics, analyzes songs, and reports progress.
	 */
	async analyzeSongs(
		accountId: string,
		songsToAnalyze: SongToAnalyze[],
		onProgress?: ProgressCallback,
	): Promise<Result<PipelineResult, PipelineError>> {
		// 1. Create job (pending status)
		const jobResult = await jobs.createJob(accountId, "song_analysis");
		if (Result.isError(jobResult)) {
			return Result.err(jobResult.error);
		}
		const job = jobResult.value;

		// 2. Start job (pending → running, with cleanup on failure)
		const runningResult = await startJob(job.id);
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

		// 4. Prefetch lyrics + audio features in parallel
		const songIds = songsToAnalyze.map((s) => s.songId);

		const [lyricsCache, audioFeaturesResult] = await Promise.all([
			this.prefetchLyrics(songsToAnalyze),
			audioFeatures.getBatch(songIds),
		]);

		const audioFeaturesMap = Result.isOk(audioFeaturesResult)
			? audioFeaturesResult.value
			: new Map();

		// 5. Process songs with concurrency control
		const chunks = this.chunkArray(songsToAnalyze, this.config.concurrency);

		for (const chunk of chunks) {
			const promises = chunk.map(async (song) => {
				// Get lyrics from cache (may be null if not found)
				const cachedLyrics = lyricsCache.get(song.songId);
				const lyrics = cachedLyrics?.lyrics ?? song.lyrics;

				// Skip songs without lyrics (they can't be analyzed)
				if (!lyrics || lyrics.trim().length === 0) {
					const noGeniusError = new NoLyricsAvailableError(
						song.songId,
						song.artist,
						song.title,
					);
					console.warn(`[Pipeline] ${noGeniusError.message}`);
					return {
						songId: song.songId,
						result: Result.err(noGeniusError),
					};
				}

				const input: AnalyzeSongInput = {
					songId: song.songId,
					artist: song.artist,
					title: song.title,
					lyrics,
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

		// 6. Finalize job status
		const finalizeResult = await finalizeJob(
			job.id,
			progress,
			"All songs failed analysis",
		);
		if (Result.isError(finalizeResult)) {
			return Result.err(finalizeResult.error);
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
		// 1. Create job (pending status)
		const jobResult = await jobs.createJob(accountId, "playlist_analysis");
		if (Result.isError(jobResult)) {
			return Result.err(jobResult.error);
		}
		const job = jobResult.value;

		// 2. Start job (pending → running, with cleanup on failure)
		const runningResult = await startJob(job.id);
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

		// 6. Finalize job status
		const errorMsg = Result.isError(result)
			? this.extractErrorMessage(result.error)
			: undefined;

		const finalizeResult = await finalizeJob(job.id, progress, errorMsg);
		if (Result.isError(finalizeResult)) {
			return Result.err(finalizeResult.error);
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
		const likedSongsResult = await likedSongs.getAll(accountId);
		if (Result.isError(likedSongsResult)) {
			return Result.err(likedSongsResult.error);
		}

		// Apply limit
		const likedSongsList = likedSongsResult.value.slice(0, limit);
		if (likedSongsList.length === 0) {
			return Result.ok([]);
		}

		// 2. Get existing analyses
		const songIds = likedSongsList.map(ls => ls.song_id);
		const analysesResult = await songAnalysis.get(songIds);
		if (Result.isError(analysesResult)) {
			return Result.err(analysesResult.error);
		}

		const existingAnalyses = analysesResult.value;

		// 3. Filter to songs without analysis
		// Note: This returns songs that need analysis, but lyrics need to be fetched separately
		const needsAnalysis: SongToAnalyze[] = [];
		for (const likedSong of likedSongsList) {
			if (!existingAnalyses.has(likedSong.song_id)) {
				// Get song details
				const songResult = await songs.getById(likedSong.song_id);
				if (Result.isOk(songResult) && songResult.value) {
					const track = songResult.value;
					needsAnalysis.push({
						songId: track.id,
						artist: track.artists[0] ?? "Unknown Artist",
						title: track.name,
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
	 * Prefetches lyrics for all songs in the batch.
	 * Uses per-batch caching to avoid duplicate fetches.
	 *
	 * @returns Map of songId → lyrics (null if not found)
	 */
	private async prefetchLyrics(
		songsToAnalyze: SongToAnalyze[],
	): Promise<LyricsCache> {
		const cache: LyricsCache = new Map();

		// Skip if lyrics service not configured
		if (!this.lyricsService) {
			console.warn(
				"[Pipeline] GENIUS_CLIENT_TOKEN not set - skipping lyrics prefetch",
			);
			return cache;
		}

		// Fetch lyrics for songs that don't already have them
		const songsNeedingLyrics = songsToAnalyze.filter(
			(s) => !s.lyrics || s.lyrics.trim().length === 0,
		);

		if (songsNeedingLyrics.length === 0) {
			return cache;
		}

		// Fetch lyrics in parallel (LyricsService handles rate limiting internally)
		const fetchPromises = songsNeedingLyrics.map(async (song) => {
			try {
				const lyricsResult = await this.lyricsService!.getLyricsText(
					song.artist,
					song.title,
				);
				if (Result.isOk(lyricsResult)) {
					cache.set(song.songId, { lyrics: lyricsResult.value });
				} else {
					cache.set(song.songId, {
						lyrics: null,
						error: lyricsResult.error,
					});
				}
			} catch (error) {
				// Store null for not-found songs (don't retry)
				cache.set(song.songId, {
					lyrics: null,
					error: error as GeniusError,
				});
			}
		});

		await Promise.all(fetchPromises);

		return cache;
	}

	/**
	 * Updates job progress and calls callback.
	 */
	private async updateProgress(
		jobId: string,
		progress: JobProgress,
		onProgress?: ProgressCallback,
	): Promise<void> {
		const updateResult = await jobs.updateJobProgress(jobId, progress);
		if (Result.isError(updateResult)) {
			console.error(
				`[Pipeline] Failed to update job progress for ${jobId}: ${updateResult.error.message}`,
			);
		}
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

	/**
	 * Extracts error message from unknown error types.
	 */
	private extractErrorMessage(error: unknown): string {
		if (error instanceof Error) return error.message;
		if (typeof error === "string") return error;
		return String(error);
	}
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Gets API key for a provider from environment variables.
 * Pure function - no side effects, just reads env vars.
 */
function getApiKeyForProvider(provider: LlmProviderName): string | undefined {
	switch (provider) {
		case "google":
			return (
				process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GOOGLE_API_KEY
			);
		case "anthropic":
			return process.env.ANTHROPIC_API_KEY;
		case "openai":
			return process.env.OPENAI_API_KEY;
	}
}

/**
 * Creates an analysis pipeline with configuration from environment.
 * Returns Result instead of throwing for missing API keys.
 *
 * @example
 * ```ts
 * const pipelineResult = createAnalysisPipeline({ provider: "google" });
 * if (Result.isError(pipelineResult)) {
 *   console.error(pipelineResult.error.message);
 *   return;
 * }
 * const pipeline = pipelineResult.value;
 * ```
 */
export function createAnalysisPipeline(
	config?: Partial<PipelineConfig>,
): Result<AnalysisPipeline, PipelineConfigError> {
	// 1. Parse user config with defaults
	const parsed = PipelineConfigSchema.parse(config ?? {});

	// 2. Resolve LLM API key from environment
	const llmApiKey = getApiKeyForProvider(parsed.provider);
	if (!llmApiKey || llmApiKey.trim() === "") {
		return Result.err(
			new PipelineConfigError(
				"Missing API key. Please set the required environment variable.",
				parsed.provider,
			),
		);
	}

	// 3. Resolve optional Genius token
	const geniusToken = process.env.GENIUS_CLIENT_TOKEN;

	// 4. Build resolved config
	const resolvedConfig: ResolvedConfig = {
		...parsed,
		llmApiKey,
		geniusToken,
	};

	// 5. Create pipeline with resolved config
	return Result.ok(new AnalysisPipeline(resolvedConfig));
}
