import type { DbError } from "@/lib/shared/errors/database";

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
			reason: "local_limit" | "error" | "blocked";
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
			kind: "match_snapshot_superseded";
			accountId: string;
			jobId: string;
	  }
	| {
			kind: "playlist_management_session_flushed";
			accountId: string;
			targetMembershipChanged: boolean;
			/** intent text or genre pills changed — triggers snapshot recompute */
			scoringConfigChanged: boolean;
			/** read-time filter predicates changed — syncs sessions, no recompute */
			readTimeFilterChanged: boolean;
	  }
	| { kind: "enrichment_work_available"; accountId: string }
	| { kind: "songs_unlocked"; accountId: string; songIds: string[] }
	| { kind: "unlimited_activated"; accountId: string }
	| { kind: "candidate_access_revoked"; accountId: string };

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

export interface LibraryProcessingEffectResult {
	kind: LibraryProcessingEffect["kind"];
	status: "ensured";
	jobId: string;
}

export interface LibraryProcessingApplyOutcome {
	accountId: string;
	changeKind: LibraryProcessingChange["kind"];
	state: LibraryProcessingState;
	effects: LibraryProcessingEffect[];
	effectResults: LibraryProcessingEffectResult[];
}

export type LibraryProcessingApplyUnexpectedCause = {
	kind: "unexpected";
	message: string;
};

export type LibraryProcessingApplyCause =
	| DbError
	| LibraryProcessingApplyUnexpectedCause;

export type LibraryProcessingApplyError =
	| { kind: "load_state"; cause: DbError }
	| { kind: "persist_state"; cause: DbError }
	| {
			kind: "effect_ensure_failed";
			effectKind: LibraryProcessingEffect["kind"];
			cause: LibraryProcessingApplyCause;
	  }
	| { kind: "persist_active_refs"; cause: DbError };
