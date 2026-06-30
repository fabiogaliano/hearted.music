/**
 * Visible suggestion list — derivation helper.
 *
 * A VisibleSuggestionList is the ordered set of suggestions shown to the user
 * for one queue item after strictness and read-time filters are applied. It is
 * the shared contract consumed by MSR-23/24/25/27/28/36 for capture, add, and
 * dismiss paths. All filter and visibility logic is centralised here so
 * downstream callers never re-derive the set independently.
 *
 * Terminology (from match-system-terminology-decisions.md):
 *  B4  — VisibleSuggestionList / VisibleSuggestion
 *  B5  — modelRank (from match_result_ranking), visibleRank (dense visible)
 *  A5  — fitScore = strictnessScore(row), shown as match percent
 *  C12 — inside-card order: orientation-specific model rank, then strictness
 *        desc + stable ID tiebreaker for unranked pairs
 *  E7  — strictnessScore(row) is the canonical quality signal, never reranker
 *  F2  — module lives in match-review-queue domain
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { SongFilterMetadata } from "@/lib/domains/taste/match-filters/predicates";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import type {
	MatchOrientation,
	MatchReviewQueueItemDto,
	MatchReviewSubject,
} from "@/lib/domains/taste/match-review-queue/types";
import {
	getMatchDecisionsForPlaylist,
	getMatchDecisionsForSongs,
} from "@/lib/domains/taste/song-matching/decision-queries";
import {
	getMatchPairsForPlaylist,
	getMatchPairsForSong,
	getMatchRankingsForPlaylist,
	getMatchRankingsForSong,
} from "@/lib/domains/taste/song-matching/queries";
import { strictnessScore } from "@/lib/domains/taste/song-matching/strictness";
import type { DbError } from "@/lib/shared/errors/database";
import { DatabaseError } from "@/lib/shared/errors/database";
import { chunkedRead } from "@/lib/shared/utils/chunked-read";
import { fromSupabaseMany } from "@/lib/shared/utils/result-wrappers/supabase";
import {
	fetchPlaylistsMatchFilters,
	fetchSongFilterMeta,
	fetchSongsFilterMeta,
} from "./filter-metadata-queries";
import {
	NULL_SONG_FILTER_METADATA,
	passesPlaylistFilters,
} from "./visibility-policy";

/**
 * A single (song, playlist) pair as shown to the user (B4, B5, A5, C12).
 *
 * modelRank:   1-based rank from match_result_ranking (cross-encoder or
 *              fused-fallback ordering). Stable across users viewing the
 *              same snapshot. Unranked pairs (no ranking row) receive a
 *              synthetic rank beyond the last ranked pair, so all visible
 *              suggestions carry a contiguous numeric rank.
 * visibleRank: 1-based dense rank within the subset actually visible to
 *              this user after strictness/read-time filters are applied.
 * fitScore:    Value returned by strictnessScore() for this row — the
 *              quality signal shown to the user as match percent. Never
 *              the reranker/ordering score (E7).
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

/**
 * Typed result from computeVisibleSuggestionList — expected failures are
 * represented here rather than thrown so callers can branch without try/catch.
 *
 * not-entitled: the subject entity is no longer accessible to the account
 *   (song revoked / playlist deleted or transferred). The card should surface
 *   as unavailable rather than silently showing an empty suggestion set.
 * db-error: an unexpected query failure; caller decides retry vs error state.
 */
export type VisibleSuggestionListResult =
	| { kind: "ok"; list: VisibleSuggestionList }
	| {
			kind: "not-entitled";
			reason: "song-not-entitled" | "playlist-not-owned";
	  }
	| { kind: "db-error"; error: DbError };

/** Raw pair data from match_result, camelCased for the pure function. */
export interface MatchPairInput {
	songId: string;
	playlistId: string;
	score: number;
	fusedScore: number | null;
	/** Song metadata for read-time filter evaluation. Applied via
	 *  passesAllMatchFilters whenever playlistFilters carries config. A
	 *  null/undefined value is treated as all-null metadata, so any active
	 *  filter fails — there is no "unknown" pass-through (MSR-36). */
	songMeta?: SongFilterMetadata | null;
	/** Parsed filters from the playlist's match_filters column. Applied
	 *  against songMeta when both are present (MSR-36). */
	playlistFilters?: PlaylistMatchFiltersV1 | null;
}

/** Ranking data from match_result_ranking, camelCased for the pure function. */
export interface RankingInput {
	songId: string;
	playlistId: string;
	rank: number;
	orderingScore: number;
}

