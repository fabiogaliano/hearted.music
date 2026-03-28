import type {
	LibraryProcessingChange,
	LibraryProcessingEffect,
	LibraryProcessingState,
	LibraryProcessingWorkflowState,
} from "./types";

export interface ReconcileInput {
	state: LibraryProcessingState;
	change: LibraryProcessingChange;
	requestMarker: string;
	hasTargetPlaylists: boolean;
	satisfiedMarker: string | null;
}

export interface ReconcileResult {
	state: LibraryProcessingState;
	effects: LibraryProcessingEffect[];
}

function isStale(wf: LibraryProcessingWorkflowState): boolean {
	return (
		wf.requestedAt !== null &&
		(wf.settledAt === null || wf.settledAt < wf.requestedAt)
	);
}

function advanceRequestedAt(
	wf: LibraryProcessingWorkflowState,
	marker: string,
): LibraryProcessingWorkflowState {
	if (wf.requestedAt !== null && wf.requestedAt > marker) {
		return wf;
	}

	return { ...wf, requestedAt: marker };
}

function settleWorkflow(
	wf: LibraryProcessingWorkflowState,
	satisfiedMarker: string,
	jobId: string,
): LibraryProcessingWorkflowState {
	const settledAt =
		wf.settledAt !== null && wf.settledAt > satisfiedMarker
			? wf.settledAt
			: satisfiedMarker;

	return {
		...wf,
		settledAt,
		activeJobId: wf.activeJobId === jobId ? null : wf.activeJobId,
	};
}

function clearActiveJob(
	wf: LibraryProcessingWorkflowState,
	jobId: string,
): LibraryProcessingWorkflowState {
	return wf.activeJobId === jobId ? { ...wf, activeJobId: null } : wf;
}

export function reconcileLibraryProcessing(
	input: ReconcileInput,
): ReconcileResult {
	const { change, requestMarker, hasTargetPlaylists } = input;
	let enrichment = { ...input.state.enrichment };
	let matchSnapshotRefresh = { ...input.state.matchSnapshotRefresh };
	const effects: LibraryProcessingEffect[] = [];

	switch (change.kind) {
		case "onboarding_target_selection_confirmed": {
			if (hasTargetPlaylists) {
				enrichment = advanceRequestedAt(enrichment, requestMarker);
			}
			matchSnapshotRefresh = advanceRequestedAt(
				matchSnapshotRefresh,
				requestMarker,
			);
			break;
		}

		case "library_synced": {
			const { likedSongs, targetPlaylists } = change.changes;

			if (likedSongs.added) {
				enrichment = advanceRequestedAt(enrichment, requestMarker);
				if (hasTargetPlaylists) {
					matchSnapshotRefresh = advanceRequestedAt(
						matchSnapshotRefresh,
						requestMarker,
					);
				}
			}

			if (likedSongs.removed) {
				matchSnapshotRefresh = advanceRequestedAt(
					matchSnapshotRefresh,
					requestMarker,
				);
			}

			if (
				targetPlaylists.trackMembershipChanged ||
				targetPlaylists.profileTextChanged ||
				targetPlaylists.removed
			) {
				matchSnapshotRefresh = advanceRequestedAt(
					matchSnapshotRefresh,
					requestMarker,
				);
			}
			break;
		}

		case "enrichment_completed": {
			if (change.requestSatisfied) {
				// Settle at the marker the job was scheduled to satisfy, not the
				// current requestedAt — a concurrent request may have advanced it.
				const marker =
					input.satisfiedMarker ?? enrichment.requestedAt ?? requestMarker;
				enrichment = settleWorkflow(enrichment, marker, change.jobId);
			} else {
				enrichment = clearActiveJob(enrichment, change.jobId);
			}

			if (change.newCandidatesAvailable && hasTargetPlaylists) {
				matchSnapshotRefresh = advanceRequestedAt(
					matchSnapshotRefresh,
					requestMarker,
				);
			}
			break;
		}

		case "enrichment_stopped": {
			enrichment = clearActiveJob(enrichment, change.jobId);
			break;
		}

		case "match_snapshot_published": {
			const marker =
				input.satisfiedMarker ??
				matchSnapshotRefresh.requestedAt ??
				requestMarker;
			matchSnapshotRefresh = settleWorkflow(
				matchSnapshotRefresh,
				marker,
				change.jobId,
			);
			break;
		}

		case "match_snapshot_failed": {
			matchSnapshotRefresh = clearActiveJob(matchSnapshotRefresh, change.jobId);
			break;
		}
	}

	// V1 failure handling: do not auto-reensure after stop/failure outcomes.
	// Leave workflows stale so retry policy can be layered on later.
	const isFailureChange =
		change.kind === "enrichment_stopped" ||
		change.kind === "match_snapshot_failed";

	if (!isFailureChange) {
		const enrichmentRequested = enrichment.requestedAt;
		if (isStale(enrichment) && !enrichment.activeJobId && enrichmentRequested) {
			effects.push({
				kind: "ensure_enrichment_job",
				accountId: input.state.accountId,
				satisfiesRequestedAt: enrichmentRequested,
			});
		}

		const refreshRequested = matchSnapshotRefresh.requestedAt;
		if (
			isStale(matchSnapshotRefresh) &&
			!matchSnapshotRefresh.activeJobId &&
			refreshRequested
		) {
			effects.push({
				kind: "ensure_match_snapshot_refresh_job",
				accountId: input.state.accountId,
				satisfiesRequestedAt: refreshRequested,
			});
		}
	}

	return {
		state: {
			...input.state,
			enrichment,
			matchSnapshotRefresh,
		},
		effects,
	};
}
