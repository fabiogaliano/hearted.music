import { createAdminSupabaseClient } from "@/lib/data/client";
import { DatabaseError } from "@/lib/shared/errors/database";

const EXCLUSION_PAGE_SIZE = 1_000;

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
 * PostgREST caps every response at max_rows (1000), and large accounts hold
 * many times that in pairs, so pages are read until a short one. The UNION
 * makes (song_id, playlist_id) unique, so ordering by it keeps pages disjoint.
 * The page size must not exceed max_rows, or a capped page would read as the
 * last one.
 *
 * Throws on RPC failure rather than returning a partial/empty set, so the
 * caller degrades on a KNOWN, logged error instead of silently writing a
 * snapshot with missing exclusions.
 */
export async function loadExclusionSet(
	accountId: string,
): Promise<Set<string>> {
	const supabase = createAdminSupabaseClient();
	const exclusions = new Set<string>();
	for (let from = 0; ; from += EXCLUSION_PAGE_SIZE) {
		const { data, error } = await supabase
			.rpc("list_account_match_exclusion_pairs", { p_account_id: accountId })
			.order("song_id")
			.order("playlist_id")
			.range(from, from + EXCLUSION_PAGE_SIZE - 1);

		if (error) {
			throw new DatabaseError({ code: error.code, message: error.message });
		}

		for (const pair of data ?? []) {
			exclusions.add(`${pair.song_id}:${pair.playlist_id}`);
		}
		if (!data || data.length < EXCLUSION_PAGE_SIZE) return exclusions;
	}
}
