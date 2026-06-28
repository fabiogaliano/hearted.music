/**
 * Visibility policy — the shared rules that decide what a user sees.
 *
 * Strictness and playlist filters are both *visibility inputs*. This module is
 * the single place that encodes how they combine, so queue derivation
 * (review-subject-selector) and card presentation (visible-suggestion-list)
 * agree by sharing one implementation rather than by convention.
 *
 * A VisibilityPolicy answers, for a given (song, playlist) pair:
 *  - does it pass strictness?            strictnessScore(row) >= minScore
 *  - is it undecided?                    not in decidedPairs
 *  - does it pass the playlist filters?  passesAllMatchFilters against song meta
 *
 * The session still stores `strictness_min_score`, so `minScore` is frozen for
 * the current session today; this abstraction exists so strictness can become
 * live between cards later without rewriting queue/card visibility logic.
 *
 * Pure: no DB access. Query helpers live in filter-metadata-queries.ts.
 */

import { stableStringify } from "@/lib/domains/enrichment/embeddings/hashing";
import { utcDateString } from "@/lib/domains/taste/match-filters/dates";
import {
	passesAllMatchFilters,
	type SongFilterMetadata,
} from "@/lib/domains/taste/match-filters/predicates";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { strictnessScore } from "@/lib/domains/taste/song-matching/strictness";
import type { MatchOrientation, QueueVisibilityConfigHashInput } from "./types";

/**
 * The frozen-at-session-start description of what is visible: review direction,
 * the quality bar, and the per-playlist filter config. One value drives both
 * queue derivation and card presentation.
 */
export interface VisibilityPolicy {
	orientation: MatchOrientation;
	minScore: number;
	/**
	 * Filter config keyed by playlist ID. A `null` entry (or a missing key) means
	 * "no filter set" — the filter step passes. Filters apply to the target
	 * playlist a pair touches: the suggestion playlist in song orientation, the
	 * review subject playlist in playlist orientation.
	 */
	filtersByPlaylistId: ReadonlyMap<string, PlaylistMatchFiltersV1 | null>;
}

/**
 * All-null song metadata. Substituted whenever a song's filter metadata is
 * absent so that any active playlist filter fails deterministically rather than
 * passing through — the "missing metadata fails active filters" contract. A
 * filter object with no active constraints still passes against this struct.
 */
export const NULL_SONG_FILTER_METADATA: SongFilterMetadata = {
	language: null,
	languageSecondary: null,
	releaseYear: null,
	vocalGender: null,
	likedAt: null,
};

/**
 * Shared filter step. Returns true when a pair's suggestion song passes the
 * playlist's filters (or when the playlist has no filters set).
 *
 * - No filters (null/undefined) → pass.
 * - Filters set, song metadata missing → evaluate against all-null metadata, so
 *   any active filter fails but an empty filter object still passes.
 *
 * `nowMs` is forwarded to the liked-date predicate for `end.kind="today"`.
 */
export function passesPlaylistFilters(
	filters: PlaylistMatchFiltersV1 | null | undefined,
	songMeta: SongFilterMetadata | null | undefined,
	nowMs: number,
): boolean {
	if (filters === undefined || filters === null) return true;
	return passesAllMatchFilters(
		filters,
		songMeta ?? NULL_SONG_FILTER_METADATA,
		nowMs,
	);
}

/**
 * The single pair-level visibility predicate, shared by queue derivation and
 * card presentation. A pair is visible under the policy when it passes
 * strictness, is undecided, and passes its playlist's filters.
 */
export function passesVisibilityPolicyForPair(input: {
	row: {
		song_id: string;
		playlist_id: string;
		score: number;
		fused_score: number | null;
	};
	policy: VisibilityPolicy;
	decidedPairs: ReadonlySet<string>;
	songMetaBySongId: ReadonlyMap<string, SongFilterMetadata>;
	nowMs: number;
}): boolean {
	const { row, policy, decidedPairs, songMetaBySongId, nowMs } = input;
	if (strictnessScore(row) < policy.minScore) return false;
	if (decidedPairs.has(`${row.song_id}:${row.playlist_id}`)) return false;
	return passesPlaylistFilters(
		policy.filtersByPlaylistId.get(row.playlist_id),
		songMetaBySongId.get(row.song_id),
		nowMs,
	);
}

