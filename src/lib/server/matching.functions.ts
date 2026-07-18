import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Json } from "@/lib/data/database.types";
import { resolveMinMatchScore } from "@/lib/domains/library/accounts/preferences-queries";
import { isSongOwnedByAccount } from "@/lib/domains/library/liked-songs/queries";
import {
	deriveVisibleSuggestions,
	type MatchPairInput,
	type RankingInput,
} from "@/lib/domains/taste/match-review-queue/visible-suggestion-list";
import {
	getMatchDecisionsForSongs,
	upsertMatchDecision,
} from "@/lib/domains/taste/song-matching/decision-queries";
import {
	getLatestMatchSnapshot,
	getMatchPairsForSong,
	getMatchRankingsForSong,
	getMatchResults,
	getServedRanksForSong,
	type MatchResultRow,
} from "@/lib/domains/taste/song-matching/queries";
import { strictnessScore } from "@/lib/domains/taste/song-matching/strictness";
import { captureServerError } from "@/lib/observability/capture-server-error";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import type { DbError } from "@/lib/shared/errors/database";

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

/** Playlist subject shape for playlist-orientation review cards. */
export interface MatchingPlaylistForReview {
	id: string;
	spotifyId: string;
	name: string;
	description: string | null;
	imageUrl: string | null;
	trackCount: number | null;
}

/**
 * Song candidate row in playlist-mode: song data + fitScore for match percent display.
 * fitScore = strictnessScore(row) — never the reranker/ordering score (A5, E7).
 */
