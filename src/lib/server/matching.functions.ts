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
	upsertMatchDecisions,
} from "@/lib/domains/taste/song-matching/decision-queries";
import {
	getLatestMatchSnapshot,
	getMatchResultDetailsForSong,
	getMatchResults,
	getMatchResultsForSong,
	getServedRanksForSong,
	type MatchResultRow,
} from "@/lib/domains/taste/song-matching/queries";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";

const NoInputSchema = z.undefined();

// ============================================================================
// Shared types
// ============================================================================

export interface MatchingSessionResult {
	snapshotId: string;
	// The frozen walk order: ordered, entitled, undecided song ids. The client
	// indexes its `offset` into this array so a recorded decision can never shift
	// which song slot N points to (the positional-offset bug this replaces).
	songIds: string[];
	// === songIds.length. Kept so the sidebar badge and empty-state guards that
	// read `totalSongs` need no changes.
	totalSongs: number;
	// Entitled, undecided songs hidden purely by the user's strictness bar —
	// drives the "filtered" empty state. Zero when the bar hides nothing.
	hiddenSongCount: number;
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

type MatchDecision = { song_id: string; playlist_id: string };

async function doesSnapshotBelongToAccount(
	snapshotId: string,
	accountId: string,
): Promise<boolean> {
	const snapshotResult = await getLatestMatchSnapshot(accountId);
	if (Result.isError(snapshotResult) || !snapshotResult.value) {
		return false;
	}

	return snapshotResult.value.id === snapshotId;
}

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
 * Single ordering authority for a match session: the ordered, entitled,
 * undecided song ids for a snapshot. Owns undecided derivation, the entitlement
 * filter, newness, and the 3-key sort (isNew desc, maxScore desc, songId asc).
 *
 * Both surfaces that must agree on "which songs, in what order" call this:
 * `getMatchingSession` (the frozen walk) and the dashboard's match previews
 * (top-3). Collapsing the two formerly-duplicated comparators here makes
 * "dashboard top-3 === match first-3" true by construction.
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
// Server functions
// ============================================================================

export const getMatchingSession = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data: undefined) => NoInputSchema.parse(data))
	.handler(async ({ context }): Promise<MatchingSessionResult | null> => {
		const { session } = context;

		const snapshotResult = await getLatestMatchSnapshot(session.accountId);
		if (Result.isError(snapshotResult) || !snapshotResult.value) return null;

		const matchSnapshot = snapshotResult.value;

		// The session now carries the *order*, not just the count — the client
		// freezes this list and indexes its walk into it.
		const { songIds, hiddenSongCount } = await getOrderedUndecidedSongIds(
			matchSnapshot.id,
			session.accountId,
		);

		return {
			snapshotId: matchSnapshot.id,
			songIds,
			totalSongs: songIds.length,
			hiddenSongCount,
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
// Song matches (for /match page)
// ============================================================================

const GetSongMatchesSchema = z.object({
	snapshotId: z.uuid(),
	songId: z.uuid(),
});

export interface GetSongMatchesParams {
	snapshotId: string;
	songId: string;
}

export const getSongMatches = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data) => GetSongMatchesSchema.parse(data))
	.handler(async ({ data, context }): Promise<SongMatchesResult | null> => {
		const { session } = context;
		const supabase = createAdminSupabaseClient();

		const ownsSnapshot = await doesSnapshotBelongToAccount(
			data.snapshotId,
			session.accountId,
		);
		if (!ownsSnapshot) return null;

		// `songId` is now client-supplied (it used to be derived server-side from a
		// positional offset), so the per-song entitlement check is mandatory — it's
		// the one piece of server validation that must survive the simplification.
		// Cheaper than the old whole-set RPC, too: one row vs. the entitled set.
		const entitledCheck = await supabase.rpc("is_account_song_entitled", {
			p_account_id: session.accountId,
			p_song_id: data.songId,
		});
		if (entitledCheck.error || !entitledCheck.data) return null;

		// One per-song fetch — never the whole snapshot. `getMatchResultDetailsForSong`
		// carries the heavy factors/rank JSONB for this song alone.
		const [
			songRow,
			analysisRow,
			audioRow,
			songDetailsResult,
			decisionsResult,
			minScore,
		] = await Promise.all([
			supabase.from("song").select("*").eq("id", data.songId).single(),
			supabase
				.from("song_analysis")
				.select("analysis")
				.eq("song_id", data.songId)
				.order("created_at", { ascending: false })
				.limit(1)
				.maybeSingle(),
			supabase
				.from("song_audio_feature")
				.select("tempo, energy, valence")
				.eq("song_id", data.songId)
				.maybeSingle(),
			getMatchResultDetailsForSong(data.snapshotId, data.songId),
			getMatchDecisionsForSongs(session.accountId, [data.songId]),
			resolveMinMatchScore(session.accountId),
		]);

		if (songRow.error || !songRow.data) return null;
		if (Result.isError(songDetailsResult) || Result.isError(decisionsResult))
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

		const builtSong: MatchingSong = {
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
		};

		const decidedPairs = new Set(
			decisionsResult.value.map((d) => `${d.song_id}:${d.playlist_id}`),
		);

		const songMatchResults = songDetailsResult.value.filter(
			(mr) =>
				mr.score >= minScore &&
				!decidedPairs.has(`${data.songId}:${mr.playlist_id}`),
		);

		// With the frozen list, Previous revisits already-decided songs — return the
		// song with empty matches rather than null, so a revisit never hits the
		// blank-page path. The UI guards its dismiss write behind `matches.length > 0`.
		if (songMatchResults.length === 0) {
			return { song: builtSong, matches: [] };
		}

		const playlistIds = songMatchResults.map((mr) => mr.playlist_id);
		const { data: playlistRows, error: playlistError } = await supabase
			.from("playlist")
			.select("id, name, match_intent, song_count, spotify_id")
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
						description: playlist.match_intent,
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

		return { song: builtSong, matches };
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

export interface AddToPlaylistParams {
	songId: string;
	playlistId: string;
	snapshotId?: string;
}

export interface AddToPlaylistResult {
	success: boolean;
}

export const addSongToPlaylist = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => AddToPlaylistSchema.parse(data))
	.handler(async ({ data, context }): Promise<AddToPlaylistResult> => {
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
				servedRank: served.rankByPlaylist.get(data.playlistId) ?? null,
			},
		);
		return { success: Result.isOk(result) };
	});

