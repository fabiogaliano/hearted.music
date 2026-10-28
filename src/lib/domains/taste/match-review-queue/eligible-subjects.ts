/**
 * Eligible-subject derivation — the shared seam so the dashboard preview
 * (service.ts) and the worker proposal builder order subjects identically.
 *
 * `deriveEligibleSubjects` is the pure entitlement/ownership prefilter + ordered
 * derivation; routing both callers through one symbol makes subject order agree
 * by construction, not convention. `deriveProposalSubjects` loads the inputs and
 * runs it, so a proposal's subject order matches what the preview derives.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { getNewItemIds } from "@/lib/domains/library/liked-songs/status-queries";
import type { SongFilterMetadata } from "@/lib/domains/taste/match-filters/predicates";
import type { MatchResultRow } from "@/lib/domains/taste/song-matching/queries";
import type { DbError } from "@/lib/shared/errors/database";
import { getOrderedUndecidedSubjects } from "./review-subject-selector";
import type { MatchOrientation, OrderedSubject } from "./types";
import { loadVisibilityInputs } from "./visibility-inputs";
import type { VisibilityPolicy } from "./visibility-policy";

/**
 * Restricts snapshot match results to *eligible* pairs — song still entitled to
 * the account AND playlist still owned by it — before deriving ordered subjects
 * under the visibility policy.
 *
 * Eligibility is symmetric across orientation: a pair can only ever render on a
 * card when its song is entitled (the suggestion in playlist mode, the subject in
 * song mode) and its playlist is owned (the subject in playlist mode, the
 * suggestion in song mode). Pre-filtering here means the selector's ordering,
 * sourceScore, and hidden count all reflect exactly the pairs a card could show —
 * closing the gap where a non-entitled song or non-owned playlist drove ordering
 * or marked a subject queue-eligible that card visibility would later drop
 * (Findings 1 & 2).
 */
export function deriveEligibleSubjects(input: {
	matchResults: MatchResultRow[];
	decidedPairs: ReadonlySet<string>;
	policy: VisibilityPolicy;
	entitledSongIds: ReadonlySet<string>;
	ownedPlaylistIds: ReadonlySet<string>;
	newSongIds: ReadonlySet<string>;
	songMetaBySongId: ReadonlyMap<string, SongFilterMetadata>;
	nowMs: number;
}): { subjects: OrderedSubject[]; hiddenReviewItemCount: number } {
	const eligible = input.matchResults.filter(
		(mr) =>
			input.entitledSongIds.has(mr.song_id) &&
			input.ownedPlaylistIds.has(mr.playlist_id),
	);
	return getOrderedUndecidedSubjects({ ...input, matchResults: eligible });
}

export interface ProposalSubjectsDerivation {
	subjects: OrderedSubject[];
	hiddenReviewItemCount: number;
}

/**
 * Loads the snapshot's visibility inputs (and, in song orientation, newness)
 * and derives ordered eligible subjects under a policy frozen to `minScore`.
 * Sessionless — the already-queued exclusion is the appender's job.
 *
 * The entitlement/ownership prefilters are REQUIRED: getOrderedUndecidedSubjects
 * alone does not apply them, so omitting them here would diverge subject order.
 *
 * Filters come from every playlist in the pairs, target or not — the source the
 * card reads — so a subject is never queued on a pair its card would hide.
 *
 * One `nowMs` is threaded in by the caller so the caller's hash and this
 * derivation's filter evaluation fold the same UTC date (liked-at "today").
 */
export async function deriveProposalSubjects(
	accountId: string,
	orientation: MatchOrientation,
	snapshotId: string,
	minScore: number,
	nowMs: number,
): Promise<Result<ProposalSubjectsDerivation, DbError>> {
	const [inputsResult, newSongIdsResult] = await Promise.all([
		loadVisibilityInputs(createAdminSupabaseClient(), {
			kind: "account",
			accountId,
			snapshotId,
		}),
		// Newness only orders song subjects.
		orientation === "song"
			? getNewItemIds(accountId, "song")
			: Result.ok<string[], DbError>([]),
	]);
	// A failed read must NOT be read as "nothing is entitled" — that would build
	// an empty proposal that then masks every valid match. Surface it.
	if (Result.isError(inputsResult)) return inputsResult;
	if (Result.isError(newSongIdsResult)) return newSongIdsResult;
	const inputs = inputsResult.value;

	return Result.ok(
		deriveEligibleSubjects({
			matchResults: inputs.pairs,
			decidedPairs: inputs.decidedPairs,
			policy: {
				orientation,
				minScore,
				filtersByPlaylistId: inputs.filtersByPlaylistId,
			},
			entitledSongIds: inputs.entitledSongIds,
			ownedPlaylistIds: inputs.ownedPlaylistIds,
			newSongIds: new Set(newSongIdsResult.value),
			songMetaBySongId: inputs.songMetaBySongId,
			nowMs,
		}),
	);
}
