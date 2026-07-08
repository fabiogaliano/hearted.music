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
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { getMatchDecisionsForSongs } from "@/lib/domains/taste/song-matching/decision-queries";
import {
	getMatchResults,
	type MatchResultRow,
} from "@/lib/domains/taste/song-matching/queries";
import type { DbError } from "@/lib/shared/errors/database";
import { DatabaseError } from "@/lib/shared/errors/database";
import { fetchSongsFilterMeta } from "./filter-metadata-queries";
import { fetchOwnedPlaylistIds, fetchTargetPlaylistFilters } from "./queries";
import { getOrderedUndecidedSubjects } from "./review-subject-selector";
import type { MatchOrientation, OrderedSubject } from "./types";
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
	/** The target-playlist filters this derivation read — returned so the caller
	 *  hashes the same map (with the same nowMs) it derived against, keeping the
	 *  proposal's visibility_config_hash stable. */
	filtersByPlaylistId: ReadonlyMap<string, PlaylistMatchFiltersV1 | null>;
}

/**
 * Loads the inputs (match results, decisions, newness, the entitlement RPC, song
 * filter metadata, owned playlists, target filters) and derives ordered eligible
 * subjects under a policy frozen to `minScore`. Sessionless — the already-queued
 * exclusion is the appender's job.
 *
 * The entitlement/ownership prefilters are REQUIRED: getOrderedUndecidedSubjects
 * alone does not apply them, so omitting them here would diverge subject order.
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
	const targetFiltersResult = await fetchTargetPlaylistFilters(accountId);
	if (Result.isError(targetFiltersResult)) return targetFiltersResult;
	const filtersByPlaylistId = targetFiltersResult.value;

	const policy: VisibilityPolicy = {
		orientation,
		minScore,
		filtersByPlaylistId,
	};

	const matchResultsResult = await getMatchResults(snapshotId);
	if (Result.isError(matchResultsResult)) return matchResultsResult;
	const matchResults = matchResultsResult.value;
	if (matchResults.length === 0) {
		return Result.ok({
			subjects: [],
			hiddenReviewItemCount: 0,
			filtersByPlaylistId,
		});
	}

	const songIds = [...new Set(matchResults.map((mr) => mr.song_id))];
	const playlistIds = [...new Set(matchResults.map((mr) => mr.playlist_id))];

	const [
		newSongIdsResult,
		entitledResult,
		songMetaResult,
		ownedPlaylistsResult,
		decisionsResult,
	] = await Promise.all([
		getNewItemIds(accountId, "song"),
		createAdminSupabaseClient().rpc(
			"select_entitled_data_enriched_liked_song_ids",
			{ p_account_id: accountId },
		),
		fetchSongsFilterMeta(accountId, songIds),
		fetchOwnedPlaylistIds(accountId, playlistIds),
		getMatchDecisionsForSongs(accountId, songIds),
	]);

	if (Result.isError(newSongIdsResult)) return newSongIdsResult;
	if (Result.isError(songMetaResult)) return songMetaResult;
	if (Result.isError(ownedPlaylistsResult)) return ownedPlaylistsResult;
	if (Result.isError(decisionsResult)) return decisionsResult;
	// An entitlement RPC failure must NOT be read as "nothing is entitled" — that
	// would build an empty proposal that then masks every valid match. Surface it.
	if (entitledResult.error) {
		return Result.err(
			new DatabaseError({
				code: entitledResult.error.code,
				message: entitledResult.error.message,
			}),
		);
	}

	const decidedPairs = new Set(
		decisionsResult.value.map((d) => `${d.song_id}:${d.playlist_id}`),
	);
	const newSongSet = new Set(newSongIdsResult.value);
	const entitledSet = new Set<string>(
		(entitledResult.data ?? []).map((r) => r.song_id),
	);

	const { subjects, hiddenReviewItemCount } = deriveEligibleSubjects({
		matchResults,
		decidedPairs,
		policy,
		entitledSongIds: entitledSet,
		ownedPlaylistIds: ownedPlaylistsResult.value,
		newSongIds: newSongSet,
		songMetaBySongId: songMetaResult.value,
		nowMs,
	});

	return Result.ok({ subjects, hiddenReviewItemCount, filtersByPlaylistId });
}