/**
 * True when any playlist's liked-at filter resolves its upper bound to "today"
 * (`{ kind: "range", end: { kind: "today" } }`). Such a filter's visible set
 * shifts at UTC midnight even though its stored config never changes, so the
 * idempotency hash must fold in the resolved date to stay correct across the
 * boundary (Finding 3).
 */
function filtersResolveAgainstToday(
	filtersByPlaylistId: ReadonlyMap<string, PlaylistMatchFiltersV1 | null>,
): boolean {
	for (const filters of filtersByPlaylistId.values()) {
		const likedAt = filters?.likedAt;
		if (likedAt?.kind === "range" && likedAt.end.kind === "today") return true;
	}
	return false;
}

/**
 * Derives a compact deterministic hash from per-playlist read-time filter
 * configs. Sorted by playlist ID so insertion order never affects the hash.
 *
 * A djb2-style polynomial hash over the stable JSON representation is
 * sufficient for idempotency keying — no collision resistance is required
 * (same rationale as the visibility hash's simple-string approach).
 *
 * When `nowMs` is supplied and a liked-at "today" filter is active, the resolved
 * UTC date is folded into the hashed content so the same stored config yields a
 * different hash after midnight — letting appendSnapshotDelta re-evaluate a
 * snapshot whose visibility widened overnight instead of short-circuiting on the
 * already-applied key (Finding 3). Configs without a "today" filter keep their
 * existing hashes, since the date is only appended when it can change visibility.
 */
export function computeReadTimeFiltersHash(
	filtersByPlaylistId: ReadonlyMap<string, PlaylistMatchFiltersV1 | null>,
	nowMs?: number,
): string {
	const sorted = [...filtersByPlaylistId.entries()].sort(([a], [b]) =>
		a.localeCompare(b),
	);
	let content = stableStringify(Object.fromEntries(sorted));
	if (nowMs !== undefined && filtersResolveAgainstToday(filtersByPlaylistId)) {
		content += `|today=${utcDateString(nowMs)}`;
	}
	let h = 0;
	for (let i = 0; i < content.length; i++) {
		h = (Math.imul(31, h) + content.charCodeAt(i)) | 0;
	}
	return `rtf_${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Derives a deterministic string key from raw visibility inputs.
 *
 * orientation + strictness threshold + readTimeFiltersHash together determine
 * which subjects are visible at enqueue time. Stored in
 * match_review_session_snapshot so the same (snapshot, hash) is idempotent
 * while a changed hash allows append-without-duplication (C9).
 */
export function computeVisibilityConfigHash(
	input: QueueVisibilityConfigHashInput,
): string {
	return `vc_${input.orientation}_${input.minScore}_${input.readTimeFiltersHash}`;
}

/**
 * Policy-level counterpart to computeVisibilityConfigHash: derives the
 * read-time filter hash from the policy's filter map and produces the same
 * `vc_<orientation>_<minScore>_<rtfHash>` key. This is the entry point queue
 * derivation uses so the hash always reflects the exact policy that was applied.
 *
 * `nowMs` is forwarded to computeReadTimeFiltersHash so a liked-at "today" filter
 * folds the resolved UTC date into the hash (Finding 3); pass the same nowMs the
 * derivation evaluates filters against so the hash and the visible set agree.
 */
export function computeVisibilityPolicyHash(
	policy: VisibilityPolicy,
	nowMs?: number,
): string {
	return computeVisibilityConfigHash({
		orientation: policy.orientation,
		minScore: policy.minScore,
		readTimeFiltersHash: computeReadTimeFiltersHash(
			policy.filtersByPlaylistId,
			nowMs,
		),
	});
}
