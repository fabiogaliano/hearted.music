import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { resolveMinMatchScore } from "@/lib/domains/library/accounts/preferences-queries";
import { isSongOwnedByAccount } from "@/lib/domains/library/liked-songs/queries";
import { computeVisibleSongSuggestionList } from "@/lib/domains/taste/match-review-queue/visible-suggestion-list";
import { upsertMatchDecision } from "@/lib/domains/taste/song-matching/decision-queries";
import {
	getLatestMatchSnapshot,
	getServedRanksForSong,
} from "@/lib/domains/taste/song-matching/queries";
import { captureServerError } from "@/lib/observability/capture-server-error";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import { reportAndThrow, unwrapOrThrow } from "@/lib/server/unwrap-or-throw";

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Resolves the served-ranking context for a song's decision(s): the snapshot the
 * user actually saw and the rank each playlist held in it. The client supplies
 * only the snapshot id (a correlation id — never any score); the server reads the
 * authoritative ranks from match_result. Any snapshot the account owns is
 * accepted — not just the latest — because a decision may land after a refresh
 * superseded the snapshot the user was looking at.
 *
 * Best-effort by design — logging context must never block the user's add/dismiss:
 * when the snapshot can't be resolved (no id, stale/forged id, lookup failure)
 * the linkage degrades to null, which also keeps the FK from rejecting a bogus
 * id. A playlist absent from `rankByPlaylist` means it was never surfaced in
 * that snapshot → served_rank null → an implicit (vs. surfaced) negative.
 */
async function resolveServedContext(
	accountId: string,
	songId: string,
	snapshotId: string | undefined,
): Promise<{ snapshotId: string | null; rankByPlaylist: Map<string, number> }> {
	if (!snapshotId) return { snapshotId: null, rankByPlaylist: new Map() };

	const served = await getServedRanksForSong(snapshotId, accountId, songId);
	if (Result.isError(served) || served.value === null) {
		return { snapshotId: null, rankByPlaylist: new Map() };
	}

	const rankByPlaylist = new Map<string, number>();
	for (const mr of served.value) {
		if (mr.rank !== null) rankByPlaylist.set(mr.playlist_id, mr.rank);
	}
	return { snapshotId, rankByPlaylist };
}

async function doPlaylistsBelongToAccount(
	playlistIds: string[],
	accountId: string,
): Promise<boolean> {
	const uniquePlaylistIds = [...new Set(playlistIds)];
	if (uniquePlaylistIds.length === 0) return false;

	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("playlist")
		.select("id")
		.eq("account_id", accountId)
		.in("id", uniquePlaylistIds);

	if (error) {
		// Fails closed (ownership unproven → not owned), but a DB error here is
		// distinct from "genuinely not owned" and was previously invisible.
		captureServerError(error, {
			area: "matching",
			operation: "do_playlists_belong_to_account",
			accountId,
		});
		return false;
	}

	return (data?.length ?? 0) === uniquePlaylistIds.length;
}

// ============================================================================
// Song suggestions (read-only, for liked-song detail panel)
// ============================================================================

export interface SongSuggestion {
	playlistId: string;
	playlistSpotifyId: string;
	playlistName: string;
	/** strictnessScore (fitScore) for this pair — shown as match percent (A5, E7). */
	fitScore: number;
}

export interface SongSuggestionsResult {
	snapshotId: string;
	matches: SongSuggestion[];
}

const GetSongSuggestionsSchema = z.object({
	songId: z.uuid(),
});

export const getSongSuggestions = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data) => GetSongSuggestionsSchema.parse(data))
	.handler(async ({ data, context }): Promise<SongSuggestionsResult | null> => {
		const { session } = context;
		const failure = {
			area: "matching",
			operation: "get_song_suggestions",
			accountId: session.accountId,
		};

		const matchSnapshot = unwrapOrThrow(
			await getLatestMatchSnapshot(session.accountId),
			failure,
		);
		// No snapshot yet — not an error, just nothing to suggest from.
		if (!matchSnapshot) return null;

		// Same visibility path as the deck (entitlement, ownership, decisions,
		// strictness, playlist match filters), so the panel can never suggest a
		// playlist the deck would hide for this song.
		const minScore = await resolveMinMatchScore(session.accountId);
		const listResult = await computeVisibleSongSuggestionList(
			{
				accountId: session.accountId,
				subject: { orientation: "song", songId: data.songId },
				sourceSnapshotId: matchSnapshot.id,
			},
			minScore,
		);

		switch (listResult.kind) {
			case "not-entitled":
				// Song locked or revoked: expected business state, not a failure.
				return null;
			case "db-error":
				return reportAndThrow(listResult.error, failure);
			case "ok":
				break;
		}

		// Preserve the rank order from deriveVisibleSuggestions (modelRank / visibleRank
		// already sorted). fitScore is strictnessScore — the match percent shown to the user.
		const matches: SongSuggestion[] = [];
		for (const s of listResult.list.suggestions) {
			// Every visible pair came from the read that carries the names.
			const playlist = listResult.playlists.get(s.playlistId);
			if (!playlist) continue;
			matches.push({
				playlistId: s.playlistId,
				playlistSpotifyId: playlist.spotifyId,
				playlistName: playlist.name,
				fitScore: s.fitScore,
			});
		}

		return { snapshotId: matchSnapshot.id, matches };
	});

// ============================================================================
// Match decision functions (moved from liked-songs.functions.ts)
// ============================================================================

const AddToPlaylistSchema = z.object({
	songId: z.uuid(),
	playlistId: z.uuid(),
	// The snapshot whose ranking the user acted on. Optional so a missing
	// correlation degrades to an unlinked decision rather than a hard rejection.
	snapshotId: z.uuid().optional(),
});

export const addSongToPlaylist = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => AddToPlaylistSchema.parse(data))
	.handler(async ({ data, context }): Promise<{ success: boolean }> => {
		const { session } = context;
		// Served-context resolution is best-effort and independent of the ownership
		// checks, so it rides the same Promise.all instead of adding a serial wait.
		const [songOwned, playlistOwned, served] = await Promise.all([
			isSongOwnedByAccount(session.accountId, data.songId),
			doPlaylistsBelongToAccount([data.playlistId], session.accountId),
			resolveServedContext(session.accountId, data.songId, data.snapshotId),
		]);
		if (!songOwned || !playlistOwned) {
			return { success: false };
		}

		const result = await upsertMatchDecision(
			session.accountId,
			data.songId,
			data.playlistId,
			"added",
			{
				snapshotId: served.snapshotId,
				modelRank: served.rankByPlaylist.get(data.playlistId) ?? null,
			},
		);
		return { success: Result.isOk(result) };
	});