export interface MatchingSongSuggestion {
	song: MatchingSong;
	fitScore: number;
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

/**
 * Result-typed so callers can distinguish a genuine DB failure (captured here,
 * for telemetry) from the valid "no matches yet" case — both used to collapse
 * to an untyped `null`, which silently swallowed real errors.
 */
async function getMatchSnapshotData(
	snapshotId: string,
	accountId: string,
): Promise<
	Result<
		{
			matchResults: MatchResultRow[];
			decisions: MatchDecision[];
		},
		DbError
	>
> {
	const matchResultsResult = await getMatchResults(snapshotId);
	if (Result.isError(matchResultsResult)) {
		captureServerError(matchResultsResult.error, {
			area: "matching",
			operation: "get_match_snapshot_data",
			accountId,
			extra: { stage: "match_results", snapshotId },
		});
		return matchResultsResult;
	}

	const matchResults = matchResultsResult.value;
	const matchedSongIds = [...new Set(matchResults.map((mr) => mr.song_id))];
	const decisionsResult = await getMatchDecisionsForSongs(
		accountId,
		matchedSongIds,
	);
	if (Result.isError(decisionsResult)) {
		captureServerError(decisionsResult.error, {
			area: "matching",
			operation: "get_match_snapshot_data",
			accountId,
			extra: { stage: "decisions", snapshotId },
		});
		return decisionsResult;
	}

	return Result.ok({
		matchResults,
		decisions: decisionsResult.value,
	});
}

/**
 * Pure derivation: song IDs with at least one undecided match, plus ordering info.
 *
 * `minScore` is the read-time strictness bar: match_result rows whose
 * strictnessScore (fused_score ?? score) is below it are skipped *before* both
 * maxScore and hasUndecided accumulate, so a pair under the bar contributes
 * neither ordering weight nor "this song still has suggestions". A song whose
 * only undecided pairs are below the bar therefore drops out of the result
 * entirely. Pass 0 to consider every stored match.
 *
 * Strictness and ordering both key off strictnessScore — the fused retrieval
 * quality — never the reranker/legacy ordering value in `score` (E7).
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
		const rowScore = strictnessScore(mr);
		if (rowScore < minScore) continue;
		const existing = songMap.get(mr.song_id) ?? {
			maxScore: 0,
			hasUndecided: false,
		};
		const isUndecided = !decidedPairs.has(`${mr.song_id}:${mr.playlist_id}`);
		songMap.set(mr.song_id, {
			maxScore: Math.max(existing.maxScore, rowScore),
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
	// getMatchSnapshotData already captured the error; degrade to empty here.
	if (Result.isError(snapshotData)) return [];

	return deriveUndecidedSongs(
		snapshotData.value.matchResults,
		snapshotData.value.decisions,
		minScore,
	);
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
		const supabase = createAdminSupabaseClient();

		const snapshotResult = await getLatestMatchSnapshot(session.accountId);
		if (Result.isError(snapshotResult)) {
			captureServerError(snapshotResult.error, {
				area: "matching",
				operation: "get_song_suggestions",
				accountId: session.accountId,
				extra: { stage: "latest_snapshot", songId: data.songId },
			});
			return null;
		}
		// No snapshot yet — not an error, just nothing to suggest from.
		if (!snapshotResult.value) return null;

		const matchSnapshot = snapshotResult.value;

		const entitledCheck = await supabase.rpc("is_account_song_entitled", {
			p_account_id: session.accountId,
			p_song_id: data.songId,
		});
		if (entitledCheck.error) {
			captureServerError(entitledCheck.error, {
				area: "matching",
				operation: "get_song_suggestions",
				accountId: session.accountId,
				extra: { stage: "entitlement_check", songId: data.songId },
			});
			return null;
		}
		// Song not entitled (locked) — expected business state, not a failure.
		if (!entitledCheck.data) {
			return null;
		}

		// Fetch pairs, rankings, decisions, and strictness bar in parallel —
		// rankings carry model rank so suggestions are ordered by the ranking
		// pipeline rather than legacy raw score (MSR-25, A5, E7, C12).
		const [pairsResult, rankingsResult, decisionsResult, minScore] =
			await Promise.all([
				getMatchPairsForSong(matchSnapshot.id, data.songId),
				getMatchRankingsForSong(matchSnapshot.id, data.songId),
				getMatchDecisionsForSongs(session.accountId, [data.songId]),
				resolveMinMatchScore(session.accountId),
			]);

		if (Result.isError(pairsResult)) {
			captureServerError(pairsResult.error, {
				area: "matching",
				operation: "get_song_suggestions",
				accountId: session.accountId,
				extra: { stage: "pairs", songId: data.songId },
			});
			return { snapshotId: matchSnapshot.id, matches: [] };
		}
		if (Result.isError(rankingsResult)) {
			captureServerError(rankingsResult.error, {
				area: "matching",
				operation: "get_song_suggestions",
				accountId: session.accountId,
				extra: { stage: "rankings", songId: data.songId },
			});
			return { snapshotId: matchSnapshot.id, matches: [] };
		}
		if (Result.isError(decisionsResult)) {
			captureServerError(decisionsResult.error, {
				area: "matching",
				operation: "get_song_suggestions",
				accountId: session.accountId,
				extra: { stage: "decisions", songId: data.songId },
			});
			return { snapshotId: matchSnapshot.id, matches: [] };
		}

		const decidedPairKeys = new Set(
			decisionsResult.value.map((d) => `${d.song_id}:${d.playlist_id}`),
		);

		const pairs: MatchPairInput[] = pairsResult.value.map((r) => ({
			songId: r.song_id,
			playlistId: r.playlist_id,
			score: r.score,
			fusedScore: r.fused_score,
		}));

		const rankings: RankingInput[] = rankingsResult.value.map((r) => ({
			songId: r.song_id,
			playlistId: r.playlist_id,
			rank: r.rank,
			orderingScore: r.ordering_score,
		}));

		const subject = { orientation: "song" as const, songId: data.songId };
		const visibleSuggestions = deriveVisibleSuggestions(
			subject,
			pairs,
			rankings,
			decidedPairKeys,
			minScore,
		);

		if (visibleSuggestions.length === 0) {
			return { snapshotId: matchSnapshot.id, matches: [] };
		}

		const playlistIds = visibleSuggestions.map((s) => s.playlistId);
		const { data: playlistRows } = await supabase
			.from("playlist")
			.select("id, name, spotify_id")
			.in("id", playlistIds);

		const playlistMap = new Map((playlistRows ?? []).map((p) => [p.id, p]));

		// Preserve the rank order from deriveVisibleSuggestions (modelRank / visibleRank
		// already sorted). fitScore is strictnessScore — the match percent shown to the user.
		const matches: SongSuggestion[] = visibleSuggestions
			.map((s) => {
				const playlist = playlistMap.get(s.playlistId);
				if (!playlist) return null;
				return {
					playlistId: s.playlistId,
					playlistSpotifyId: playlist.spotify_id,
					playlistName: playlist.name,
					fitScore: s.fitScore,
				};
			})
			.filter((m): m is SongSuggestion => m !== null);

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
