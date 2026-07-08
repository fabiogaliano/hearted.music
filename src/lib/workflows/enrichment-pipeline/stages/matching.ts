import { createAdminSupabaseClient } from "@/lib/data/client";
import { DatabaseError } from "@/lib/shared/errors/database";

/**
 * Builds a set of "songId:playlistId" keys representing pairs that should be
 * skipped during matching — either because the user already made a decision
 * or because the song is already in the playlist.
 *
 * The whole set is computed DB-side by list_account_match_exclusion_pairs (one
 * round trip, a UNION over match_decision + the account's playlist_song
 * membership). The previous app-side version re-entered a DB-derived playlist
 * id list as an .in() URL filter (a banned pattern, and subject to truncation)
 * and ignored read errors — so a partial load silently produced an incomplete
 * exclusion set and members leaked into the snapshot.
 *
 * Throws on RPC failure rather than returning a partial/empty set, so the
 * caller degrades on a KNOWN, logged error instead of silently writing a
 * snapshot with missing exclusions.
 */
export async function loadExclusionSet(
	accountId: string,
): Promise<Set<string>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc(
		"list_account_match_exclusion_pairs",
		{ p_account_id: accountId },
	);

	if (error) {
		throw new DatabaseError({ code: error.code, message: error.message });
	}

	const exclusions = new Set<string>();
	for (const pair of data ?? []) {
		exclusions.add(`${pair.song_id}:${pair.playlist_id}`);
	}
	return exclusions;
}
