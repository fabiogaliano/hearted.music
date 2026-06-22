import { Result } from "better-result";
import type { Json } from "@/lib/data/database.types";
import { getBatch } from "@/lib/domains/enrichment/audio-features/queries";
import { get as getSongAnalyses } from "@/lib/domains/enrichment/content-analysis/queries";
import { flattenAnalysisText } from "@/lib/domains/enrichment/embeddings/analysis-text";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { getByIds } from "@/lib/domains/library/songs/queries";
import { createPlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";
import { createMatchingService } from "@/lib/domains/taste/song-matching/service";
import type {
	MatchingAudioFeatures,
	MatchingSong,
} from "@/lib/domains/taste/song-matching/types";
import type { LlmService } from "@/lib/integrations/llm/service";
import { createLlmService } from "@/lib/integrations/llm/service";
import { RerankerService } from "@/lib/integrations/reranker/service";
import { resolveAccountLabel } from "@/lib/observability/account-label";
import { isDebugEnabled, log } from "@/lib/observability/logger";
import {
	createInitialMatchSnapshotRefreshProgress,
	MATCH_REFRESH_STAGE_NAMES,
	type MatchRefreshStageName,
	type MatchSnapshotRefreshProgress,
} from "@/lib/platform/jobs/progress/match-snapshot-refresh";
import { updateJobProgress } from "@/lib/platform/jobs/repository";
import { getEntitledDataEnrichedSongIds } from "@/lib/workflows/enrichment-pipeline/batch";
import { rerankMatches } from "@/lib/workflows/enrichment-pipeline/reranking";
import { loadExclusionSet } from "@/lib/workflows/enrichment-pipeline/stages/matching";
import { runLightweightEnrichment } from "@/lib/workflows/playlist-sync/lightweight-enrichment";
import { loadMatchFilterExclusions } from "./match-filter-exclusions";
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
		log.error("match:progress-persist-failed", {
			jobId,
			error: result.error.message,
		});
	}
}

/** Compact, scannable name list for a log line — full names up to `max`. */
function previewNames(names: string[], max = 8): string {
	if (names.length <= max) {
		return names.join(", ");
	}
	return `${names.slice(0, max).join(", ")} +${names.length - max} more`;
}

/**
 * One info line with per-playlist match counts (by name), plus — when
 * WORKER_DEBUG is on — the matched songs themselves in batches of 10, so you
 * can watch exactly what landed where at any instant.
 */
