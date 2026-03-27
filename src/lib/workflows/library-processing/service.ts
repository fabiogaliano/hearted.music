import { Result } from "better-result";
import {
	ensureEnrichmentJob,
	ensureMatchSnapshotRefreshJob,
} from "@/lib/data/jobs";
import { getTargetPlaylists } from "@/lib/domains/library/playlists/queries";
import { getCount as getLikedSongCount } from "@/lib/domains/library/liked-songs/queries";
import { makeInitialProgress } from "@/lib/workflows/enrichment-pipeline/progress";
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

/**
 * Derives needsTargetSongEnrichment from the change that caused the refresh.
 * True when the change could have brought new un-enriched target-playlist-only songs.
 */
function deriveNeedsTargetSongEnrichment(
	change: LibraryProcessingChange,
): boolean {
	switch (change.kind) {
		case "onboarding_target_selection_confirmed":
			return true;
		case "library_synced":
			return change.changes.targetPlaylists.trackMembershipChanged;
		case "enrichment_completed":
			return change.newCandidatesAvailable;
		default:
			return false;
	}
}

async function executeEffect(
	effect: LibraryProcessingEffect,
	state: LibraryProcessingState,
	change: LibraryProcessingChange,
): Promise<LibraryProcessingState> {
	const band = await resolveQueuePriority(effect.accountId);
	const queuePriority = bandToNumeric(band);

	if (effect.kind === "ensure_enrichment_job") {
		const countResult = await getLikedSongCount(effect.accountId);
		const total = Result.isOk(countResult) ? countResult.value : 0;
		const progress = makeInitialProgress(1, 0, total);

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
		const needsTargetSongEnrichment = deriveNeedsTargetSongEnrichment(change);

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

	const hasTargets = await resolveHasTargetPlaylists(change.accountId);

	const { state: newState, effects } = reconcileLibraryProcessing({
		state: stateResult.value,
		change,
		requestMarker,
		hasTargetPlaylists: hasTargets,
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
			currentState = await executeEffect(effect, currentState, change);
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
