/**
 * Match review queue domain types.
 *
 * Row types alias the generated DB types. Domain types add discriminated
 * unions used by the service layer so callers never branch on raw status
 * strings.
 */

import type { Tables } from "@/lib/data/database.types";

export type MatchReviewSessionRow = Tables<"match_review_session">;
export type MatchReviewQueueItemRow = Tables<"match_review_queue_item">;
export type MatchReviewSessionSnapshotRow =
	Tables<"match_review_session_snapshot">;

// Mirrors the DB CHECK constraints so the service layer gets static
// exhaustiveness checking without duplicating the check in migration code.
export type QueueItemState =
	| "pending"
	| "presented"
	| "completed"
	| "skipped"
	| "unavailable";

export type QueueItemResolution =
	| "added"
	| "dismissed"
	| "skipped"
	| "unavailable";

export type SessionStatus = "active" | "completed" | "abandoned";

export interface MatchReviewQueueItem {
	id: string;
	sessionId: string;
	accountId: string;
	songId: string;
	sourceSnapshotId: string;
	position: number;
	state: QueueItemState;
	resolution: QueueItemResolution | null;
	sourceScore: number;
	wasNewAtEnqueue: boolean;
	presentedAt: string | null;
	resolvedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface MatchReviewSession {
	id: string;
	accountId: string;
	status: SessionStatus;
	strictnessPreset: string;
	strictnessMinScore: number;
	createdAt: string;
	updatedAt: string;
	completedAt: string | null;
}

export type ActiveQueueResult =
	| { kind: "created"; session: MatchReviewSession; appendedCount: number }
	| { kind: "resumed"; session: MatchReviewSession }
	| { kind: "no_snapshot" };

export interface MatchReviewSummary {
	hasActiveQueue: boolean;
	pendingCount: number;
	previewSongIds: string[];
}

export interface AppendResult {
	/** How many new queue items were inserted this call */
	appendedCount: number;
	/** True when the snapshot was already recorded; insertions were skipped */
	alreadyApplied: boolean;
}