/**
 * Derives the ordered visible suggestion list from raw pair and ranking data.
 *
 * Steps:
 *  1. Filter pairs that pass strictness (fitScore >= minScore).
 *  2. Remove already-decided pairs.
 *  3. Join with ranking rows; split into ranked / unranked buckets.
 *  4. Sort ranked pairs by modelRank ASC, unranked by fitScore DESC then
 *     stable suggestion-side ID ASC (C12 tiebreaker).
 *  5. Assign dense visibleRank (1, 2, 3, …) across the joined ordered set.
 *  6. Assign modelRank: ranked pairs use the ranking row rank; unranked pairs
 *     receive a synthetic rank starting after the highest ranked pair's rank
 *     so the entire visible list is contiguous and deterministic.
 *
 * Pure: no side effects, no DB calls. Accepts the MatchPairInput /
 * RankingInput shapes that the query helpers return so tests can drive it
 * directly.
 */
export function deriveVisibleSuggestions(
	subject: MatchReviewSubject,
	pairs: readonly MatchPairInput[],
	rankings: readonly RankingInput[],
	decidedPairKeys: ReadonlySet<string>,
	minScore: number,
	nowMs?: number,
): VisibleSuggestion[] {
	// Build a lookup from "songId:playlistId" → ranking so the join is O(n).
	const rankingMap = new Map<string, { rank: number; orderingScore: number }>();
	for (const r of rankings) {
		rankingMap.set(`${r.songId}:${r.playlistId}`, {
			rank: r.rank,
			orderingScore: r.orderingScore,
		});
	}

	const resolvedNowMs = nowMs ?? Date.now();
	const eligible = pairs.filter((p) => {
		const fs = strictnessScore({ score: p.score, fused_score: p.fusedScore });
		if (fs < minScore) return false;
		if (decidedPairKeys.has(`${p.songId}:${p.playlistId}`)) return false;
		// Same shared filter step the queue derivation uses: a playlist with no
		// filter config passes; missing song metadata is treated as all-null so any
		// active filter fails rather than passing through (MSR-36, story constraint).
		if (!passesPlaylistFilters(p.playlistFilters, p.songMeta, resolvedNowMs))
			return false;
		return true;
	});

	type RankedEntry = {
		pair: MatchPairInput;
		fitScore: number;
		modelRank: number;
	};
	type UnrankedEntry = { pair: MatchPairInput; fitScore: number };

	const ranked: RankedEntry[] = [];
	const unranked: UnrankedEntry[] = [];

	for (const pair of eligible) {
		const pairKey = `${pair.songId}:${pair.playlistId}`;
		const ranking = rankingMap.get(pairKey);
		const fitScore = strictnessScore({
			score: pair.score,
			fused_score: pair.fusedScore,
		});
		if (ranking !== undefined) {
			ranked.push({ pair, fitScore, modelRank: ranking.rank });
		} else {
			unranked.push({ pair, fitScore });
		}
	}

	ranked.sort((a, b) => a.modelRank - b.modelRank);

	// Sort unranked by fitScore desc then stable suggestion-side ID asc (C12).
	// For song orientation the stable ID is playlist_id; for playlist orientation
	// it is song_id — the "other side" of the reviewed subject.
	const stableId = (p: MatchPairInput): string =>
		subject.orientation === "song" ? p.playlistId : p.songId;

	unranked.sort((a, b) => {
		if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
		return stableId(a.pair).localeCompare(stableId(b.pair));
	});

	// Determine the offset for synthetic model ranks on unranked pairs so the
	// full visible list is contiguous (ranked occupy 1..maxRanked; unranked
	// start at maxRanked + 1).
	const maxRankedModelRank =
		ranked.length > 0 ? Math.max(...ranked.map((r) => r.modelRank)) : 0;

	const suggestions: VisibleSuggestion[] = [];
	let visibleRank = 1;

	for (const item of ranked) {
		suggestions.push({
			songId: item.pair.songId,
			playlistId: item.pair.playlistId,
			fitScore: item.fitScore,
			modelRank: item.modelRank,
			visibleRank: visibleRank++,
		});
	}

	for (let i = 0; i < unranked.length; i++) {
		const item = unranked[i];
		suggestions.push({
			songId: item.pair.songId,
			playlistId: item.pair.playlistId,
			fitScore: item.fitScore,
			// Synthetic rank starts after the last ranked pair's rank (or at 1 when
			// there are no ranked pairs) so callers can detect the unranked region.
			modelRank: maxRankedModelRank + i + 1,
			visibleRank: visibleRank++,
		});
	}

	return suggestions;
}

/**
 * Checks that the song subject is still accessible to the account via the
 * is_account_song_entitled RPC. Returns false for a missing or revoked song.
 */
async function checkSongEntitled(
	accountId: string,
	songId: string,
): Promise<Result<boolean, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc("is_account_song_entitled", {
		p_account_id: accountId,
		p_song_id: songId,
	});
	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}
	return Result.ok(data === true);
}

