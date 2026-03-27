import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import {
	ensureEnrichmentJob,
	ensureMatchSnapshotRefreshJob,
	getJobById,
} from "@/lib/data/jobs";
import { EnrichmentChunkProgressSchema } from "@/lib/platform/jobs/progress/types";
import { getCount as getLikedSongCount } from "@/lib/domains/library/liked-songs/queries";
import {
	getPlaylistSongs,
	getTargetPlaylists,
} from "@/lib/domains/library/playlists/queries";
import {
	batchSizeForSequence,
	makeInitialProgress,
} from "@/lib/workflows/enrichment-pipeline/progress";
import {
	getOrCreateLibraryProcessingState,
	persistLibraryProcessingState,
} from "./queries";
import { bandToNumeric, resolveQueuePriority } from "./queue-priority";
import { reconcileLibraryProcessing } from "./reconciler";
import type {
	LibraryProcessingChange,
	LibraryProcessingEffect,
	LibraryProcessingState,
} from "./types";

interface JobOutcomeMetadata {
	satisfiedMarker: string | null;
	batchSequence: number | null;
}

function changeMayNeedTargetSongEnrichment(
	change: LibraryProcessingChange,
): boolean {
	switch (change.kind) {
		case "onboarding_target_selection_confirmed":
			return true;
		case "library_synced":
			return change.changes.targetPlaylists.trackMembershipChanged;
		default:
			return false;
	}
}

async function loadJobOutcomeMetadata(
	change: LibraryProcessingChange,
): Promise<JobOutcomeMetadata> {
	if (
		change.kind !== "enrichment_completed" &&
		change.kind !== "match_snapshot_published"
	) {
		return { satisfiedMarker: null, batchSequence: null };
	}

	const jobResult = await getJobById(change.jobId);
	if (Result.isError(jobResult) || jobResult.value === null) {
		return { satisfiedMarker: null, batchSequence: null };
	}

	if (change.kind === "match_snapshot_published") {
		return {
			satisfiedMarker: jobResult.value.satisfies_requested_at,
			batchSequence: null,
		};
	}

	const progressResult = EnrichmentChunkProgressSchema.partial().safeParse(
		jobResult.value.progress ?? {},
	);

	return {
		satisfiedMarker: jobResult.value.satisfies_requested_at,
		batchSequence: progressResult.success
			? (progressResult.data.batchSequence ?? null)
			: null,
	};
}

async function deriveNeedsTargetSongEnrichment(
	accountId: string,
	change: LibraryProcessingChange,
): Promise<boolean> {
	if (!changeMayNeedTargetSongEnrichment(change)) {
		return false;
	}

	const targetPlaylistsResult = await getTargetPlaylists(accountId);
	if (
		Result.isError(targetPlaylistsResult) ||
		targetPlaylistsResult.value.length === 0
	) {
		return false;
	}

	const playlistSongResults = await Promise.all(
		targetPlaylistsResult.value.map((playlist) =>
			getPlaylistSongs(playlist.id),
		),
	);

	const targetSongIds = new Set<string>();
	for (const playlistSongResult of playlistSongResults) {
		if (Result.isError(playlistSongResult)) {
			continue;
		}

		for (const playlistSong of playlistSongResult.value) {
			targetSongIds.add(playlistSong.song_id);
		}
	}

	if (targetSongIds.size === 0) {
		return false;
	}

	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("liked_song")
		.select("song_id")
		.eq("account_id", accountId)
		.is("unliked_at", null)
		.in("song_id", [...targetSongIds]);

	if (error) {
		return false;
	}

	const likedSongIds = new Set((data ?? []).map((row) => row.song_id));
	for (const targetSongId of targetSongIds) {
		if (!likedSongIds.has(targetSongId)) {
			return true;
		}
	}

	return false;
}

