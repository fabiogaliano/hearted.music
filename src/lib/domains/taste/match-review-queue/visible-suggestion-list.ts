/**
 * Visible suggestion list — the orientation-aware captured card shape.
 *
 * A VisibleSuggestionList is the ordered set of suggestions actually shown to
 * the user for one queue item after strictness and read-time filters are
 * applied. It is captured at card-display time and drives the capture RPC
 * (MSR-22) and add/dismiss decision paths (MSR-24).
 *
 * Types only; capture RPC wiring and helper derivation are MSR-22.
 */

import type {
	MatchOrientation,
	MatchReviewSubject,
} from "@/lib/domains/taste/match-review-queue/types";

/**
 * A single (song, playlist) pair as shown to the user (B4, B5, A5, C12).
 *
 * modelRank:   1-based rank from match_result_ranking (cross-encoder or
 *              fused-fallback ordering). Stable across users viewing the
 *              same snapshot.
 * visibleRank: 1-based dense rank within the subset actually visible to
 *              this user after strictness/read-time filters are applied.
 * fitScore:    Value returned by strictnessScore() for this row — the
 *              quality signal shown to the user as match percent. Never
 *              the reranker/ordering score.
 */
export interface VisibleSuggestion {
	songId: string;
	playlistId: string;
	fitScore: number;
	modelRank: number;
	visibleRank: number;
}

/**
 * The full suggestion list shown for one queue item (B4).
 *
 * orientation and subject are both carried so downstream capture and decision
 * paths can branch without re-querying the queue item row.
 */
export interface VisibleSuggestionList {
	orientation: MatchOrientation;
	subject: MatchReviewSubject;
	suggestions: VisibleSuggestion[];
}
