import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { grantAnalysisFailureReplacementCredit } from "@/lib/domains/billing/compensation";
import { getAudioFeatureAvailability } from "@/lib/domains/enrichment/audio-feature-backfill/jobs";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { detectLanguageForSongs } from "@/lib/domains/enrichment/language-detection/service";
import { resolveVocalGenderForSongs } from "@/lib/domains/enrichment/vocal-gender/service";
import { createPlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";
import type { LlmService } from "@/lib/integrations/llm/service";
import { createLlmService } from "@/lib/integrations/llm/service";
import { log } from "@/lib/observability/logger";
import type {
	EnrichmentChunkProgress,
	EnrichmentSelectionMode,
} from "@/lib/platform/jobs/progress/enrichment";
import { updateJobProgress } from "@/lib/platform/jobs/repository";
import {
	getEntitledDataEnrichedSongIds,
	hasMoreSongsNeedingEnrichmentWork,
	loadBatchSongs,
	type PipelineBatch,
	selectEnrichmentWorkPlan,
} from "./batch";
import { FAILURE_CODES } from "./failure-policy";
import {
	type InitializedEnrichmentChunkProgress,
	makeInitialProgress,
} from "./progress";
import { runStageWithAccounting } from "./stage-accounting";
import { StageAccountingError, type StageSummary } from "./stage-outcomes";
import { runAudioFeatures } from "./stages/audio-features";
import { runContentActivation } from "./stages/content-activation";
import { runGenreTagging } from "./stages/genre-tagging";
import { runSongAnalysis } from "./stages/song-analysis";
import { runSongEmbedding } from "./stages/song-embedding";
import {
	type EnrichmentContext,
	type EnrichmentStageName,
	type EnrichmentWorkPlan,
	PipelineBootstrapError,
} from "./types";

function initLlmService(): LlmService | undefined {
	try {
		return createLlmService();
	} catch {
		return undefined;
	}
}

function buildContext(
	accountId: string,
	embeddingService: EmbeddingService,
): EnrichmentContext {
	const llmService = initLlmService();

	return {
		accountId,
		embeddingService,
		profilingService: createPlaylistProfilingService(
			embeddingService,
			llmService,
		),
		llmService,
	};
}

function applyStageSummary(
	progress: InitializedEnrichmentChunkProgress,
	stageName: EnrichmentStageName,
	summary: StageSummary,
	status: "completed" | "failed" | "skipped",
): void {
	progress.stages[stageName] = {
		status,
		succeeded: summary.succeeded,
		failed: summary.failed,
	};
	progress.succeeded += summary.succeeded;
	progress.failed += summary.failed;
	// Deferred songs (e.g. audio-feature backfill in flight) count as handled so a
	// pure-deferred chunk reports done > 0 and isn't classified as a blocked hot
	// loop, but they are neither successes nor failures.
	progress.done += summary.succeeded + summary.failed + summary.deferred;
}

async function persistProgress(
	jobId: string,
	progress: EnrichmentChunkProgress,
): Promise<void> {
	const result = await updateJobProgress(jobId, progress);
	if (Result.isError(result)) {
		log.error("persist-progress-failed", {
			jobId,
			error: result.error.message,
		});
	}
}

function stageStatus(summary: StageSummary): "completed" | "failed" {
	return summary.failed > 0 && summary.succeeded === 0 ? "failed" : "completed";
}

function filterBatch(batch: PipelineBatch, songIds: string[]): PipelineBatch {
	const idSet = new Set(songIds);
	return {
		songIds: batch.songIds.filter((id) => idSet.has(id)),
		songs: batch.songs.filter((s) => idSet.has(s.id)),
		spotifyIdBySongId: new Map(
			[...batch.spotifyIdBySongId].filter(([id]) => idSet.has(id)),
		),
	};
}

/**
 * Returns the subset of `batchIds` that are entitled and data-enriched
 * (ready for matching), per the canonical selector.
 *
 * Readiness + entitlement is defined once, in the RPC
 * `select_entitled_data_enriched_liked_song_ids`. That selector is account-wide,
 * so we intersect its result with the current batch to answer "did THIS batch
 * make any *entitled* song newly matchable?". Routing through the RPC is what
 * applies the entitlement gate — a locked or revoked song that just gained an
 * embedding is correctly NOT counted as a new candidate.
 */
async function loadEntitledReadyInBatch(
	accountId: string,
	batchIds: Set<string>,
): Promise<Set<string>> {
	if (batchIds.size === 0) {
		return new Set();
	}

	const entitledReady = await getEntitledDataEnrichedSongIds(accountId, [
		...batchIds,
	]);
	return new Set(entitledReady.filter((songId) => batchIds.has(songId)));
}

/**
 * Grants a replacement credit for each song that failed song_analysis with
 * analysis_inputs_missing. The underlying RPC is idempotent, so re-running a
 * chunk never double-grants. Throws a StageAccountingError (phase
 * "compensation") on RPC failure, matching the prior in-accounting behavior of
 * aborting the chunk so the failure surfaces.
 */
async function compensateAnalysisInputsMissing(
	accountId: string,
	songIds: string[],
): Promise<void> {
	if (songIds.length === 0) return;

	const client = createAdminSupabaseClient();
	for (const songId of songIds) {
		const result = await grantAnalysisFailureReplacementCredit(client, {
			accountId,
			songId,
			failureCode: FAILURE_CODES.ANALYSIS_INPUTS_MISSING,
		});
		if (Result.isError(result)) {
			throw new StageAccountingError({
				stage: "song_analysis",
				phase: "compensation",
				cause: result.error,
				message: `Compensation failed for song ${songId} in stage song_analysis`,
			});
		}
	}
}

/**
 * Post-Phase-A gate: the work plan's needAnalysis list was computed before Phase
 * A, so a song that was `absent` then and got an audio-feature backfill job
 * enqueued *this chunk* is now `backfill_active` but still on the list. Re-read
 * availability and drop those so LLM analysis waits for the backfill instead of
 * running too early. Fails open so an availability read error never stalls
 * analysis.
 */
async function gateAnalysisOnAudioBackfill(
	songIds: string[],
): Promise<string[]> {
	if (songIds.length === 0) return songIds;

	const availabilityResult = await getAudioFeatureAvailability(songIds);
	if (Result.isError(availabilityResult)) {
		log.warn("analysis-audio-gate-unavailable", {
			error: availabilityResult.error.message,
		});
		return songIds;
	}

	const deferred = new Set(
		availabilityResult.value
			.filter((a) => a.state === "backfill_active")
			.map((a) => a.songId),
	);
	if (deferred.size === 0) return songIds;

	log.info("analysis-deferred-for-audio-backfill", { count: deferred.size });
	return songIds.filter((id) => !deferred.has(id));
}

// --- Song enrichment phases (A-C) ---

async function enrichSongs(
	ctx: EnrichmentContext,
	workPlan: EnrichmentWorkPlan,
	batch: PipelineBatch,
	jobId: string,
	progress: InitializedEnrichmentChunkProgress,
): Promise<void> {
	// Phase A: audio_features + genre_tagging (parallel, entitled songs only)
	progress.currentStage = "audio_features";
	progress.stages.audio_features.status = "running";
	progress.stages.genre_tagging.status = "running";
	await persistProgress(jobId, progress);

	const audioSubBatch = filterBatch(batch, workPlan.needAudioFeatures);
	const genreSubBatch = filterBatch(batch, workPlan.needGenreTagging);

	// Vocal-gender resolution (local MusicBrainz dump -> Wikidata fallback) runs
	// alongside the other cheap Phase-A steps. It's catalog metadata, not gated
	// per-song work, so it's best-effort (never throws) and isn't accounted —
	// awaited before Phase B only so song.vocal_gender is settled for matching.
	const vocalGenderResolution = resolveVocalGenderForSongs(batch.songs);

	const emptyAccounting = Promise.resolve(
		Result.ok<StageSummary, StageAccountingError>({
			total: 0,
			succeeded: 0,
			failed: 0,
			deferred: 0,
		}),
	);

	const [audioAccountingResult, genreAccountingResult] = await Promise.all([
		audioSubBatch.songIds.length > 0
			? runStageWithAccounting({
					stage: "audio_features",
					candidateSongIds: audioSubBatch.songIds,
					jobId,
					accountId: ctx.accountId,
					run: () => runAudioFeatures(ctx, audioSubBatch),
				})
			: emptyAccounting,
		genreSubBatch.songIds.length > 0
			? runStageWithAccounting({
					stage: "genre_tagging",
					candidateSongIds: genreSubBatch.songIds,
					jobId,
					accountId: ctx.accountId,
					run: () => runGenreTagging(ctx, genreSubBatch),
				})
			: emptyAccounting,
	]);

	if (Result.isError(audioAccountingResult)) {
		log.error("stage-accounting-failed", {
			stage: "audio_features",
			jobId,
			accountId: ctx.accountId,
			error: audioAccountingResult.error,
		});
		throw audioAccountingResult.error;
	}

	if (Result.isError(genreAccountingResult)) {
		log.error("stage-accounting-failed", {
			stage: "genre_tagging",
			jobId,
			accountId: ctx.accountId,
			error: genreAccountingResult.error,
		});
		throw genreAccountingResult.error;
	}

	const audioResult: StageSummary = audioAccountingResult.value;
	const genreResult: StageSummary = genreAccountingResult.value;

	applyStageSummary(
		progress,
		"audio_features",
		audioResult,
		audioSubBatch.songIds.length > 0 ? stageStatus(audioResult) : "skipped",
	);
	applyStageSummary(
		progress,
		"genre_tagging",
		genreResult,
		genreSubBatch.songIds.length > 0 ? stageStatus(genreResult) : "skipped",
	);

	await vocalGenderResolution;

	// Phase B: song_analysis (entitled only)
	progress.currentStage = "song_analysis";
	progress.stages.song_analysis.status = "running";
	await persistProgress(jobId, progress);

	const analysisReadySongIds = await gateAnalysisOnAudioBackfill(
		workPlan.needAnalysis,
	);
	const analysisSubBatch = filterBatch(batch, analysisReadySongIds);
	// Capture analysis_inputs_missing failures so the orchestrator can grant
	// replacement credits once the accounting layer has durably recorded the
	// failure rows. A thrown stage yields PROVIDER_TRANSIENT failures (never
	// this code), so the capture only fires on the normal outcome path.
	let analysisInputsMissingSongIds: string[] = [];
	const analysisAccountingResult =
		analysisSubBatch.songIds.length > 0
			? await runStageWithAccounting({
					stage: "song_analysis",
					candidateSongIds: analysisSubBatch.songIds,
					jobId,
					accountId: ctx.accountId,
					fallbackCode: FAILURE_CODES.PROVIDER_TRANSIENT,
					run: async () => {
						const outcome = await runSongAnalysis(ctx, analysisSubBatch);
						if (outcome.kind === "attempted") {
							analysisInputsMissingSongIds = outcome.failures
								.filter(
									(f) =>
										f.failureCode === FAILURE_CODES.ANALYSIS_INPUTS_MISSING,
								)
								.map((f) => f.songId);
						}
						return outcome;
					},
				})
			: await emptyAccounting;

	if (Result.isError(analysisAccountingResult)) {
		log.error("stage-accounting-failed", {
			stage: "song_analysis",
			jobId,
			accountId: ctx.accountId,
			error: analysisAccountingResult.error,
		});
		throw analysisAccountingResult.error;
	}

	// Accounting succeeded, so the failure rows are recorded — grant replacement
	// credits for the captured analysis_inputs_missing failures.
	await compensateAnalysisInputsMissing(
		ctx.accountId,
		analysisInputsMissingSongIds,
	);

	const analysisResult: StageSummary = analysisAccountingResult.value;

	applyStageSummary(
		progress,
		"song_analysis",
		analysisResult,
		analysisSubBatch.songIds.length > 0
			? stageStatus(analysisResult)
			: "skipped",
	);

	// Lyric-language detection (eld, offline) runs after analysis because that's
	// the stage that fetches & stores lyrics — so this chunk's freshly-stored
	// lyrics are detectable now. Best-effort and not accounted (app metadata, not
	// a matching gate); kicked off here so it overlaps embedding + activation.
	// Still await it in finally so the chunk never leaves detached work behind.
	const languageDetection = detectLanguageForSongs(batch.songIds);

	try {
		// Phase C: song_embedding (entitled only)
		progress.currentStage = "song_embedding";
		progress.stages.song_embedding.status = "running";
		await persistProgress(jobId, progress);

		const embeddingSubBatch = filterBatch(batch, workPlan.needEmbedding);
		const embeddingAccountingResult =
			embeddingSubBatch.songIds.length > 0
				? await runStageWithAccounting({
						stage: "song_embedding",
						candidateSongIds: embeddingSubBatch.songIds,
						jobId,
						accountId: ctx.accountId,
						fallbackCode: FAILURE_CODES.PROVIDER_TRANSIENT,
						run: () => runSongEmbedding(ctx, embeddingSubBatch),
					})
				: await emptyAccounting;

		if (Result.isError(embeddingAccountingResult)) {
			log.error("stage-accounting-failed", {
				stage: "song_embedding",
				jobId,
				accountId: ctx.accountId,
				error: embeddingAccountingResult.error,
			});
			throw embeddingAccountingResult.error;
		}

		const embeddingResult: StageSummary = embeddingAccountingResult.value;

		applyStageSummary(
			progress,
			"song_embedding",
			embeddingResult,
			embeddingSubBatch.songIds.length > 0
				? stageStatus(embeddingResult)
				: "skipped",
		);

		// Phase D: content_activation (entitled + data-enriched songs)
		progress.currentStage = "content_activation";
		progress.stages.content_activation.status = "running";
		await persistProgress(jobId, progress);

		const activationAccountingResult =
			workPlan.needContentActivation.length > 0
				? await runStageWithAccounting({
						stage: "content_activation",
						candidateSongIds: workPlan.needContentActivation,
						jobId,
						accountId: ctx.accountId,
						fallbackCode: FAILURE_CODES.CONTENT_ACTIVATION_FAILED,
						run: () =>
							runContentActivation(ctx, workPlan.needContentActivation),
					})
				: await emptyAccounting;

		if (Result.isError(activationAccountingResult)) {
			log.error("stage-accounting-failed", {
				stage: "content_activation",
				jobId,
				accountId: ctx.accountId,
				error: activationAccountingResult.error,
			});
			throw activationAccountingResult.error;
		}

		const activationResult: StageSummary = activationAccountingResult.value;

		applyStageSummary(
			progress,
			"content_activation",
			activationResult,
			workPlan.needContentActivation.length > 0
				? stageStatus(activationResult)
				: "skipped",
		);
	} finally {
		await languageDetection;
	}
}

// --- Worker-owned chunk orchestration ---

export interface ChunkResult {
	hasMoreSongs: boolean;
	newCandidatesAvailable: boolean;
	newCandidateSongIds: string[];
	readyCount: number;
	doneCount: number;
	succeededCount: number;
	failedCount: number;
}

export async function executeWorkerChunk(
	accountId: string,
	jobId: string,
	batchSize: number,
	batchSequence: number,
	selectionMode: EnrichmentSelectionMode = "normal",
): Promise<ChunkResult> {
	const embeddingResult = EmbeddingService.create();
	if (Result.isError(embeddingResult)) {
		throw new PipelineBootstrapError(
			"Failed to initialize EmbeddingService",
			embeddingResult.error,
		);
	}

	const ctx = { ...buildContext(accountId, embeddingResult.value), jobId };

	const workPlan = await selectEnrichmentWorkPlan(
		accountId,
		batchSize,
		selectionMode,
	);
	const batch = await loadBatchSongs(workPlan.allSongIds);
	const batchIds = new Set(batch.songIds);
	const enrichedBefore = await loadEntitledReadyInBatch(accountId, batchIds);

	// selectionMode is preserved in progress so monitoring/observability can see
	// which selection strategy ran for each chunk.
	const progress = makeInitialProgress(
		batchSize,
		batchSequence,
		workPlan.flags,
		selectionMode,
	);

	// Candidate-side enrichment only (phases A-C)
	await enrichSongs(ctx, workPlan, batch, jobId, progress);

	progress.currentStage = undefined;
	await persistProgress(jobId, progress);

	let newCandidateSongIds: string[] = [];
	let newCandidatesAvailable = batch.songIds.length > 0;
	try {
		const enrichedAfter = await loadEntitledReadyInBatch(accountId, batchIds);
		newCandidateSongIds = [...enrichedAfter].filter(
			(songId) => !enrichedBefore.has(songId),
		);
		newCandidatesAvailable = newCandidateSongIds.length > 0;
	} catch {
		// Preserve the prior boolean behavior if the post-run readiness probe fails.
		// IDs fall back to all batch songs as a conservative estimate so the invariant
		// newCandidatesAvailable === (newCandidateSongIds.length > 0) is maintained.
		newCandidateSongIds = batch.songIds.length > 0 ? [...batchIds] : [];
		newCandidatesAvailable = batch.songIds.length > 0;
	}

	// Probe whether more songs still need pipeline processing via the DB selector
	const hasMoreSongs = await hasMoreSongsNeedingEnrichmentWork(accountId);

	return {
		hasMoreSongs,
		newCandidatesAvailable,
		newCandidateSongIds,
		readyCount: batch.songIds.length,
		doneCount: progress.done,
		succeededCount: progress.succeeded,
		failedCount: progress.failed,
	};
}
