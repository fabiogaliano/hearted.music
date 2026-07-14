import { Result } from "better-result";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { createPlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";
import type { MatchingSong } from "@/lib/domains/taste/song-matching/types";
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
import { loadLibraryProcessingState } from "@/lib/workflows/library-processing/queries";
import {
	loadCandidateDetails,
	loadCandidateSongIds,
	loadSongEmbeddings,
} from "./stages/candidate-loading";
import { runScoring } from "./stages/matching";
import { loadTargetPlaylistProfiles } from "./stages/playlist-profiling";
import { runOrientedRanking } from "./stages/ranking";
import { runTargetSongEnrichment } from "./stages/target-song-enrichment";
import { isMatchRefreshJobSuperseded } from "./superseded";
import type {
	MatchSnapshotRefreshOutcome,
	MatchSnapshotRefreshPlan,
	MatchSnapshotRefreshResult,
} from "./types";
import { writeEmptySnapshot, writeMatchSnapshot } from "./write-match-snapshot";

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

	const isSuperseded = satisfiesRequestedAt
		? () => checkIfSuperseded(accountId, satisfiesRequestedAt)
		: undefined;

	// --- Stage: target_song_enrichment ---
	if (plan.needsTargetSongEnrichment) {
		startStage(progress, "target_song_enrichment");
		await persistRefreshProgress(jobId, progress);
		const outcome = await runTargetSongEnrichment(accountId, who);
		finishStage(
			progress,
			"target_song_enrichment",
			outcome.succeeded ? 1 : 0,
			outcome.succeeded ? 0 : 1,
		);
		await persistRefreshProgress(jobId, progress);
	} else {
		skipStage(progress, "target_song_enrichment");
		await persistRefreshProgress(jobId, progress);
	}

	// --- Stage: playlist_profiling ---
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

	if (isSuperseded && (await isSuperseded())) {
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

	// --- Stage: candidate_loading ---
	startStage(progress, "candidate_loading");
	await persistRefreshProgress(jobId, progress);

	const songIds = await loadCandidateSongIds(accountId);
	finishStage(progress, "candidate_loading", songIds.length, 0);
	progress.candidateCount = songIds.length;
	await persistRefreshProgress(jobId, progress);

	log.info("match:candidates-loaded", {
		actor: who,
		songs: songIds.length,
		playlists: playlists.length,
	});

	if (isSuperseded && (await isSuperseded())) {
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

	const { matchingSongs, baseExclusionSet } = await loadCandidateDetails(
		accountId,
		songIds,
		who,
	);

	// Computed once and reused at both matchBatch and writeMatchSnapshot so the
	// two call sites are guaranteed the identical set.
	const exclusionSetArg =
		baseExclusionSet.size > 0 ? baseExclusionSet : undefined;

	if (isSuperseded && (await isSuperseded())) {
		return { status: "superseded" };
	}

	const songEmbeddings = await loadSongEmbeddings(
		embeddingService,
		songIds,
		who,
	);

	// --- Stage: matching (scoring + retention + oriented ranking) ---
	startStage(progress, "matching");
	await persistRefreshProgress(jobId, progress);

	log.info("match:scoring", {
		actor: who,
		songs: matchingSongs.length,
		playlists: profiles.length,
	});

	if (isSuperseded && (await isSuperseded())) {
		return { status: "superseded" };
	}

	const scoringResult = await runScoring(
		embeddingService,
		profilingService,
		matchingSongs,
		profiles,
		songEmbeddings,
		exclusionSetArg,
	);

	if (Result.isError(scoringResult)) {
		finishStage(progress, "matching", 0, 1);
		await persistRefreshProgress(jobId, progress);
		log.error("match:scoring-failed", { actor: who });
		throw new Error("[target-refresh] Matching failed");
	}

	const { matches, storedPairs } = scoringResult.value;

	const rankingOutcome = await runOrientedRanking({
		who,
		storedPairs,
		matchingSongs,
		playlists: playlists.map((pl) => ({
			id: pl.id,
			name: pl.name,
			matchIntent: pl.match_intent ?? null,
			genrePills: pl.genre_pills ?? null,
		})),
		rerankerService,
		isSuperseded,
	});

	if (rankingOutcome.status === "superseded") {
		return { status: "superseded" };
	}

	const { resultEntries, rerankDocumentMode } = rankingOutcome;

	const matchedSongIds = [...new Set(storedPairs.map((p) => p.songId))];
	finishStage(progress, "matching", matchedSongIds.length, 0);
	progress.matchedSongCount = matchedSongIds.length;
	await persistRefreshProgress(jobId, progress);

	logMatchOutcome(who, matches, matchingSongs, playlists);

	if (isSuperseded && (await isSuperseded())) {
		return { status: "superseded" };
	}

	// --- Stage: publishing ---
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
