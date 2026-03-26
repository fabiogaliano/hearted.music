import { Result } from "better-result";
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { requireAuthSession } from "@/lib/platform/auth/auth.server";
import {
	insertMatchDecision,
	insertMatchDecisions,
	getMatchDecisions,
} from "@/lib/data/match-decision-queries";
import {
	getLatestMatchContext,
	getMatchResults,
	getMatchResultsForSong,
} from "@/lib/domains/taste/song-matching/queries";
import { getNewItemIds } from "@/lib/domains/library/liked-songs/status-queries";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Json } from "@/lib/data/database.types";

// ============================================================================
// Shared types
// ============================================================================

export interface MatchingSessionResult {
	contextId: string;
	totalSongs: number;
}

export interface MatchingSong {
	id: string;
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

/** Returns song IDs that have at least one undecided match result, with ordering info. */
export async function getUndecidedSongs(
	contextId: string,
	accountId: string,
): Promise<Array<{ songId: string; maxScore: number }>> {
	const [matchResultsResult, decisionsResult] = await Promise.all([
		getMatchResults(contextId),
		getMatchDecisions(accountId),
	]);

	if (Result.isError(matchResultsResult) || Result.isError(decisionsResult)) {
		return [];
	}

	const matchResults = matchResultsResult.value;
	const decisions = decisionsResult.value;

	const decidedPairs = new Set(
		decisions.map((d) => `${d.song_id}:${d.playlist_id}`),
	);

	// Group by song, tracking max score
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

// ============================================================================
// Server functions
// ============================================================================

export const getMatchingSession = createServerFn({ method: "GET" }).handler(
	async (): Promise<MatchingSessionResult | null> => {
		const { session } = await requireAuthSession();

		const contextResult = await getLatestMatchContext(session.accountId);
		if (Result.isError(contextResult) || !contextResult.value) return null;

		const context = contextResult.value;
		const undecided = await getUndecidedSongs(context.id, session.accountId);

		return { contextId: context.id, totalSongs: undecided.length };
	},
);

// ============================================================================
// Song suggestions (read-only, for liked-song detail panel)
// ============================================================================

export interface SongSuggestion {
	playlistId: string;
	playlistName: string;
	score: number;
}

export interface SongSuggestionsResult {
	contextId: string;
	matches: SongSuggestion[];
}

const GetSongSuggestionsSchema = z.object({
	songId: z.uuid(),
});

export const getSongSuggestions = createServerFn({ method: "GET" })
	.inputValidator((data) => GetSongSuggestionsSchema.parse(data))
	.handler(async ({ data }): Promise<SongSuggestionsResult | null> => {
		const { session } = await requireAuthSession();

		const contextResult = await getLatestMatchContext(session.accountId);
		if (Result.isError(contextResult) || !contextResult.value) return null;

		const context = contextResult.value;

		const [matchResultsResult, decisionsResult] = await Promise.all([
			getMatchResultsForSong(context.id, data.songId),
			getMatchDecisions(session.accountId),
		]);

		if (Result.isError(matchResultsResult) || Result.isError(decisionsResult))
			return { contextId: context.id, matches: [] };

		const decidedPairs = new Set(
			decisionsResult.value.map((d) => `${d.song_id}:${d.playlist_id}`),
		);

		const undecidedResults = matchResultsResult.value.filter(
			(mr) => !decidedPairs.has(`${mr.song_id}:${mr.playlist_id}`),
		);

		if (undecidedResults.length === 0) {
			return { contextId: context.id, matches: [] };
		}

		const supabase = createAdminSupabaseClient();
		const playlistIds = undecidedResults.map((mr) => mr.playlist_id);
		const { data: playlistRows } = await supabase
			.from("playlist")
			.select("id, name")
			.in("id", playlistIds);

		const playlistMap = new Map(
			(playlistRows ?? []).map((p) => [p.id, p.name]),
		);

		const matches: SongSuggestion[] = undecidedResults
			.map((mr) => {
				const name = playlistMap.get(mr.playlist_id);
				if (!name) return null;
				return {
					playlistId: mr.playlist_id,
					playlistName: name,
					score: mr.score,
				};
			})
			.filter((m): m is SongSuggestion => m !== null)
			.sort((a, b) => b.score - a.score);

		return { contextId: context.id, matches };
	});

// ============================================================================
// Song matches (for /match page)
// ============================================================================

const GetSongMatchesSchema = z.object({
	contextId: z.uuid(),
	offset: z.number().int().min(0),
});

export interface GetSongMatchesParams {
	contextId: string;
	offset: number;
}

export const getSongMatches = createServerFn({ method: "GET" })
	.inputValidator((data) => GetSongMatchesSchema.parse(data))
	.handler(async ({ data }): Promise<SongMatchesResult | null> => {
		const { session } = await requireAuthSession();
		const supabase = createAdminSupabaseClient();

		const [undecided, newSongIds] = await Promise.all([
			getUndecidedSongs(data.contextId, session.accountId),
			getNewItemIds(session.accountId, "song"),
		]);

		if (Result.isError(newSongIds)) return null;

		const newSet = new Set(newSongIds.value);
		undecided.sort((a, b) => {
			const aNew = newSet.has(a.songId) ? 1 : 0;
			const bNew = newSet.has(b.songId) ? 1 : 0;
			if (aNew !== bNew) return bNew - aNew;
			if (b.maxScore !== a.maxScore) return b.maxScore - a.maxScore;
			return a.songId.localeCompare(b.songId);
		});

		if (data.offset >= undecided.length) return null;

		const targetSongId = undecided[data.offset].songId;

		// Fetch all details in parallel
		const [
			songRow,
			analysisRow,
			audioRow,
			matchResultsResult,
			decisionsResult,
		] = await Promise.all([
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
			getMatchResults(data.contextId),
			getMatchDecisions(session.accountId),
		]);

		if (songRow.error || !songRow.data) return null;
		if (Result.isError(matchResultsResult) || Result.isError(decisionsResult))
			return null;

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
			decisionsResult.value.map((d) => `${d.song_id}:${d.playlist_id}`),
		);

		// Get undecided match results for this song
		const songMatchResults = matchResultsResult.value.filter(
			(mr) =>
				mr.song_id === targetSongId &&
				!decidedPairs.has(`${mr.song_id}:${mr.playlist_id}`),
		);

		// Fetch playlist metadata
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
			.sort((a, b) => b.score - a.score);

		return {
			song: {
				id: song.id,
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
	.inputValidator((data) => AddToPlaylistSchema.parse(data))
	.handler(async ({ data }): Promise<AddToPlaylistResult> => {
		const { session } = await requireAuthSession();
		const result = await insertMatchDecision(
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
	.inputValidator((data) => DismissSongSchema.parse(data))
	.handler(async ({ data }) => {
		const { session } = await requireAuthSession();
		const decisions = data.playlistIds.map((playlistId) => ({
			accountId: session.accountId,
			songId: data.songId,
			playlistId,
			decision: "dismissed" as const,
		}));
		const result = await insertMatchDecisions(decisions);
		return { success: Result.isOk(result) };
	});

// ============================================================================
// markSeen server function (for session lifecycle)
// ============================================================================

const MarkSeenSchema = z.object({
	songIds: z.array(z.uuid()),
});

export const markSeenSongs = createServerFn({ method: "POST" })
	.inputValidator((data) => MarkSeenSchema.parse(data))
	.handler(async ({ data }) => {
		if (data.songIds.length === 0) return { success: true };
		const { session } = await requireAuthSession();
		const supabase = createAdminSupabaseClient();
		const now = new Date().toISOString();
		const { error } = await supabase.from("item_status").upsert(
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
