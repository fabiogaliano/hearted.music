import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Json } from "@/lib/data/database.types";
import {
	getMatchDecisionsForSongs,
	upsertMatchDecision,
	upsertMatchDecisions,
} from "@/lib/domains/taste/song-matching/decision-queries";
import { getNewItemIds } from "@/lib/domains/library/liked-songs/status-queries";
import {
	getLatestMatchSnapshot,
	getMatchResults,
	getMatchResultsForSong,
} from "@/lib/domains/taste/song-matching/queries";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";

const NoInputSchema = z.undefined();

// ============================================================================
// Shared types
// ============================================================================

export interface MatchingSessionResult {
	snapshotId: string;
	totalSongs: number;
}

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
		spotifyId: string;
	};
	score: number;
	rank: number | null;
	factors: Json;
}

export interface SongMatchesResult {
	song: MatchingSong;
	matches: MatchingPlaylistMatch[];
}

// ============================================================================
// Internal helpers
// ============================================================================

type MatchResult = { song_id: string; playlist_id: string; score: number };
type MatchDecision = { song_id: string; playlist_id: string };

async function getMatchSnapshotData(
	snapshotId: string,
	accountId: string,
): Promise<{ matchResults: MatchResult[]; decisions: MatchDecision[] } | null> {
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

/** Pure derivation: song IDs with at least one undecided match, plus ordering info. */
function deriveUndecidedSongs(
	matchResults: MatchResult[],
	decisions: MatchDecision[],
): Array<{ songId: string; maxScore: number }> {
	const decidedPairs = new Set(
		decisions.map((d) => `${d.song_id}:${d.playlist_id}`),
	);

	const songMap = new Map<
		string,
		{ maxScore: number; hasUndecided: boolean }
	>();
	for (const mr of matchResults) {
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
): Promise<Array<{ songId: string; maxScore: number }>> {
	const snapshotData = await getMatchSnapshotData(snapshotId, accountId);
	if (!snapshotData) return [];

	return deriveUndecidedSongs(
		snapshotData.matchResults,
		snapshotData.decisions,
	);
}

// ============================================================================
// Server functions
// ============================================================================

export const getMatchingSession = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data: undefined) => NoInputSchema.parse(data))
	.handler(async ({ context }): Promise<MatchingSessionResult | null> => {
		const { session } = context;
		const supabase = createAdminSupabaseClient();

		const snapshotResult = await getLatestMatchSnapshot(session.accountId);
		if (Result.isError(snapshotResult) || !snapshotResult.value) return null;

		const matchSnapshot = snapshotResult.value;

		const [undecided, entitledResult] = await Promise.all([
			getUndecidedSongs(matchSnapshot.id, session.accountId),
			supabase.rpc("select_entitled_data_enriched_liked_song_ids", {
				p_account_id: session.accountId,
			}),
		]);

		const entitledSet = new Set(
			(!entitledResult.error && entitledResult.data
				? entitledResult.data
				: []
			).map((r: { song_id: string }) => r.song_id),
		);

		const entitledUndecided = undecided.filter((s) =>
			entitledSet.has(s.songId),
		);

		return {
			snapshotId: matchSnapshot.id,
			totalSongs: entitledUndecided.length,
		};
	});

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

		const [matchResultsResult, decisionsResult] = await Promise.all([
			getMatchResultsForSong(matchSnapshot.id, data.songId),
			getMatchDecisionsForSongs(session.accountId, [data.songId]),
		]);

		if (Result.isError(matchResultsResult) || Result.isError(decisionsResult))
			return { snapshotId: matchSnapshot.id, matches: [] };

		const decidedPairs = new Set(
			decisionsResult.value.map((d) => `${d.song_id}:${d.playlist_id}`),
		);

		const undecidedResults = matchResultsResult.value.filter(
			(mr) => !decidedPairs.has(`${mr.song_id}:${mr.playlist_id}`),
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
// Song matches (for /match page)
// ============================================================================

const GetSongMatchesSchema = z.object({
	snapshotId: z.uuid(),
	offset: z.number().int().min(0),
});

export interface GetSongMatchesParams {
	snapshotId: string;
	offset: number;
}

export const getSongMatches = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data) => GetSongMatchesSchema.parse(data))
	.handler(async ({ data, context }): Promise<SongMatchesResult | null> => {
		const { session } = context;
		const supabase = createAdminSupabaseClient();

		const snapshotDataPromise = getMatchSnapshotData(
			data.snapshotId,
			session.accountId,
		);
		const newSongIdsPromise = getNewItemIds(session.accountId, "song");
		const entitledSongsPromise = supabase.rpc(
			"select_entitled_data_enriched_liked_song_ids",
			{
				p_account_id: session.accountId,
			},
		);

		const snapshotData = await snapshotDataPromise;
		if (!snapshotData) return null;

		const { matchResults, decisions } = snapshotData;

		const [newSongIds, entitledResult] = await Promise.all([
			newSongIdsPromise,
			entitledSongsPromise,
		]);

		if (Result.isError(newSongIds)) return null;

		const undecided = deriveUndecidedSongs(matchResults, decisions);

		const entitledSet = new Set(
			(!entitledResult.error && entitledResult.data
				? entitledResult.data
				: []
			).map((r: { song_id: string }) => r.song_id),
		);

		const newSet = new Set(newSongIds.value);
		const sorted = undecided
			.filter((s) => entitledSet.has(s.songId))
			.toSorted((a, b) => {
				const aNew = newSet.has(a.songId) ? 1 : 0;
				const bNew = newSet.has(b.songId) ? 1 : 0;
				if (aNew !== bNew) return bNew - aNew;
				if (b.maxScore !== a.maxScore) return b.maxScore - a.maxScore;
				return a.songId.localeCompare(b.songId);
			});

		if (data.offset >= sorted.length) return null;

		const targetSongId = sorted[data.offset].songId;

		const [songRow, analysisRow, audioRow] = await Promise.all([
			supabase.from("song").select("*").eq("id", targetSongId).single(),
			supabase
				.from("song_analysis")
				.select("analysis")
				.eq("song_id", targetSongId)
				.order("created_at", { ascending: false })
				.limit(1)
				.maybeSingle(),
			supabase
				.from("song_audio_feature")
				.select("tempo, energy, valence")
				.eq("song_id", targetSongId)
				.maybeSingle(),
		]);

		if (songRow.error || !songRow.data) return null;

		const song = songRow.data;
		const analysis = analysisRow.data?.analysis as
			| {
					headline: string;
					compound_mood: string;
					mood_description: string;
					interpretation: string;
					themes: Array<{ name: string; description: string }>;
					journey: Array<{
						section: string;
						mood: string;
						description: string;
					}>;
					key_lines: Array<{ line: string; insight: string }>;
					sonic_texture: string;
			  }
			| null
			| undefined;
		const audio = audioRow.data;

		const decidedPairs = new Set(
			decisions.map((d) => `${d.song_id}:${d.playlist_id}`),
		);

		const songMatchResults = matchResults.filter(
			(mr) =>
				mr.song_id === targetSongId &&
				!decidedPairs.has(`${mr.song_id}:${mr.playlist_id}`),
		);

		const playlistIds = songMatchResults.map((mr) => mr.playlist_id);
		const { data: playlistRows, error: playlistError } = await supabase
			.from("playlist")
			.select("id, name, description, song_count, spotify_id")
			.in("id", playlistIds);

		if (playlistError || !playlistRows) return null;

		const playlistMap = new Map(playlistRows.map((p) => [p.id, p]));

		const matches: MatchingPlaylistMatch[] = songMatchResults
			.map((mr) => {
				const playlist = playlistMap.get(mr.playlist_id);
				if (!playlist) return null;
				return {
					playlist: {
						id: playlist.id,
						name: playlist.name,
						description: playlist.description,
						trackCount: playlist.song_count,
						spotifyId: playlist.spotify_id,
					},
					score: mr.score,
					rank: mr.rank,
					factors: mr.factors,
				};
			})
			.filter((m): m is MatchingPlaylistMatch => m !== null)
			.toSorted((a, b) => b.score - a.score);

		return {
			song: {
				id: song.id,
				spotifyId: song.spotify_id,
				name: song.name,
				artist: song.artists[0] ?? "Unknown Artist",
				album: song.album_name,
				albumArtUrl: song.image_url,
				genres: song.genres,
				audioFeatures: audio
					? { tempo: audio.tempo, energy: audio.energy, valence: audio.valence }
					: null,
				analysis: analysis ?? null,
			},
			matches,
		};
	});