async function executeEffect(
	effect: LibraryProcessingEffect,
	state: LibraryProcessingState,
	change: LibraryProcessingChange,
	jobOutcomeMetadata: JobOutcomeMetadata,
): Promise<LibraryProcessingState> {
	const band = await resolveQueuePriority(effect.accountId);
	const queuePriority = bandToNumeric(band);

	if (effect.kind === "ensure_enrichment_job") {
		const countResult = await getLikedSongCount(effect.accountId);
		const total = Result.isOk(countResult) ? countResult.value : 0;

		// Carry batch progression across re-ensured jobs (1 → 5 → 10 → 25 → 50)
		const previousBatchSequence = jobOutcomeMetadata.batchSequence ?? 0;
		const nextSequence =
			change.kind === "enrichment_completed" ? previousBatchSequence + 1 : 0;
		const nextBatchSize = batchSizeForSequence(nextSequence);
		const progress = makeInitialProgress(nextBatchSize, nextSequence, total);

		const result = await ensureEnrichmentJob({
			accountId: effect.accountId,
			satisfiesRequestedAt: effect.satisfiesRequestedAt,
			queuePriority,
			progress,
		});
		if (Result.isOk(result)) {
			return {
				...state,
				enrichment: {
					...state.enrichment,
					activeJobId: result.value.id,
				},
			};
		}
	}

	if (effect.kind === "ensure_match_snapshot_refresh_job") {
		const needsTargetSongEnrichment = await deriveNeedsTargetSongEnrichment(
			effect.accountId,
			change,
		);

		const result = await ensureMatchSnapshotRefreshJob({
			accountId: effect.accountId,
			satisfiesRequestedAt: effect.satisfiesRequestedAt,
			queuePriority,
			needsTargetSongEnrichment,
		});
		if (Result.isOk(result)) {
			return {
				...state,
				matchSnapshotRefresh: {
					...state.matchSnapshotRefresh,
					activeJobId: result.value.id,
				},
			};
		}
	}

	return state;
}

/**
 * The single public entrypoint for all library-processing changes.
 *
 * 1. Loads or creates LibraryProcessingState
 * 2. Stamps a request marker for this apply cycle
 * 3. Reconciles the change against current state
 * 4. Persists the updated state
 * 5. Executes ensure-job effects and persists activeJobId refs
 */
export async function applyLibraryProcessingChange(
	change: LibraryProcessingChange,
): Promise<void> {
	const stateResult = await getOrCreateLibraryProcessingState(change.accountId);
	if (Result.isError(stateResult)) {
		console.error(
			"[library-processing] Failed to load state:",
			stateResult.error.message,
		);
		return;
	}

	const requestMarker = new Date().toISOString();

	const [jobOutcomeMetadata, hasTargets] = await Promise.all([
		loadJobOutcomeMetadata(change),
		resolveHasTargetPlaylists(change.accountId),
	]);

	const { state: newState, effects } = reconcileLibraryProcessing({
		state: stateResult.value,
		change,
		requestMarker,
		hasTargetPlaylists: hasTargets,
		satisfiedMarker: jobOutcomeMetadata.satisfiedMarker,
	});

	const persistResult = await persistLibraryProcessingState(newState);
	if (Result.isError(persistResult)) {
		console.error(
			"[library-processing] Failed to persist state:",
			persistResult.error.message,
		);
		return;
	}

	let currentState = persistResult.value;

	for (const effect of effects) {
		try {
			currentState = await executeEffect(
				effect,
				currentState,
				change,
				jobOutcomeMetadata,
			);
		} catch (err) {
			console.error(`[library-processing] Effect ${effect.kind} failed:`, err);
		}
	}

	// Persist activeJobId refs from effect execution
	if (currentState !== persistResult.value) {
		const finalPersist = await persistLibraryProcessingState(currentState);
		if (Result.isError(finalPersist)) {
			console.error(
				"[library-processing] Failed to persist activeJobId refs:",
				finalPersist.error.message,
			);
		}
	}
}

async function resolveHasTargetPlaylists(accountId: string): Promise<boolean> {
	const result = await getTargetPlaylists(accountId);
	return Result.isOk(result) && result.value.length > 0;
}
