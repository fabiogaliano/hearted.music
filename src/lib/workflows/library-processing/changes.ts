import type { LibraryProcessingChange } from "./types";

export const PlaylistManagementChanges = {
	sessionFlushed(opts: {
		accountId: string;
		targetMembershipChanged: boolean;
		scoringConfigChanged: boolean;
		readTimeFilterChanged: boolean;
	}): Extract<
		LibraryProcessingChange,
		{ kind: "playlist_management_session_flushed" }
	> {
		return { kind: "playlist_management_session_flushed", ...opts };
	},
};

export const MatchSnapshotChanges = {
	published(opts: {
		accountId: string;
		jobId: string;
		snapshotId?: string;
	}): Extract<LibraryProcessingChange, { kind: "match_snapshot_published" }> {
		return { kind: "match_snapshot_published", ...opts };
	},

	failed(opts: {
		accountId: string;
		jobId: string;
		snapshotId?: string | null;
	}): Extract<LibraryProcessingChange, { kind: "match_snapshot_failed" }> {
		return { kind: "match_snapshot_failed", ...opts };
	},

	superseded(opts: {
		accountId: string;
		jobId: string;
	}): Extract<LibraryProcessingChange, { kind: "match_snapshot_superseded" }> {
		return { kind: "match_snapshot_superseded", ...opts };
	},
};

export const FirstMatchSetupChanges = {
	setupCompleted(
		accountId: string,
	): Extract<LibraryProcessingChange, { kind: "first_match_setup_completed" }> {
		return { kind: "first_match_setup_completed", accountId };
	},
};

export const EnrichmentChanges = {
	completed(opts: {
		accountId: string;
		jobId: string;
		requestSatisfied: boolean;
		newCandidatesAvailable: boolean;
		newCandidateSongIds: string[];
	}): Extract<LibraryProcessingChange, { kind: "enrichment_completed" }> {
		return { kind: "enrichment_completed", ...opts };
	},

	stopped(opts: {
		accountId: string;
		jobId: string;
		reason: "local_limit" | "error" | "blocked";
	}): Extract<LibraryProcessingChange, { kind: "enrichment_stopped" }> {
		return { kind: "enrichment_stopped", ...opts };
	},
};

export const MaintenanceChanges = {
	enrichmentWorkAvailable(
		accountId: string,
	): Extract<LibraryProcessingChange, { kind: "enrichment_work_available" }> {
		return { kind: "enrichment_work_available", accountId };
	},
};

export const SyncChanges = {
	librarySynced(
		accountId: string,
		changes: {
			likedSongs: { added: boolean; removed: boolean };
			targetPlaylists: {
				trackMembershipChanged: boolean;
				profileTextChanged: boolean;
				removed: boolean;
			};
		},
	): Extract<LibraryProcessingChange, { kind: "library_synced" }> {
		return { kind: "library_synced", accountId, changes };
	},
};

export const BillingChanges = {
	songsUnlocked(
		accountId: string,
		songIds: string[],
	): Extract<LibraryProcessingChange, { kind: "songs_unlocked" }> {
		return { kind: "songs_unlocked", accountId, songIds };
	},

	unlimitedActivated(
		accountId: string,
	): Extract<LibraryProcessingChange, { kind: "unlimited_activated" }> {
		return { kind: "unlimited_activated", accountId };
	},

	candidateAccessRevoked(
		accountId: string,
	): Extract<LibraryProcessingChange, { kind: "candidate_access_revoked" }> {
		return { kind: "candidate_access_revoked", accountId };
	},
};