// Each id is ownership-checked below, but bound the array first so a giant
// payload can't blow up the ownership IN() query. 500 sits well above the number
// of playlists a single song realistically matches.
const MAX_DISMISS_PLAYLISTS = 500;

const DismissSongSchema = z.object({
	songId: z.uuid(),
	playlistIds: z.array(z.uuid()).min(1).max(MAX_DISMISS_PLAYLISTS),
	// The snapshot whose ranking the user acted on (see AddToPlaylistSchema).
	snapshotId: z.uuid().optional(),
});

export interface DismissSongParams {
	songId: string;
	playlistIds: string[];
	snapshotId?: string;
}

export const dismissSong = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => DismissSongSchema.parse(data))
	.handler(async ({ data, context }) => {
		const { session } = context;
		// Served-context resolution is best-effort and independent of the ownership
		// checks, so it rides the same Promise.all instead of adding a serial wait.
		const [songOwned, playlistsOwned, served] = await Promise.all([
			isSongOwnedByAccount(session.accountId, data.songId),
			doPlaylistsBelongToAccount(data.playlistIds, session.accountId),
			resolveServedContext(session.accountId, data.songId, data.snapshotId),
		]);
		if (!songOwned || !playlistsOwned) {
			return { success: false };
		}

		// One snapshot, many playlists: surfaced pairs carry their served_rank;
		// the rest get null (implicit negatives) — both land in the same upsert.
		const decisions = data.playlistIds.map((playlistId) => ({
			accountId: session.accountId,
			songId: data.songId,
			playlistId,
			decision: "dismissed" as const,
			snapshotId: served.snapshotId,
			servedRank: served.rankByPlaylist.get(playlistId) ?? null,
		}));
		const result = await upsertMatchDecisions(decisions);
		return { success: Result.isOk(result) };
	});

// ============================================================================
// markSeen server function (for session lifecycle)
// ============================================================================

// songIds accumulates across a whole matching session, so the cap is generous —
// above any realistic session — to never drop a legitimate flush. It exists to
// stop a single call forcing a multi-million-row upsert into account_item_newness.
// The client (useMatchingSession) slices to this same cap so real flushes never
// trip it; anything larger is definitionally not our client.
export const MAX_MARK_SEEN_SONGS = 10_000;

const MarkSeenSchema = z.object({
	songIds: z.array(z.uuid()).max(MAX_MARK_SEEN_SONGS),
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