// ============================================================================
// Match decision functions (moved from liked-songs.functions.ts)
// ============================================================================

const AddToPlaylistSchema = z.object({
	songId: z.uuid(),
	playlistId: z.uuid(),
});

export interface AddToPlaylistParams {
	songId: string;
	playlistId: string;
}

export interface AddToPlaylistResult {
	success: boolean;
}

export const addSongToPlaylist = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => AddToPlaylistSchema.parse(data))
	.handler(async ({ data, context }): Promise<AddToPlaylistResult> => {
		const { session } = context;
		const result = await upsertMatchDecision(
			session.accountId,
			data.songId,
			data.playlistId,
			"added",
		);
		return { success: Result.isOk(result) };
	});

const DismissSongSchema = z.object({
	songId: z.uuid(),
	playlistIds: z.array(z.uuid()).min(1),
});

export interface DismissSongParams {
	songId: string;
	playlistIds: string[];
}

export const dismissSong = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => DismissSongSchema.parse(data))
	.handler(async ({ data, context }) => {
		const { session } = context;
		const decisions = data.playlistIds.map((playlistId) => ({
			accountId: session.accountId,
			songId: data.songId,
			playlistId,
			decision: "dismissed" as const,
		}));
		const result = await upsertMatchDecisions(decisions);
		return { success: Result.isOk(result) };
	});

// ============================================================================
// markSeen server function (for session lifecycle)
// ============================================================================

const MarkSeenSchema = z.object({
	songIds: z.array(z.uuid()),
});

export const markSeenSongs = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => MarkSeenSchema.parse(data))
	.handler(async ({ data, context }) => {
		if (data.songIds.length === 0) return { success: true };
		const { session } = context;
		const supabase = createAdminSupabaseClient();
		const now = new Date().toISOString();
		const { error } = await supabase.from("account_item_newness").upsert(
			data.songIds.map((itemId) => ({
				account_id: session.accountId,
				item_id: itemId,
				item_type: "song" as const,
				is_new: false,
				viewed_at: now,
			})),
			{ onConflict: "account_id,item_id,item_type" },
		);
		return { success: !error };
	});
