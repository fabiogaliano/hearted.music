/**
 * release_year_candidate repository — a permanent local cache of external
 * release-year lookups (iTunes/Deezer), keyed by Spotify album id. An album's
 * release year never changes, so hits are cached forever; misses (an empty
 * candidate list) are cached too, because re-querying the same absent album on
 * every page visit would burn the shared iTunes rate budget for nothing.
 */

import type { SqliteDriver } from "./sqlite";

export interface CachedYearCandidates {
	albumId: string;
	fetchedAt: string;
	candidatesJson: string;
}

export function getYearCandidates(
	db: SqliteDriver,
	albumIds: readonly string[],
): Map<string, CachedYearCandidates> {
	const out = new Map<string, CachedYearCandidates>();
	for (const albumId of albumIds) {
		const row = db.get<{ fetched_at: string; candidates_json: string }>(
			"select fetched_at, candidates_json from release_year_candidate where album_id = ?",
			[albumId],
		);
		if (row) {
			out.set(albumId, {
				albumId,
				fetchedAt: row.fetched_at,
				candidatesJson: row.candidates_json,
			});
		}
	}
	return out;
}

export function putYearCandidates(
	db: SqliteDriver,
	albumId: string,
	fetchedAt: string,
	candidatesJson: string,
): void {
	db.run(
		`insert into release_year_candidate (album_id, fetched_at, candidates_json)
		 values (?, ?, ?)
		 on conflict (album_id) do update set
			fetched_at = excluded.fetched_at,
			candidates_json = excluded.candidates_json`,
		[albumId, fetchedAt, candidatesJson],
	);
}
