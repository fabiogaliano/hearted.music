/**
 * Stored match pair retention helper.
 *
 * The persisted pair set is the union of song-top-N and playlist-top-N to
 * ensure neither orientation's suggestion lists are starved. Without the
 * playlist-top-N half, a playlist would only appear in pairs where it survived
 * the song-oriented top-K — many relevant songs would never be stored against
 * that playlist.
 *
 * This module owns the retention decision only; scoring and fusion are
 * untouched here (MSR-12 scope). Orientation ranking later uses the stored
 * union to produce `match_result_ranking` rows (MSR-14/15).
 */

import { DEFAULT_MATCHING_CONFIG } from "./config";
import type { MatchResult } from "./types";

/**
 * Maximum playlists retained per song in the stored pair set (G4, E6).
 * Mirrors the write-time per-song cap used by the matching service.
 */
export const MATCH_STORED_PAIRS_PER_SONG =
	DEFAULT_MATCHING_CONFIG.maxResultsPerSong;

/**
 * Maximum songs retained per playlist in the stored pair set (G4, E6).
 * Mirrors the write-time per-song cap so both orientations start with equal
 * budgets; can be tuned independently once data volume is measured.
 */
export const MATCH_STORED_PAIRS_PER_PLAYLIST =
	DEFAULT_MATCHING_CONFIG.maxResultsPerSong;

/**
 * Return the union of song-top-N and playlist-top-N pairs from a
 * threshold-passing candidate set (plan §4.1, E6).
 *
 * Song-top-N:     top `perSongLimit`     playlists per song     by fusedScore desc, playlistId asc.
 * Playlist-top-N: top `perPlaylistLimit` songs     per playlist by fusedScore desc, songId asc.
 *
 * The union ensures that every pair visible in either orientation's suggestion
 * list is persisted. Duplicate (songId, playlistId) pairs collapse to one row.
 * Returned rows are sorted by songId asc, fusedScore desc, playlistId asc and
 * carry provisional legacy per-song ranks derived from that order.
 *
 * Input pairs must already have passed the write-time `minScoreThreshold` and
 * must have `fusedScore` populated. Scoring and fusion are not touched here.
 */
export function retainStoredMatchPairs(params: {
	thresholdedPairs: readonly MatchResult[];
	perSongLimit: number;
	perPlaylistLimit: number;
}): MatchResult[] {
	const { thresholdedPairs, perSongLimit, perPlaylistLimit } = params;

	if (thresholdedPairs.length === 0) return [];

	const retainedKeys = new Set<string>();

	// Song orientation: top perSongLimit playlists per song.
	const bySong = new Map<string, MatchResult[]>();
	for (const pair of thresholdedPairs) {
		let bucket = bySong.get(pair.songId);
		if (!bucket) {
			bucket = [];
			bySong.set(pair.songId, bucket);
		}
		bucket.push(pair);
	}
	for (const bucket of bySong.values()) {
		bucket
			.toSorted(
				(a, b) =>
					b.fusedScore - a.fusedScore ||
					a.playlistId.localeCompare(b.playlistId),
			)
			.slice(0, perSongLimit)
			.forEach((p) => {
				retainedKeys.add(`${p.songId}:${p.playlistId}`);
			});
	}

	// Playlist orientation: top perPlaylistLimit songs per playlist.
	const byPlaylist = new Map<string, MatchResult[]>();
	for (const pair of thresholdedPairs) {
		let bucket = byPlaylist.get(pair.playlistId);
		if (!bucket) {
			bucket = [];
			byPlaylist.set(pair.playlistId, bucket);
		}
		bucket.push(pair);
	}
	for (const bucket of byPlaylist.values()) {
		bucket
			.toSorted(
				(a, b) =>
					b.fusedScore - a.fusedScore || a.songId.localeCompare(b.songId),
			)
			.slice(0, perPlaylistLimit)
			.forEach((p) => {
				retainedKeys.add(`${p.songId}:${p.playlistId}`);
			});
	}

	// Stable output order: songId asc, fusedScore desc, playlistId asc.
	const sorted = thresholdedPairs
		.filter((p) => retainedKeys.has(`${p.songId}:${p.playlistId}`))
		.toSorted(
			(a, b) =>
				a.songId.localeCompare(b.songId) ||
				b.fusedScore - a.fusedScore ||
				a.playlistId.localeCompare(b.playlistId),
		);

	// Assign provisional legacy per-song ranks matching the sort order above.
	// Orientation ranking (MSR-14/15) writes the authoritative model ranks to
	// match_result_ranking and overwrites legacy score/rank for new read paths.
	const songRankCounter = new Map<string, number>();
	return sorted.map((pair) => {
		const prev = songRankCounter.get(pair.songId) ?? 0;
		const rank = prev + 1;
		songRankCounter.set(pair.songId, rank);
		return { ...pair, rank };
	});
}
