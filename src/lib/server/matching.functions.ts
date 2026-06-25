import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Json } from "@/lib/data/database.types";
import { resolveMinMatchScore } from "@/lib/domains/library/accounts/preferences-queries";
import { isSongOwnedByAccount } from "@/lib/domains/library/liked-songs/queries";
import { getNewItemIds } from "@/lib/domains/library/liked-songs/status-queries";
import {
	getMatchDecisionsForSongs,
	upsertMatchDecision,
} from "@/lib/domains/taste/song-matching/decision-queries";
import {
	getLatestMatchSnapshot,
	getMatchResults,
	getMatchResultsForSong,
	getServedRanksForSong,
	type MatchResultRow,
} from "@/lib/domains/taste/song-matching/queries";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";

// ============================================================================
// Shared types
// ============================================================================

export interface MatchingSong {
	id: string;
	spotifyId: string;
	name: string;
	artist: string;
	album: string | null;
	albumArtUrl: string | null;
	genres: string[];
	audioFeatures: {
		tempo: number | null;
		energy: number | null;
		valence: number | null;
	} | null;
	analysis: {
		headline: string;
		compound_mood: string;
		mood_description: string;
		interpretation: string;
		themes: Array<{ name: string; description: string }>;
		journey: Array<{ section: string; mood: string; description: string }>;
		key_lines: Array<{ line: string; insight: string }>;
		sonic_texture: string;
	} | null;
}

export interface MatchingPlaylistMatch {
	playlist: {
		id: string;
		name: string;
		description: string | null;
		trackCount: number | null;
		imageUrl: string | null;
		spotifyId: string;
	};
	score: number;
	rank: number | null;
	factors: Json;
}

// ============================================================================
// Internal helpers
// ============================================================================

type MatchDecision = { song_id: string; playlist_id: string };

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

	return !error && (data?.length ?? 0) === uniquePlaylistIds.length;
}

async function getMatchSnapshotData(
	snapshotId: string,
	accountId: string,
): Promise<{
	matchResults: MatchResultRow[];
	decisions: MatchDecision[];
} | null> {
	const matchResultsResult = await getMatchResults(snapshotId);
	if (Result.isError(matchResultsResult)) return null;

	const matchResults = matchResultsResult.value;
	const matchedSongIds = [...new Set(matchResults.map((mr) => mr.song_id))];
	const decisionsResult = await getMatchDecisionsForSongs(
		accountId,
		matchedSongIds,
	);
	if (Result.isError(decisionsResult)) return null;

	return {
		matchResults,
		decisions: decisionsResult.value,
	};
}

/**
 * Pure derivation: song IDs with at least one undecided match, plus ordering info.
 *
 * `minScore` is the read-time strictness bar: match_result rows below it are
 * skipped *before* both maxScore and hasUndecided accumulate, so a pair under
 * the bar contributes neither ordering weight nor "this song still has
 * suggestions". A song whose only undecided pairs are below the bar therefore
 * drops out of the result entirely. Pass 0 to consider every stored match.
 */
export function deriveUndecidedSongs(
	matchResults: MatchResultRow[],
	decisions: MatchDecision[],
	minScore: number,
): Array<{ songId: string; maxScore: number }> {
	const decidedPairs = new Set(
		decisions.map((d) => `${d.song_id}:${d.playlist_id}`),
	);

	const songMap = new Map<
		string,
		{ maxScore: number; hasUndecided: boolean }
	>();
	for (const mr of matchResults) {
		if (mr.score < minScore) continue;
		const existing = songMap.get(mr.song_id) ?? {
			maxScore: 0,
			hasUndecided: false,
		};
		const isUndecided = !decidedPairs.has(`${mr.song_id}:${mr.playlist_id}`);
		songMap.set(mr.song_id, {
			maxScore: Math.max(existing.maxScore, mr.score),
			hasUndecided: existing.hasUndecided || isUndecided,
		});
	}

	return Array.from(songMap.entries())
		.filter(([, v]) => v.hasUndecided)
		.map(([songId, v]) => ({ songId, maxScore: v.maxScore }));
}

/** Fetches match results + decisions, then derives undecided songs. */
export async function getUndecidedSongs(
	snapshotId: string,
	accountId: string,
	minScore: number,
): Promise<Array<{ songId: string; maxScore: number }>> {
	const snapshotData = await getMatchSnapshotData(snapshotId, accountId);
	if (!snapshotData) return [];

	return deriveUndecidedSongs(
		snapshotData.matchResults,
		snapshotData.decisions,
		minScore,
	);
}

/**
 * Single ordering authority for a match queue: the ordered, entitled,
 * undecided song ids for a snapshot. Owns undecided derivation, the entitlement
 * filter, newness, and the 3-key sort (isNew desc, maxScore desc, songId asc).
 *
 * Used by the dashboard's match previews (top-3) and the queue domain's
 * snapshot-append logic to compute the canonical ordering of new items.
 */