/**
 * Checks that the playlist subject is still owned by the account by looking
 * up the playlist row's account_id. Returns false when the playlist is
 * deleted or now owned by a different account.
 */
async function checkPlaylistOwned(
	accountId: string,
	playlistId: string,
): Promise<Result<boolean, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("playlist")
		.select("id")
		.eq("id", playlistId)
		.eq("account_id", accountId)
		.maybeSingle();
	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}
	return Result.ok(data !== null);
}

/**
 * Returns the subset of the given playlist IDs that still belong to the account,
 * in a single query. Used by the song-orientation path to drop suggestion
 * playlists that were deleted or transferred before visible ranks are assigned,
 * so a foreign/stale playlist is never shown and then rejected at add time.
 */
async function fetchOwnedPlaylistIds(
	accountId: string,
	playlistIds: readonly string[],
): Promise<Result<Set<string>, DbError>> {
	if (playlistIds.length === 0) return Result.ok(new Set());
	const supabase = createAdminSupabaseClient();
	// Chunk the `.in()` ids so the query string stays under the URI-length limit;
	// merge the surviving ids into one Set (duplicates collapse naturally).
	const rowsResult = await chunkedRead(playlistIds, (batch) =>
		fromSupabaseMany(
			supabase
				.from("playlist")
				.select("id")
				.eq("account_id", accountId)
				.in("id", batch),
		),
	);
	if (Result.isError(rowsResult)) return rowsResult;
	const owned = new Set<string>();
	for (const row of rowsResult.value) owned.add(row.id);
	return Result.ok(owned);
}

/**
 * Returns the subset of the given song IDs that are still entitled to the
 * account. Used by the playlist-orientation path to drop suggestion songs whose
 * entitlement was revoked before visible ranks are assigned. Uses the same bulk
 * entitlement RPC the queue-append path uses, so the two agree by sharing one
 * source rather than by convention, and avoids an N+1 of per-song checks.
 */
async function fetchEntitledSongIds(
	accountId: string,
	songIds: readonly string[],
): Promise<Result<Set<string>, DbError>> {
	if (songIds.length === 0) return Result.ok(new Set());
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc(
		"select_entitled_data_enriched_liked_song_ids",
		{ p_account_id: accountId },
	);
	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}
	const entitled = new Set((data ?? []).map((r) => r.song_id));
	return Result.ok(new Set(songIds.filter((id) => entitled.has(id))));
}

/**
 * Derives the visible suggestion list for a queue item.
 *
 * The item must already have passed the ownership check (loaded via
 * fetchOwnedQueueItem or equivalent) — this function does NOT re-verify queue
 * item ownership. It does check entity-level entitlement so callers receive
 * a typed not-entitled result rather than an unexpected empty suggestion set.
 *
 * strictnessMinScore comes from the session stored at queue creation time,
 * not from a live preference re-read, so the bar cannot shift on a card the
 * user is already reviewing.
 *
 * Returns:
 *  { kind: 'ok', list } — list may have an empty suggestions array when all
 *    pairs are decided or below the strictness threshold.
 *  { kind: 'not-entitled', reason } — the subject entity is no longer
 *    accessible; the card should surface as unavailable.
 *  { kind: 'db-error', error } — unexpected query failure.
 */