function logMatchOutcome(
	actor: string,
	matches: ReadonlyMap<
		string,
		ReadonlyArray<{ playlistId: string; score: number }>
	>,
	songs: MatchingSong[],
	playlists: Array<{ id: string; name: string }>,
): void {
	const nameById = new Map(playlists.map((p) => [p.id, p.name]));

	const countByPlaylist = new Map<string, number>();
	for (const results of matches.values()) {
		for (const r of results) {
			countByPlaylist.set(
				r.playlistId,
				(countByPlaylist.get(r.playlistId) ?? 0) + 1,
			);
		}
	}

	const breakdown = [...countByPlaylist.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([id, n]) => `${nameById.get(id) ?? id.slice(0, 8)}: ${n}`)
		.join(", ");

	log.info("match:results", {
		actor,
		matched: matches.size,
		byPlaylist: breakdown || "none",
	});

	if (!isDebugEnabled()) {
		return;
	}

	const songById = new Map(songs.map((s) => [s.id, s]));
	const matchedIds = [...matches.keys()];
	const BATCH = 10;
	for (let i = 0; i < matchedIds.length; i += BATCH) {
		const items = matchedIds
			.slice(i, i + BATCH)
			.map((songId) => {
				const song = songById.get(songId);
				const label = song
					? `${song.name} — ${song.artists[0] ?? "?"}`
					: songId.slice(0, 8);
				const targets = (matches.get(songId) ?? [])
					.map((r) => nameById.get(r.playlistId) ?? r.playlistId.slice(0, 8))
					.join(" / ");
				return `${label} → ${targets}`;
			})
			.join(" | ");
		log.debug("match:songs", {
			actor,
			range: `${i + 1}-${Math.min(i + BATCH, matchedIds.length)}/${matchedIds.length}`,
			items,
		});
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
	writer: () => Promise<MatchSnapshotRefreshResult>;
}): Promise<MatchSnapshotRefreshResult> {
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
	actor?: string,
): Promise<MatchSnapshotRefreshResult> {
	// Resolve a label when the caller didn't pass one (e.g. matching-lab replays)
	// so every step log still names the account.
	const who = actor ?? (await resolveAccountLabel(accountId));
	const progress = createInitialMatchSnapshotRefreshProgress(plan);
	const embeddingResult = EmbeddingService.create();
	if (Result.isError(embeddingResult)) {
		throw new Error(
			`[target-refresh] Failed to initialize EmbeddingService: ${embeddingResult.error.message}`,
		);
	}
	const embeddingService = embeddingResult.value;

	let llmService: LlmService | undefined;
	try {
		llmService = createLlmService();
	} catch {
		// LLM unavailable — cold-start expansion disabled.
	}

	let rerankerService: RerankerService | undefined;
	try {
		// Default config carries the canonical rerank instruction.
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
			log.warn("match:target-enrichment-failed", {
				actor: who,
				error: err instanceof Error ? err.message : String(err),
			});
			finishStage(progress, "target_song_enrichment", 0, 1);
		}
		await persistRefreshProgress(jobId, progress);
	} else {
		skipStage(progress, "target_song_enrichment");
		await persistRefreshProgress(jobId, progress);
	}

	startStage(progress, "playlist_profiling");
	await persistRefreshProgress(jobId, progress);

	const { playlists, profiles } = await loadTargetPlaylistProfiles(
		accountId,
		profilingService,
	);

	finishStage(progress, "playlist_profiling", playlists.length, 0);
	progress.playlistCount = playlists.length;
	await persistRefreshProgress(jobId, progress);

	log.info("match:playlists-profiled", {
		actor: who,
		playlists: playlists.length,
		names: previewNames(playlists.map((p) => p.name)),
	});

	if (playlists.length === 0) {
		progress.candidateCount = 0;
		progress.matchedSongCount = 0;
		return publishSnapshot({
			jobId,
			progress,
			writer: () => writeEmptySnapshot(accountId),
		});
	}

	if (profiles.length !== playlists.length) {
		throw new Error(
			`[target-refresh] Profile count mismatch: ${profiles.length} profiles for ${playlists.length} target playlists`,
		);
	}

	startStage(progress, "candidate_loading");
	await persistRefreshProgress(jobId, progress);

	const songIds = await getEntitledDataEnrichedSongIds(accountId);
	finishStage(progress, "candidate_loading", songIds.length, 0);
	progress.candidateCount = songIds.length;
	await persistRefreshProgress(jobId, progress);

	log.info("match:candidates-loaded", {
		actor: who,
		songs: songIds.length,
		playlists: playlists.length,
	});

	if (songIds.length === 0) {
		progress.matchedSongCount = 0;
		return publishSnapshot({
			jobId,
			progress,
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

	const songsResult = await getByIds(songIds);
	if (Result.isError(songsResult)) {
		throw new Error(
			`[target-refresh] Failed to load songs: ${songsResult.error.message}`,
		);
	}

	const audioFeaturesResult = await getBatch(songIds);
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

	// Run both loads concurrently — they are independent DB calls.
	// If the base load fails we continue with an empty base and mark the summary
	// degraded so filter exclusions still apply and hard-filter enforcement is not
	// silently bypassed on a transient base-load error.
	let baseExclusionSet: Set<string> = new Set();
	let baseExclusionsFailed = false;
	const [baseResult, filterResult] = await Promise.all([
		loadExclusionSet(accountId).catch((err: unknown) => err),
		loadMatchFilterExclusions({
			accountId,
			playlists,
			candidateSongIds: songIds,
		}),
	]);

	if (baseResult instanceof Error || !(baseResult instanceof Set)) {
		log.warn("match:exclusion-set-failed", {
			actor: who,
			error:
				baseResult instanceof Error ? baseResult.message : String(baseResult),
		});
		baseExclusionsFailed = true;
	} else {
		baseExclusionSet = baseResult;
	}

	const { exclusions: filterExclusions, summary: filterSummary } = filterResult;

	log.info("match:filter-exclusions", {
		actor: who,
		activeFilterPlaylists: filterSummary.activeFilterPlaylistCount,
		excludedPairs: filterSummary.excludedPairCount,
		candidatePairs: filterSummary.candidatePairCount,
		failedChecks: filterSummary.failedChecksByType,
		// Log a fresh object so the logged value is always accurate even if
		// filterSummary.degraded were frozen.
		degraded: {
			...filterSummary.degraded,
			baseExclusions: baseExclusionsFailed,
		},
	});

	// filterSummary.degraded.baseExclusions is the orchestrator's responsibility;
	// loadMatchFilterExclusions always leaves it false (decisions §8).
	filterSummary.degraded.baseExclusions = baseExclusionsFailed;

	const effectiveExclusionSet = new Set([
		...baseExclusionSet,
		...filterExclusions,
	]);

	// Computed once and reused at both matchBatch and writeMatchSnapshot so the
	// two call sites are guaranteed the identical effective set.
	const exclusionSetArg =
		effectiveExclusionSet.size > 0 ? effectiveExclusionSet : undefined;

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

	startStage(progress, "matching");
	await persistRefreshProgress(jobId, progress);

	log.info("match:scoring", {
		actor: who,
		songs: matchingSongs.length,
		playlists: profiles.length,
	});

	const matchingService = createMatchingService(
		embeddingService,
		profilingService,
	);
	const matchResult = await matchingService.matchBatch(
		matchingSongs,
		profiles,
		songEmbeddings,
		exclusionSetArg !== undefined
			? { exclusionSet: exclusionSetArg }
			: undefined,
	);

	if (Result.isError(matchResult)) {
		finishStage(progress, "matching", 0, 1);
		await persistRefreshProgress(jobId, progress);
		log.error("match:scoring-failed", { actor: who });
		throw new Error("[target-refresh] Matching failed");
	}

	// Recorded into the snapshot hash so it reflects the documents actually
	// sent to the reranker, not the intended mode.
	let rerankDocumentMode: "analysis" | "metadata" = "metadata";

	if (rerankerService && matchResult.value.matches.size > 0) {
		// Fetch analyses only for songs that actually have matches — not the full
		// candidate set — to avoid unnecessary DB load.
		const matchedSongIdsForRerank = [...matchResult.value.matches.keys()];
		const analysesResult = await getSongAnalyses(matchedSongIdsForRerank);
		const analysisTextMap = new Map<string, string>();
		if (Result.isOk(analysesResult)) {
			for (const [songId, analysis] of analysesResult.value) {
				analysisTextMap.set(songId, flattenAnalysisText(analysis));
			}
		} else {
			log.error("match:analyses-degraded", {
				actor: who,
				error: analysesResult.error.message,
			});
		}
		rerankDocumentMode = analysisTextMap.size > 0 ? "analysis" : "metadata";

		await rerankMatches(
			matchResult.value.matches,
			matchingSongs,
			playlists,
			rerankerService,
			analysisTextMap,
		);
	}

	const matchedSongIds = [...matchResult.value.matches.keys()];
	finishStage(progress, "matching", matchedSongIds.length, 0);
	progress.matchedSongCount = matchedSongIds.length;
	await persistRefreshProgress(jobId, progress);

	logMatchOutcome(who, matchResult.value.matches, matchingSongs, playlists);

	const resultEntries: Array<{
		song_id: string;
		playlist_id: string;
		score: number;
		fused_score: number;
		rank: number | null;
		factors: Json;
		normalized_factors: Json;
	}> = [];

	for (const [songId, results] of matchResult.value.matches) {
		for (const result of results) {
			resultEntries.push({
				song_id: songId,
				playlist_id: result.playlistId,
				// score is post-rerank (if the reranker ran); fused_score is the
				// pre-rerank retrieval score the reranker can't overwrite.
				score: result.score,
				fused_score: result.fusedScore,
				rank: result.rank,
				factors: {
					embedding: result.factors.embedding,
					audio: result.factors.audio,
					genre: result.factors.genre,
				},
				normalized_factors: {
					embedding: result.normalizedFactors.embedding,
					audio: result.normalizedFactors.audio,
					genre: result.normalizedFactors.genre,
				},
			});
		}
	}

	return publishSnapshot({
		jobId,
		progress,
		writer: () =>
			writeMatchSnapshot({
				accountId,
				songs: matchingSongs,
				profiles,
				results: resultEntries,
				matchedSongIds,
				exclusionSet: exclusionSetArg,
				rerankDocumentMode,
			}),
	});
}
