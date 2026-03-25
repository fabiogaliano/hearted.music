export type RefreshSource =
	| "enrichment_drain"
	| "sync_liked_removal"
	| "sync_target_track_change"
	| "sync_target_metadata_change"
	| "sync_target_removal"
	| "sync_all_targets_removed"
	| "target_selection"
	| "manual";

export interface TargetPlaylistRefreshPlan {
	readonly source: RefreshSource;
	readonly shouldEnrichTargetPlaylistSongs: boolean;
	readonly rerunRequested?: boolean;
}

export interface RefreshResult {
	readonly published: boolean;
	readonly contextId: string | null;
	readonly matchedSongCount: number;
	readonly candidateCount: number;
	readonly playlistCount: number;
	readonly isEmpty: boolean;
	readonly noOp: boolean;
}
