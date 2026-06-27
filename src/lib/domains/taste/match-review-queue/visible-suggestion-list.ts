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
import {
	passesAllMatchFilters,
	type SongFilterMetadata,
} from "@/lib/domains/taste/match-filters/predicates";
import { parseStoredMatchFilters } from "@/lib/domains/taste/match-filters/schemas";
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
	/** Song metadata for read-time filter evaluation. When present alongside
	 *  playlistFilters, passesAllMatchFilters is applied. Missing metadata
	 *  fails any active filter — there is no "unknown" pass-through (MSR-36). */
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
		// Apply hard filters when both playlist config and song metadata are
		// present — AND across filter types, OR within language codes, missing
		// metadata fails any active filter (MSR-36, story constraint).
		if (
			p.playlistFilters !== undefined &&
			p.playlistFilters !== null &&
			p.songMeta !== undefined &&
			p.songMeta !== null
		) {
			if (!passesAllMatchFilters(p.playlistFilters, p.songMeta, resolvedNowMs))
				return false;
		}
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
 * Fetches language, vocal gender, release year, and liked-at metadata for
 * a single song. Used by the song-orientation visible-list path to supply
 * songMeta to deriveVisibleSuggestions (MSR-36).
 *
 * liked_at is resolved from liked_song (active rows only; unliked_at IS NULL).
 * Returns a default-null metadata object when the song row is absent so
 * any active filter fails deterministically rather than passing silently.
 */
async function fetchSongFilterMeta(
	accountId: string,
	songId: string,
): Promise<Result<SongFilterMetadata, DbError>> {
	const supabase = createAdminSupabaseClient();
	const [songResult, likedResult] = await Promise.all([
		supabase
			.from("song")
			.select("language, language_secondary, release_year, vocal_gender")
			.eq("id", songId)
			.maybeSingle(),
		supabase
			.from("liked_song")
			.select("liked_at")
			.eq("song_id", songId)
			.eq("account_id", accountId)
			.is("unliked_at", null)
			.maybeSingle(),
	]);
	if (songResult.error) {
		return Result.err(
			new DatabaseError({
				code: songResult.error.code,
				message: songResult.error.message,
			}),
		);
	}
	if (likedResult.error) {
		return Result.err(
			new DatabaseError({
				code: likedResult.error.code,
				message: likedResult.error.message,
			}),
		);
	}
	return Result.ok({
		language: songResult.data?.language ?? null,
		languageSecondary: songResult.data?.language_secondary ?? null,
		releaseYear: songResult.data?.release_year ?? null,
		vocalGender: songResult.data?.vocal_gender ?? null,
		likedAt: likedResult.data
			? new Date(likedResult.data.liked_at).getTime()
			: null,
	});
}

/**
 * Fetches language, vocal gender, release year, and liked-at metadata for
 * multiple songs in a single round-trip pair. Used by the playlist-orientation
 * visible-list path (MSR-36).
 *
 * Songs not found in the song table are omitted from the returned map; callers
 * treat absent entries as all-null metadata, which causes any active filter to fail.
 */
async function fetchSongsFilterMeta(
	accountId: string,
	songIds: readonly string[],
): Promise<Result<Map<string, SongFilterMetadata>, DbError>> {
	if (songIds.length === 0) return Result.ok(new Map());
	const ids = [...songIds];
	const supabase = createAdminSupabaseClient();
	const [songsResult, likedResult] = await Promise.all([
		supabase
			.from("song")
			.select("id, language, language_secondary, release_year, vocal_gender")
			.in("id", ids),
		supabase
			.from("liked_song")
			.select("song_id, liked_at")
			.in("song_id", ids)
			.eq("account_id", accountId)
			.is("unliked_at", null),
	]);
	if (songsResult.error) {
		return Result.err(
			new DatabaseError({
				code: songsResult.error.code,
				message: songsResult.error.message,
			}),
		);
	}
	if (likedResult.error) {
		return Result.err(
			new DatabaseError({
				code: likedResult.error.code,
				message: likedResult.error.message,
			}),
		);
	}
	const likedMap = new Map<string, number>();
	for (const row of likedResult.data ?? []) {
		likedMap.set(row.song_id, new Date(row.liked_at).getTime());
	}
	const metaMap = new Map<string, SongFilterMetadata>();
	for (const row of songsResult.data ?? []) {
		metaMap.set(row.id, {
			language: row.language,
			languageSecondary: row.language_secondary,
			releaseYear: row.release_year,
			vocalGender: row.vocal_gender,
			likedAt: likedMap.get(row.id) ?? null,
		});
	}
	return Result.ok(metaMap);
}

/**
 * Fetches match_filters for a set of playlists. Used in song-orientation to
 * supply per-suggestion-playlist filter config to deriveVisibleSuggestions.
 * Playlists with no match_filters row or null column map to null (no filter).
 */
async function fetchPlaylistsMatchFilters(
	playlistIds: readonly string[],
): Promise<Result<Map<string, PlaylistMatchFiltersV1 | null>, DbError>> {
	if (playlistIds.length === 0) return Result.ok(new Map());
	const ids = [...playlistIds];
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("playlist")
		.select("id, match_filters")
		.in("id", ids);
	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}
	const map = new Map<string, PlaylistMatchFiltersV1 | null>();
	for (const row of data ?? []) {
		if (row.match_filters === null) {
			map.set(row.id, null);
		} else {
			const { value } = parseStoredMatchFilters(row.match_filters);
			map.set(row.id, value);
		}
	}
	return Result.ok(map);
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
	const { data, error } = await supabase
		.from("playlist")
		.select("id")
		.eq("account_id", accountId)
		.in("id", [...playlistIds]);
	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}
	return Result.ok(new Set((data ?? []).map((r) => r.id)));
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
			songMeta: songsMetaResult.value.get(r.song_id) ?? {
				language: null,
				languageSecondary: null,
				releaseYear: null,
				vocalGender: null,
				likedAt: null,
			},
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
