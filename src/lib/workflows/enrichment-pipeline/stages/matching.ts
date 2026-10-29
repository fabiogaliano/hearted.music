import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import { readAllRows } from "@/lib/shared/utils/result-wrappers/supabase";

/**
 * Builds a set of "songId:playlistId" keys representing pairs that should be
 * skipped during matching — either because the user already made a decision
 * or because the song is already in the playlist.
 *
 * The whole set is computed DB-side by list_account_match_exclusion_pairs (a
 * UNION over match_decision + the account's playlist_song membership). The
 * previous app-side version re-entered a DB-derived playlist id list as an
 * .in() URL filter (a banned pattern, and subject to truncation) and ignored
 * read errors — so a partial load silently produced an incomplete exclusion
 * set and members leaked into the snapshot.
 *
 * Large accounts hold many times PostgREST's max_rows in pairs. The UNION
 * makes (song_id, playlist_id) unique, so ordering by it keeps pages disjoint.
 *
 * Throws on RPC failure rather than returning a partial/empty set, so the
 * caller degrades on a KNOWN, logged error instead of silently writing a
 * snapshot with missing exclusions.
 */
export async function loadExclusionSet(
	accountId: string,
): Promise<Set<string>> {
	const supabase = createAdminSupabaseClient();
	const pairs = await readAllRows(
		async (
			from,
			to,
		): Promise<Result<{ song_id: string; playlist_id: string }[], DbError>> => {
			const { data, error } = await supabase
				.rpc("list_account_match_exclusion_pairs", { p_account_id: accountId })
				.order("song_id")
				.order("playlist_id")
				.range(from, to);
			if (error) {
				return Result.err(
					new DatabaseError({ code: error.code, message: error.message }),
				);
			}
			return Result.ok(data ?? []);
		},
	);
	if (Result.isError(pairs)) throw pairs.error;
	return new Set(
		pairs.value.map((pair) => `${pair.song_id}:${pair.playlist_id}`),
	);
}
