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

/**
 * Canonical internal direction for a match review pass (A2, B1).
 * Use `orientation` for domain/server/schema; UI toggle uses `mode` (B2).
 */
export type MatchOrientation = "song" | "playlist";

/**
 * Discriminated union for the reviewed entity in a queue item (B3).
 * Replaces the song-only `songId: string` field so illegal subject states
 * are unrepresentable in exported server/UI boundaries.
 */
export type MatchReviewSubject =
	| { orientation: "song"; songId: string }
	| { orientation: "playlist"; playlistId: string };

/**
 * New split lifecycle state (B9-C). Resolution outcome is captured separately
 * in QueueItemResolution. `active` replaces `presented`; `resolved` replaces
 * `completed | skipped | unavailable`.
 */
export type QueueItemLifecycleState = "pending" | "active" | "resolved";

export type QueueItemResolution =
	| "added"
	| "dismissed"
	| "skipped"
	| "unavailable";

export type SessionStatus = "active" | "completed" | "abandoned";

/**
 * Exported queue item DTO that uses MatchReviewSubject so orientation is
 * always explicit and `{ songId?, playlistId? }` ambiguity is eliminated (E8).
 */
export interface MatchReviewQueueItemDto {
	id: string;
	sessionId: string;
	accountId: string;
	subject: MatchReviewSubject;
	sourceSnapshotId: string;
	position: number;
	state: QueueItemLifecycleState;
	resolution: QueueItemResolution | null;
	sourceScore: number;
	wasNewAtEnqueue: boolean;
	presentedAt: string | null;
	resolvedAt: string | null;
	// Set by the capture RPC when the visible pairs were frozen. Once set, the
	// captured rows are the card's authority — presentation can read them
	// directly instead of re-deriving the visible list.
	visiblePairsCapturedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface MatchReviewSession {
	id: string;
	accountId: string;
	orientation: MatchOrientation;
	status: SessionStatus;
	strictnessPreset: string;
	strictnessMinScore: number;
	createdAt: string;
	updatedAt: string;
	completedAt: string | null;
}

export type ActiveQueueResult =
	| { kind: "created"; session: MatchReviewSession; appendedCount: number }
	| {
			kind: "resumed";
			session: MatchReviewSession;
			/** Populated by the single-RPC fast resume path so the caller can skip
			 *  a separate fetchQueueItems round trip. */
			items?: MatchReviewQueueItemDto[];
	  }
	| { kind: "no_snapshot" };

export interface MatchReviewSummary {
	hasActiveQueue: boolean;
	pendingCount: number;
	/**
	 * IDs of the first pending subjects in queue order, used for preview images.
	 * Song IDs in song orientation, playlist IDs in playlist orientation —
	 * orientation-neutral so the field never leaks a `songId?`/`playlistId?` split.
	 */
	previewSubjectIds: string[];
}

/**
 * A single preview entry in an orientation-aware summary (E9).
 * Replaces the ad-hoc `{ id, image, name, artist }` shapes used by the server
 * layer so both song-mode and playlist-mode previews share one type.
 */
export interface MatchReviewSummaryPreviewItem {
	id: string;
	imageUrl: string | null;
	name: string;
	artist: string;
}

/**
 * Lightweight preview snapshot used by the dashboard CTA and sidebar badge (E9).
 * orientation tells callers which subject type generated the count.
 */
export interface MatchReviewSummaryPreview {
	orientation: MatchOrientation;
	pendingCount: number;
	previewItems: MatchReviewSummaryPreviewItem[];
	hasActiveQueue: boolean;
}

/**
 * Full orientation-aware summary result returned by server functions (E9).
 * Supersedes the server-local ServerMatchReviewSummaryResult once MSR-XX
 * migrates callers.
 */
export interface MatchReviewSummaryResult {
	orientation: MatchOrientation;
	pendingCount: number;
	previewItems: MatchReviewSummaryPreviewItem[];
	hasActiveQueue: boolean;
}

export interface AppendResult {
	/** How many new queue items were inserted this call */
	appendedCount: number;
	/** True when the snapshot was already recorded; insertions were skipped */
	alreadyApplied: boolean;
}

/**
 * Inputs that determine which review items are visible to a user at enqueue
 * time (C9). orientation + strictness + readTimeFiltersHash are hashed into
 * visibilityConfigHash stored in match_review_session_snapshot. When any
 * input changes a new hash allows the same snapshot to append additional
 * subjects without duplicating the already-enqueued ones.
 */
export interface QueueVisibilityConfigHashInput {
	orientation: MatchOrientation;
	minScore: number;
	/**
	 * Compact hash of the account's target playlist read-time filter configs,
	 * derived via computeReadTimeFiltersHash (MSR-36). Changes when any target
	 * playlist's filter configuration changes, allowing the same snapshot to
	 * reveal newly-visible subjects under the new hash.
	 */
	readTimeFiltersHash: string;
}

/**
 * A single orientation-aware queue subject produced by getOrderedUndecidedSubjects.
 * Orientation is encoded inside `subject` so callers never branch on a separate
 * orientation field (B3, MSR-19 note: avoid leaking song-only names).
 */
export interface OrderedSubject {
	subject: MatchReviewSubject;
	maxScore: number;
	wasNewAtEnqueue: boolean;
}
