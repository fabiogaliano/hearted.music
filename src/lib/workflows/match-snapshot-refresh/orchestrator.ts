import { Result } from "better-result";
import type { Json } from "@/lib/data/database.types";
import { updateJobProgress } from "@/lib/data/jobs";
import * as audioFeatureData from "@/lib/domains/enrichment/audio-features/queries";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import * as songData from "@/lib/domains/library/songs/queries";
import { createPlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";
import { createMatchingService } from "@/lib/domains/taste/song-matching/service";
import type {
	MatchingAudioFeatures,
	MatchingSong,
} from "@/lib/domains/taste/song-matching/types";
import type { LlmService } from "@/lib/integrations/llm/service";
import { createLlmService } from "@/lib/integrations/llm/service";
import { RerankerService } from "@/lib/integrations/reranker/service";
import {
	createInitialMatchSnapshotRefreshProgress,
	MATCH_REFRESH_STAGE_NAMES,
	type MatchRefreshStageName,
	type MatchSnapshotRefreshProgress,
} from "@/lib/platform/jobs/progress/match-snapshot-refresh";
import { getEntitledDataEnrichedSongIds } from "@/lib/workflows/enrichment-pipeline/batch";
import { rerankMatches } from "@/lib/workflows/enrichment-pipeline/reranking";
import { loadExclusionSet } from "@/lib/workflows/enrichment-pipeline/stages/matching";
import { maybeDevDelay } from "@/lib/workflows/library-processing/devtools/delay";
import { runLightweightEnrichment } from "@/lib/workflows/playlist-sync/lightweight-enrichment";
import { loadTargetPlaylistProfiles } from "./profiles";
import type {
	MatchSnapshotRefreshPlan,
	MatchSnapshotRefreshResult,
} from "./types";
import { writeEmptySnapshot, writeMatchSnapshot } from "./write-match-snapshot";

async function persistRefreshProgress(
	jobId: string | undefined,
	progress: MatchSnapshotRefreshProgress,
): Promise<void> {
	if (!jobId) {
		return;
	}

	const result = await updateJobProgress(jobId, progress);
	if (Result.isError(result)) {
		console.error(
			`[match-refresh] Failed to persist progress for job ${jobId}: ${result.error.message}`,
		);
	}
}

function syncAggregateCounts(progress: MatchSnapshotRefreshProgress): void {
	progress.total = MATCH_REFRESH_STAGE_NAMES.length;
	progress.done = 0;
	progress.succeeded = 0;
	progress.failed = 0;

	for (const stageName of MATCH_REFRESH_STAGE_NAMES) {
		const stage = progress.stages[stageName];
		if (!stage) {
			continue;
		}

		if (
			stage.status === "completed" ||
			stage.status === "failed" ||
			stage.status === "skipped"
		) {
			progress.done += 1;
		}

		if (stage.status === "completed" || stage.status === "skipped") {
			progress.succeeded += 1;
		}

		if (stage.status === "failed") {
			progress.failed += 1;
		}
	}
}

function startStage(
	progress: MatchSnapshotRefreshProgress,
	stage: MatchRefreshStageName,
): void {
	progress.currentStage = stage;
	progress.stages[stage] = { status: "running", succeeded: 0, failed: 0 };
	syncAggregateCounts(progress);
}

function finishStage(
	progress: MatchSnapshotRefreshProgress,
	stage: MatchRefreshStageName,
	succeeded: number,
	failed: number,
): void {
	progress.stages[stage] = {
		status: failed > 0 && succeeded === 0 ? "failed" : "completed",
		succeeded,
		failed,
	};
	syncAggregateCounts(progress);
}

function skipStage(
	progress: MatchSnapshotRefreshProgress,
	stage: MatchRefreshStageName,
): void {
	progress.stages[stage] = { status: "skipped", succeeded: 0, failed: 0 };
	syncAggregateCounts(progress);
}

async function publishSnapshot(opts: {
	jobId?: string;
	progress: MatchSnapshotRefreshProgress;
	stageDelayMs?: number;
	writer: () => Promise<MatchSnapshotRefreshResult>;
}): Promise<MatchSnapshotRefreshResult> {
	await maybeDevDelay(opts.stageDelayMs);
	startStage(opts.progress, "publishing");
	await persistRefreshProgress(opts.jobId, opts.progress);

	const snapshotResult = await opts.writer();
	finishStage(opts.progress, "publishing", 1, 0);
	opts.progress.published = snapshotResult.published;
	opts.progress.noOp = snapshotResult.noOp;
	opts.progress.isEmpty = snapshotResult.isEmpty;
	opts.progress.currentStage = undefined;
	await persistRefreshProgress(opts.jobId, opts.progress);

	return snapshotResult;
}

export async function executeMatchSnapshotRefresh(
	accountId: string,
	plan: MatchSnapshotRefreshPlan,
	jobId?: string,
	stageDelayMs?: number,
): Promise<MatchSnapshotRefreshResult> {
	const progress = createInitialMatchSnapshotRefreshProgress(plan);
	let embeddingService: EmbeddingService;
	try {
		embeddingService = new EmbeddingService();
	} catch (err) {
		throw new Error(
			`[target-refresh] Failed to initialize EmbeddingService: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	let llmService: LlmService | undefined;
	try {
		llmService = createLlmService();
	} catch {
		// LLM unavailable — cold-start expansion disabled.
	}

	let rerankerService: RerankerService | undefined;
	try {
		rerankerService = new RerankerService();
	} catch {
		// Reranker unavailable.
	}

	const profilingService = createPlaylistProfilingService(
		embeddingService,
		llmService,
	);

	if (plan.needsTargetSongEnrichment) {
		startStage(progress, "target_song_enrichment");
		await persistRefreshProgress(jobId, progress);
		try {
			await runLightweightEnrichment({ accountId });
			finishStage(progress, "target_song_enrichment", 1, 0);
		} catch (err) {
			console.warn(
				"[target-refresh] Target-playlist-song enrichment failed, continuing:",
				err,
			);
			finishStage(progress, "target_song_enrichment", 0, 1);
		}
		await persistRefreshProgress(jobId, progress);
	} else {
		skipStage(progress, "target_song_enrichment");
		await persistRefreshProgress(jobId, progress);
	}

	await maybeDevDelay(stageDelayMs);
	startStage(progress, "playlist_profiling");
	await persistRefreshProgress(jobId, progress);

	const { playlists, profiles } = await loadTargetPlaylistProfiles(
		accountId,
		profilingService,
	);

	finishStage(progress, "playlist_profiling", playlists.length, 0);
	progress.playlistCount = playlists.length;
	await persistRefreshProgress(jobId, progress);

	if (playlists.length === 0) {
		progress.candidateCount = 0;
		progress.matchedSongCount = 0;
		return publishSnapshot({
			jobId,
			progress,
			stageDelayMs,
			writer: () => writeEmptySnapshot(accountId),
		});
	}

	if (profiles.length !== playlists.length) {
		throw new Error(
			`[target-refresh] Profile count mismatch: ${profiles.length} profiles for ${playlists.length} target playlists`,
		);
	}

	await maybeDevDelay(stageDelayMs);
	startStage(progress, "candidate_loading");
	await persistRefreshProgress(jobId, progress);

	const songIds = await getEntitledDataEnrichedSongIds(accountId);
	finishStage(progress, "candidate_loading", songIds.length, 0);
	progress.candidateCount = songIds.length;
	await persistRefreshProgress(jobId, progress);

	if (songIds.length === 0) {
		progress.matchedSongCount = 0;
		return publishSnapshot({
			jobId,
			progress,
			stageDelayMs,
			writer: () =>
				writeMatchSnapshot({
					accountId,
					songs: [],
					profiles,
					results: [],
					matchedSongIds: [],
				}),
		});
	}

	const songsResult = await songData.getByIds(songIds);
	if (Result.isError(songsResult)) {
		throw new Error(
			`[target-refresh] Failed to load songs: ${songsResult.error.message}`,
		);
	}

	const audioFeaturesResult = await audioFeatureData.getBatch(songIds);
	const audioFeaturesMap = Result.isOk(audioFeaturesResult)
		? audioFeaturesResult.value
		: new Map();

	const matchingSongs: MatchingSong[] = songsResult.value.map((song) => {
		const audioFeatureRow = audioFeaturesMap.get(song.id);
		const audioFeatures: MatchingAudioFeatures | null = audioFeatureRow
			? {
					energy: audioFeatureRow.energy ?? 0,
					valence: audioFeatureRow.valence ?? 0,
					danceability: audioFeatureRow.danceability ?? 0,
					acousticness: audioFeatureRow.acousticness ?? 0,
					instrumentalness: audioFeatureRow.instrumentalness ?? 0,
					speechiness: audioFeatureRow.speechiness ?? 0,
					liveness: audioFeatureRow.liveness ?? 0,
					tempo: audioFeatureRow.tempo ?? 0,
					loudness: audioFeatureRow.loudness ?? 0,
				}
			: null;

		return {
			id: song.id,
			spotifyId: song.spotify_id,
			name: song.name,
			artists: song.artists,
			genres: song.genres,
			audioFeatures,
		};
	});

	let exclusionSet: Set<string> | undefined;
	try {
		exclusionSet = await loadExclusionSet(accountId);
	} catch {
		console.warn("[target-refresh] Failed to load exclusion set");
	}

	const embeddingsResult = await embeddingService.getEmbeddings(songIds);
	const songEmbeddings = new Map<string, number[]>();
	if (Result.isOk(embeddingsResult)) {
		for (const [songId, embeddingRow] of embeddingsResult.value) {
			const parsedEmbedding =
				typeof embeddingRow.embedding === "string"
					? JSON.parse(embeddingRow.embedding)
					: embeddingRow.embedding;
			if (
				Array.isArray(parsedEmbedding) &&
				parsedEmbedding.every((value) => typeof value === "number")
			) {
				songEmbeddings.set(songId, parsedEmbedding);
			}
		}
	}

	await maybeDevDelay(stageDelayMs);
	startStage(progress, "matching");
	await persistRefreshProgress(jobId, progress);

	const matchingService = createMatchingService(
		embeddingService,
		profilingService,
	);
	const matchResult = await matchingService.matchBatch(
		matchingSongs,
		profiles,
		songEmbeddings,
		exclusionSet ? { exclusionSet } : undefined,
	);

	if (Result.isError(matchResult)) {
		finishStage(progress, "matching", 0, 1);
		await persistRefreshProgress(jobId, progress);
		throw new Error("[target-refresh] Matching failed");
	}

	if (rerankerService && matchResult.value.matches.size > 0) {
		await rerankMatches(
			matchResult.value.matches,
			matchingSongs,
			playlists,
			rerankerService,
		);
	}

	const matchedSongIds = [...matchResult.value.matches.keys()];
	finishStage(progress, "matching", matchedSongIds.length, 0);
	progress.matchedSongCount = matchedSongIds.length;
	await persistRefreshProgress(jobId, progress);

	const resultEntries: Array<{
		song_id: string;
		playlist_id: string;
		score: number;
		rank: number | null;
		factors: Json;
	}> = [];

	for (const [songId, results] of matchResult.value.matches) {
		for (const result of results) {
			resultEntries.push({
				song_id: songId,
				playlist_id: result.playlistId,
				score: result.score,
				rank: result.rank,
				factors: {
					embedding: result.factors.embedding,
					audio: result.factors.audio,
					genre: result.factors.genre,
				},
			});
		}
	}

	return publishSnapshot({
		jobId,
		progress,
		stageDelayMs,
		writer: () =>
			writeMatchSnapshot({
				accountId,
				songs: matchingSongs,
				profiles,
				results: resultEntries,
				matchedSongIds,
				exclusionSet,
			}),
	});
}