export async function getOrderedUndecidedSongIds(
	snapshotId: string,
	accountId: string,
): Promise<{ songIds: string[]; hiddenSongCount: number }> {
	const supabase = createAdminSupabaseClient();

	const [snapshotData, newSongIds, entitledResult, minScore] =
		await Promise.all([
			getMatchSnapshotData(snapshotId, accountId),
			getNewItemIds(accountId, "song"),
			supabase.rpc("select_entitled_data_enriched_liked_song_ids", {
				p_account_id: accountId,
			}),
			resolveMinMatchScore(accountId),
		]);

	if (Result.isError(newSongIds)) return { songIds: [], hiddenSongCount: 0 };

	const entitledSet = new Set(
		(!entitledResult.error && entitledResult.data
			? entitledResult.data
			: []
		).map((r: { song_id: string }) => r.song_id),
	);

	// Derive twice from the one in-memory snapshot: unfiltered (minScore 0, every
	// stored match) and filtered (the user's bar). Diffing their entitled counts
	// yields exactly the songs hidden purely by strictness — the data never
	// leaves memory, so the second pass is free.
	const allUndecided = snapshotData
		? deriveUndecidedSongs(snapshotData.matchResults, snapshotData.decisions, 0)
		: [];
	const visibleUndecided = snapshotData
		? deriveUndecidedSongs(
				snapshotData.matchResults,
				snapshotData.decisions,
				minScore,
			)
		: [];

	const entitledAllCount = allUndecided.filter((s) =>
		entitledSet.has(s.songId),
	).length;
	const entitledVisible = visibleUndecided.filter((s) =>
		entitledSet.has(s.songId),
	);
	const hiddenSongCount = entitledAllCount - entitledVisible.length;

	const newSet = new Set(newSongIds.value);
	const songIds = entitledVisible
		.toSorted((a, b) => {
			const aNew = newSet.has(a.songId) ? 1 : 0;
			const bNew = newSet.has(b.songId) ? 1 : 0;
			if (aNew !== bNew) return bNew - aNew;
			if (b.maxScore !== a.maxScore) return b.maxScore - a.maxScore;
			return a.songId.localeCompare(b.songId);
		})
		.map((s) => s.songId);

	return { songIds, hiddenSongCount };
}

// ============================================================================
// Song suggestions (read-only, for liked-song detail panel)
// ============================================================================

export interface SongSuggestion {
	playlistId: string;
	playlistSpotifyId: string;
	playlistName: string;
	score: number;
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
		const supabase = createAdminSupabaseClient();

		const snapshotResult = await getLatestMatchSnapshot(session.accountId);
		if (Result.isError(snapshotResult) || !snapshotResult.value) return null;

		const matchSnapshot = snapshotResult.value;

		const entitledCheck = await supabase.rpc("is_account_song_entitled", {
			p_account_id: session.accountId,
			p_song_id: data.songId,
		});
		if (entitledCheck.error || !entitledCheck.data) {
			return null;
		}

		const [matchResultsResult, decisionsResult, minScore] = await Promise.all([
			getMatchResultsForSong(matchSnapshot.id, data.songId),
			getMatchDecisionsForSongs(session.accountId, [data.songId]),
			resolveMinMatchScore(session.accountId),
		]);

		if (Result.isError(matchResultsResult) || Result.isError(decisionsResult))
			return { snapshotId: matchSnapshot.id, matches: [] };

		const decidedPairs = new Set(
			decisionsResult.value.map((d) => `${d.song_id}:${d.playlist_id}`),
		);

		const undecidedResults = matchResultsResult.value.filter(
			(mr) =>
				mr.score >= minScore &&
				!decidedPairs.has(`${mr.song_id}:${mr.playlist_id}`),
		);

		if (undecidedResults.length === 0) {
			return { snapshotId: matchSnapshot.id, matches: [] };
		}

		const playlistIds = undecidedResults.map((mr) => mr.playlist_id);
		const { data: playlistRows } = await supabase
			.from("playlist")
			.select("id, name, spotify_id")
			.in("id", playlistIds);

		const playlistMap = new Map((playlistRows ?? []).map((p) => [p.id, p]));

		const matches: SongSuggestion[] = undecidedResults
			.map((mr) => {
				const playlist = playlistMap.get(mr.playlist_id);
				if (!playlist) return null;
				return {
					playlistId: mr.playlist_id,
					playlistSpotifyId: playlist.spotify_id,
					playlistName: playlist.name,
					score: mr.score,
				};
			})
			.filter((m): m is SongSuggestion => m !== null)
			.toSorted((a, b) => b.score - a.score);

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