export async function computeVisibleSuggestionList(
	item: MatchReviewQueueItemDto,
	strictnessMinScore: number,
): Promise<VisibleSuggestionListResult> {
	const { subject, accountId, sourceSnapshotId } = item;

	// Entitlement check is orientation-specific.
	if (subject.orientation === "song") {
		const entitled = await checkSongEntitled(accountId, subject.songId);
		if (Result.isError(entitled))
			return { kind: "db-error", error: entitled.error };
		if (!entitled.value)
			return { kind: "not-entitled", reason: "song-not-entitled" };

		const nowMs = Date.now();
		const [pairsResult, rankingsResult, decisionsResult, songMetaResult] =
			await Promise.all([
				getMatchPairsForSong(sourceSnapshotId, subject.songId),
				getMatchRankingsForSong(sourceSnapshotId, subject.songId),
				getMatchDecisionsForSongs(accountId, [subject.songId]),
				fetchSongFilterMeta(accountId, subject.songId),
			]);

		if (Result.isError(pairsResult))
			return { kind: "db-error", error: pairsResult.error };
		if (Result.isError(rankingsResult))
			return { kind: "db-error", error: rankingsResult.error };
		if (Result.isError(decisionsResult))
			return { kind: "db-error", error: decisionsResult.error };
		if (Result.isError(songMetaResult))
			return { kind: "db-error", error: songMetaResult.error };

		const playlistIds = [
			...new Set(pairsResult.value.map((r) => r.playlist_id)),
		];
		// Fetch suggestion-playlist filters and account ownership together. Foreign/
		// deleted suggestion playlists are excluded here, before visible ranks are
		// assigned, so they are never shown only to be rejected at add time.
		const [playlistFiltersResult, ownedPlaylistsResult] = await Promise.all([
			fetchPlaylistsMatchFilters(playlistIds),
			fetchOwnedPlaylistIds(accountId, playlistIds),
		]);
		if (Result.isError(playlistFiltersResult))
			return { kind: "db-error", error: playlistFiltersResult.error };
		if (Result.isError(ownedPlaylistsResult))
			return { kind: "db-error", error: ownedPlaylistsResult.error };

		const ownedPlaylists = ownedPlaylistsResult.value;

		const decidedPairKeys = new Set(
			decisionsResult.value.map((d) => `${d.song_id}:${d.playlist_id}`),
		);

		const songMeta = songMetaResult.value;

		const pairs: MatchPairInput[] = pairsResult.value
			.filter((r) => ownedPlaylists.has(r.playlist_id))
			.map((r) => ({
				songId: r.song_id,
				playlistId: r.playlist_id,
				score: r.score,
				fusedScore: r.fused_score,
				songMeta,
				playlistFilters: playlistFiltersResult.value.get(r.playlist_id) ?? null,
			}));

		const rankings: RankingInput[] = rankingsResult.value.map((r) => ({
			songId: r.song_id,
			playlistId: r.playlist_id,
			rank: r.rank,
			orderingScore: r.ordering_score,
		}));

		const suggestions = deriveVisibleSuggestions(
			subject,
			pairs,
			rankings,
			decidedPairKeys,
			strictnessMinScore,
			nowMs,
		);

		return {
			kind: "ok",
			list: { orientation: "song", subject, suggestions },
		};
	}

	// Playlist orientation: subject is a playlist, suggestions are songs.
	const nowMs = Date.now();
	const owned = await checkPlaylistOwned(accountId, subject.playlistId);
	if (Result.isError(owned)) return { kind: "db-error", error: owned.error };
	if (!owned.value)
		return { kind: "not-entitled", reason: "playlist-not-owned" };

	const [pairsResult, rankingsResult, decisionsResult, playlistFiltersResult] =
		await Promise.all([
			getMatchPairsForPlaylist(sourceSnapshotId, subject.playlistId),
			getMatchRankingsForPlaylist(sourceSnapshotId, subject.playlistId),
			getMatchDecisionsForPlaylist(accountId, subject.playlistId),
			fetchPlaylistsMatchFilters([subject.playlistId]),
		]);

	if (Result.isError(pairsResult))
		return { kind: "db-error", error: pairsResult.error };
	if (Result.isError(rankingsResult))
		return { kind: "db-error", error: rankingsResult.error };
	if (Result.isError(decisionsResult))
		return { kind: "db-error", error: decisionsResult.error };
	if (Result.isError(playlistFiltersResult))
		return { kind: "db-error", error: playlistFiltersResult.error };

	const songIds = [...new Set(pairsResult.value.map((r) => r.song_id))];
	// Fetch suggestion-song filter metadata and account entitlement together.
	// Non-entitled suggestion songs are excluded here, before visible ranks are
	// assigned, so a revoked song is never shown only to be rejected at add time.
	const [songsMetaResult, entitledSongsResult] = await Promise.all([
		fetchSongsFilterMeta(accountId, songIds),
		fetchEntitledSongIds(accountId, songIds),
	]);
	if (Result.isError(songsMetaResult))
		return { kind: "db-error", error: songsMetaResult.error };
	if (Result.isError(entitledSongsResult))
		return { kind: "db-error", error: entitledSongsResult.error };

	const entitledSongs = entitledSongsResult.value;

	const reviewPlaylistFilters =
		playlistFiltersResult.value.get(subject.playlistId) ?? null;

	const decidedPairKeys = new Set(
		decisionsResult.value.map((d) => `${d.song_id}:${d.playlist_id}`),
	);

	const pairs: MatchPairInput[] = pairsResult.value
		.filter((r) => entitledSongs.has(r.song_id))
		.map((r) => ({
			songId: r.song_id,
			playlistId: r.playlist_id,
			score: r.score,
			fusedScore: r.fused_score,
			songMeta:
				songsMetaResult.value.get(r.song_id) ?? NULL_SONG_FILTER_METADATA,
			playlistFilters: reviewPlaylistFilters,
		}));

	const rankings: RankingInput[] = rankingsResult.value.map((r) => ({
		songId: r.song_id,
		playlistId: r.playlist_id,
		rank: r.rank,
		orderingScore: r.ordering_score,
	}));

	const suggestions = deriveVisibleSuggestions(
		subject,
		pairs,
		rankings,
		decidedPairKeys,
		strictnessMinScore,
		nowMs,
	);

	return {
		kind: "ok",
		list: { orientation: "playlist", subject, suggestions },
	};
}
