import { Result } from "better-result";
import type { Json } from "@/lib/data/database.types";
import { getBatch } from "@/lib/domains/enrichment/audio-features/queries";
import { get as getSongAnalyses } from "@/lib/domains/enrichment/content-analysis/queries";
import { flattenAnalysisText } from "@/lib/domains/enrichment/embeddings/analysis-text";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { getByIds } from "@/lib/domains/library/songs/queries";
import { createPlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";
import {
	MATCH_STORED_PAIRS_PER_PLAYLIST,
	MATCH_STORED_PAIRS_PER_SONG,
	retainStoredMatchPairs,
} from "@/lib/domains/taste/song-matching/retention";
import { createMatchingService } from "@/lib/domains/taste/song-matching/service";
import type {
	MatchingAudioFeatures,
	MatchingSong,
	MatchResult,
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
import {
	type PlaylistForRanking,
	rankMatchSuggestionLists,
	type SongForRanking,
} from "@/lib/workflows/enrichment-pipeline/match-ranking";
import { loadExclusionSet } from "@/lib/workflows/enrichment-pipeline/stages/matching";
import { loadLibraryProcessingState } from "@/lib/workflows/library-processing/queries";
import { runLightweightEnrichment } from "@/lib/workflows/playlist-sync/lightweight-enrichment";
import { loadTargetPlaylistProfiles } from "./profiles";
import { isMatchRefreshJobSuperseded } from "./superseded";
import type {
	MatchSnapshotRefreshOutcome,
	MatchSnapshotRefreshPlan,
	MatchSnapshotRefreshResult,
} from "./types";
import {
	type RankingRowPayload,
	writeEmptySnapshot,
	writeMatchSnapshot,
} from "./write-match-snapshot";

// Queries current state to check if a newer request has arrived since
// this job was scheduled. Returns false on any state-load error so that
// transient DB issues do not silently drop real work.
async function checkIfSuperseded(
	accountId: string,
	satisfiesRequestedAt: string,
): Promise<boolean> {
	const stateResult = await loadLibraryProcessingState(accountId);
	if (Result.isError(stateResult) || stateResult.value === null) {
		return false;
	}
	return isMatchRefreshJobSuperseded(
		{ satisfies_requested_at: satisfiesRequestedAt },
		stateResult.value.matchSnapshotRefresh.requestedAt,
	);
}

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
	satisfiesRequestedAt?: string,
): Promise<MatchSnapshotRefreshOutcome> {
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

	// Construct the reranker once (default config carries the canonical rerank
	// instruction) so both orientations share one instance. The no-arg constructor
	// only validates static default config via Zod and never touches the network
	// (getMlProvider runs lazily inside rerank()), so it does not throw — no guard
	// is needed. When the provider is unavailable at call time, rerank() degrades
	// to the original order and the ranking helpers still emit fused_fallback
	// ranking rows for both orientations.
	const rerankerService = new RerankerService();

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

	if (
		satisfiesRequestedAt &&
		(await checkIfSuperseded(accountId, satisfiesRequestedAt))
	) {
		return { status: "superseded" };
	}

	if (playlists.length === 0) {
		progress.candidateCount = 0;
		progress.matchedSongCount = 0;
		const snapshotResult = await publishSnapshot({
			jobId,
			progress,
			writer: () => writeEmptySnapshot(accountId),
		});
		return { status: "published", result: snapshotResult };
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

	if (
		satisfiesRequestedAt &&
		(await checkIfSuperseded(accountId, satisfiesRequestedAt))
	) {
		return { status: "superseded" };
	}

	if (songIds.length === 0) {
		progress.matchedSongCount = 0;
		const snapshotResult = await publishSnapshot({
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
		return { status: "published", result: snapshotResult };
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

	// Base exclusions only: pairs the user already decided on plus songs already
	// in a target playlist. Safe metadata hard filters (language, vocal gender,
	// release year, liked-at) are deliberately NOT applied here — they are
	// read-time predicates in visible-suggestion-list.ts (Phase 9 / MSR-36/37), so
	// loosening a filter reveals pairs from the already-stored snapshot without a
	// recompute. Applying them at write time would drop those pairs before storage
	// and make loosening impossible, so the snapshot keeps the broad candidate set.
	let baseExclusionSet: Set<string> = new Set();
	const baseResult = await loadExclusionSet(accountId).catch(
		(err: unknown) => err,
	);

	if (baseResult instanceof Error || !(baseResult instanceof Set)) {
		log.warn("match:exclusion-set-failed", {
			actor: who,
			error:
				baseResult instanceof Error ? baseResult.message : String(baseResult),
		});
	} else {
		baseExclusionSet = baseResult;
	}

	// Computed once and reused at both matchBatch and writeMatchSnapshot so the
	// two call sites are guaranteed the identical set.
	const exclusionSetArg =
		baseExclusionSet.size > 0 ? baseExclusionSet : undefined;

	if (
		satisfiesRequestedAt &&
		(await checkIfSuperseded(accountId, satisfiesRequestedAt))
	) {
		return { status: "superseded" };
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

	startStage(progress, "matching");
	await persistRefreshProgress(jobId, progress);

	log.info("match:scoring", {
		actor: who,
		songs: matchingSongs.length,
		playlists: profiles.length,
	});

	if (
		satisfiesRequestedAt &&
		(await checkIfSuperseded(accountId, satisfiesRequestedAt))
	) {
		return { status: "superseded" };
	}

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

	// Flatten all matched pairs and apply bilateral retention so both oriented
	// suggestion lists have sufficient pairs (song-top-N ∪ playlist-top-N).
	const allPairs: MatchResult[] = [];
	for (const results of matchResult.value.matches.values()) {
		allPairs.push(...results);
	}
	const storedPairs = retainStoredMatchPairs({
		thresholdedPairs: allPairs,
		perSongLimit: MATCH_STORED_PAIRS_PER_SONG,
		perPlaylistLimit: MATCH_STORED_PAIRS_PER_PLAYLIST,
	});

	// Recorded into the snapshot hash so it reflects documents actually built.
	let rerankDocumentMode: "analysis" | "metadata" = "metadata";

	// Rankings keyed by "songId:playlistId" — one row per (pair, orientation).
	const rankingsByPair = new Map<string, RankingRowPayload[]>();
	// Song-orientation rank keyed by "songId:playlistId" for legacy score/rank
	// mirror (C12): new read paths use match_result_ranking; old read paths use
	// the mirror value on match_result.score / match_result.rank.
	const songOrientationRankByPair = new Map<
		string,
		{ rank: number; orderingScore: number }
	>();

	if (storedPairs.length > 0) {
		// Load analyses for stored-pair songs — avoids fetching the full candidate
		// set when most songs have no pairs (empty-match case skips this entirely).
		const storedSongIdSet = new Set(storedPairs.map((p) => p.songId));
		const storedSongIds = [...storedSongIdSet];
		const analysesResult = await getSongAnalyses(storedSongIds);
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

		const songsForRanking: SongForRanking[] = songsResult.value
			.filter((s) => storedSongIdSet.has(s.id))
			.map((s) => ({
				id: s.id,
				name: s.name,
				artists: s.artists,
				genres: s.genres,
				analysisText: analysisTextMap.get(s.id) ?? null,
			}));

		const playlistsForRanking: PlaylistForRanking[] = playlists.map((pl) => ({
			id: pl.id,
			name: pl.name,
			matchIntent: pl.match_intent ?? null,
			genrePills: pl.genre_pills ?? null,
		}));

		const rankResult = await rankMatchSuggestionLists({
			storedPairs,
			songs: songsForRanking,
			playlists: playlistsForRanking,
			// If the provider is unavailable at call time, rankSongSuggestionLists
			// and rankPlaylistSuggestionLists degrade to fused_fallback internally.
			rerankerService,
			isSuperseded: satisfiesRequestedAt
				? () => checkIfSuperseded(accountId, satisfiesRequestedAt)
				: undefined,
		});

		// A superseded result publishes nothing — a newer job will publish instead.
		if (rankResult.status === "superseded") {
			return { status: "superseded" };
		}

		// Build per-pair ranking payload from both orientations.
		for (const [orientation, lists] of rankResult.byOrientation) {
			for (const list of lists) {
				list.rankedPairs.forEach((pair, idx) => {
					const rank = idx + 1;
					const key = `${pair.songId}:${pair.playlistId}`;
					const row: RankingRowPayload = {
						orientation,
						rank,
						ordering_score: pair.orderingScore,
						reranker_score: pair.rerankerScore,
						source: pair.source,
						document_mode: pair.documentMode,
					};
					const existing = rankingsByPair.get(key) ?? [];
					existing.push(row);
					rankingsByPair.set(key, existing);

					if (orientation === "song") {
						songOrientationRankByPair.set(key, {
							rank,
							orderingScore: pair.orderingScore,
						});
					}
				});
			}
		}
	}

	const matchedSongIds = [...new Set(storedPairs.map((p) => p.songId))];
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
		rankings?: RankingRowPayload[];
	}> = storedPairs.map((pair) => {
		const key = `${pair.songId}:${pair.playlistId}`;
		const songOrientation = songOrientationRankByPair.get(key);
		return {
			song_id: pair.songId,
			playlist_id: pair.playlistId,
			// song-orientation ordering_score mirrors the legacy score column (C12);
			// falls back to fusedScore when no ranking row exists for this pair.
			score: songOrientation?.orderingScore ?? pair.fusedScore,
			fused_score: pair.fusedScore,
			// song-orientation rank mirrors the legacy rank column; null when absent.
			rank: songOrientation?.rank ?? null,
			factors: {
				embedding: pair.factors.embedding,
				audio: pair.factors.audio,
				genre: pair.factors.genre,
			},
			normalized_factors: {
				embedding: pair.normalizedFactors.embedding,
				audio: pair.normalizedFactors.audio,
				genre: pair.normalizedFactors.genre,
			},
			rankings: rankingsByPair.get(key),
		};
	});

	if (
		satisfiesRequestedAt &&
		(await checkIfSuperseded(accountId, satisfiesRequestedAt))
	) {
		return { status: "superseded" };
	}

	const snapshotResult = await publishSnapshot({
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
	return { status: "published", result: snapshotResult };
}
