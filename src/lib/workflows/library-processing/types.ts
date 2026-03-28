export interface LibraryProcessingWorkflowState {
	requestedAt: string | null;
	settledAt: string | null;
	activeJobId: string | null;
}

export interface LibraryProcessingState {
	accountId: string;
	enrichment: LibraryProcessingWorkflowState;
	matchSnapshotRefresh: LibraryProcessingWorkflowState;
	createdAt: string;
	updatedAt: string;
}

export type LibraryProcessingChange =
	| {
			kind: "onboarding_target_selection_confirmed";
			accountId: string;
	  }
	| {
			kind: "library_synced";
			accountId: string;
			changes: {
				likedSongs: {
					added: boolean;
					removed: boolean;
				};
				targetPlaylists: {
					trackMembershipChanged: boolean;
					profileTextChanged: boolean;
					removed: boolean;
				};
			};
	  }
	| {
			kind: "enrichment_completed";
			accountId: string;
			jobId: string;
			requestSatisfied: boolean;
			newCandidatesAvailable: boolean;
	  }
	| {
			kind: "enrichment_stopped";
			accountId: string;
			jobId: string;
			reason: "local_limit" | "error";
	  }
	| {
			kind: "match_snapshot_published";
			accountId: string;
			jobId: string;
	  }
	| {
			kind: "match_snapshot_failed";
			accountId: string;
			jobId: string;
	  }
	| {
			kind: "playlist_management_session_flushed";
			accountId: string;
			targetMembershipChanged: boolean;
			targetMetadataChanged: boolean;
	  };

export type LibraryProcessingEffect =
	| {
			kind: "ensure_enrichment_job";
			accountId: string;
			satisfiesRequestedAt: string;
	  }
	| {
			kind: "ensure_match_snapshot_refresh_job";
			accountId: string;
			satisfiesRequestedAt: string;
	  };
