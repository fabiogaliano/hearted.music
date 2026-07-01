import type { createAdminSupabaseClient } from "@/lib/data/client";
import { captureServerError } from "@/lib/observability/capture-server-error";
import type { MatchingPlaylistMatch, MatchingSong } from "./matching.functions";

// Minimal row shapes — only the fields the mapper and fetch wrapper use.
type SongRow = {
	id: string;
	spotify_id: string;
	name: string;
	artists: string[];
	album_name: string | null;
	image_url: string | null;
	genres: string[];
};

type AudioRow = {
	tempo: number | null;
	energy: number | null;
	valence: number | null;
};

type PlaylistRow = {
	id: string;
	name: string;
	match_intent: string | null;
	song_count: number | null;
	image_url: string | null;
	spotify_id: string;
};

export type SongOrientationSuggestionEntry = {
	songId: string;
	playlistId: string;
	fitScore: number;
	visibleRank: number;
};

export type SongOrientationRenderData =
	| {
			status: "ok";
			reviewItem: MatchingSong;
			suggestions: MatchingPlaylistMatch[];
	  }
	| { status: "missing-song" }
	| { status: "playlist-error" };

/**
 * Pure row→view-model mapper for song-orientation review cards.
 *
 * Accepts nullable song (→ missing-song) and nullable playlists (→ playlist-error)
 * so the fetch wrapper can forward raw DB results without an intermediate guard.
 * Audio and analysis nulls produce null audioFeatures/analysis on the MatchingSong
 * — those optional reads never cause a missing-song outcome.
 *
 * Suggestions are sorted by visibleRank ascending before mapping; this is
 * idempotent when the caller has already sorted (computeVisibleSuggestionList
 * pre-sorts), and correct for already_captured pairs fetched from the DB in
 * arbitrary order.
 *
 * No supabase calls, no side effects — unit-testable in isolation.
 */
export function mapSongOrientationRows(
	song: SongRow | null,
	audio: AudioRow | null,
	analysis: MatchingSong["analysis"] | null,
	playlists: PlaylistRow[] | null,
	suggestions: SongOrientationSuggestionEntry[],
): SongOrientationRenderData {
	if (!song) return { status: "missing-song" };
	if (!playlists) return { status: "playlist-error" };

	const reviewItem: MatchingSong = {
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

	const playlistMap = new Map(playlists.map((p) => [p.id, p]));
	const outputSuggestions: MatchingPlaylistMatch[] = [];
	for (const s of suggestions
		.slice()
		.sort((a, b) => a.visibleRank - b.visibleRank)) {
		const playlist = playlistMap.get(s.playlistId);
		if (!playlist) continue;
		outputSuggestions.push({
			playlist: {
				id: playlist.id,
				name: playlist.name,
				description: playlist.match_intent,
				trackCount: playlist.song_count,
				imageUrl: playlist.image_url,
				spotifyId: playlist.spotify_id,
			},
			score: s.fitScore,
			rank: s.visibleRank,
			// factors are not stored in ranking/capture rows and not needed for card render (MSR-24).
			factors: null,
		});
	}

	return { status: "ok", reviewItem, suggestions: outputSuggestions };
}

/**
 * Thin async wrapper: fetches the four DB rows needed for a song-orientation
 * review card in parallel, logs non-fatal audio/analysis errors, logs the
 * song-error (when non-PGRST116) and playlist-error before delegating to
 * mapSongOrientationRows.
 *
 * Both missing-song and playlist-error outcomes are returned as typed statuses
 * so each caller supplies its own user-facing message when translating to
 * MatchReviewItemRead.
 */
export async function fetchSongOrientationData(
	supabase: ReturnType<typeof createAdminSupabaseClient>,
	opts: {
		songId: string;
		suggestions: SongOrientationSuggestionEntry[];
		accountId: string;
		operation: string;
	},
): Promise<SongOrientationRenderData> {
	const { songId, suggestions, accountId, operation } = opts;
	const playlistIds = suggestions.map((s) => s.playlistId);

	const playlistRead =
		playlistIds.length === 0
			? Promise.resolve({ data: [] as PlaylistRow[], error: null })
			: supabase
					.from("playlist")
					.select("id, name, match_intent, song_count, image_url, spotify_id")
					.in("id", playlistIds);

	const [songRow, audioRow, analysisRow, playlistResult] = await Promise.all([
		supabase.from("song").select("*").eq("id", songId).single(),
		supabase
			.from("song_audio_feature")
			.select("tempo, energy, valence")
			.eq("song_id", songId)
			.maybeSingle(),
		supabase
			.from("song_analysis")
			.select("analysis")
			.eq("song_id", songId)
			.order("created_at", { ascending: false })
			.limit(1)
			.maybeSingle(),
		playlistRead,
	]);

	// .single() returns PGRST116 for a genuinely missing song — not-found, not an
	// incident. Any other code is an operational read failure that must reach Sentry.
	if (songRow.error && songRow.error.code !== "PGRST116") {
		captureServerError(songRow.error, {
			area: "match_review_queue",
			operation,
			accountId,
			extra: { orientation: "song" },
		});
	}

	// Audio and analysis are decorative optional reads (.maybeSingle()). A failure
	// must not change the card outcome — but must be visible rather than silently
	// degraded into a missing field.
	if (audioRow.error) {
		captureServerError(audioRow.error, {
			area: "match_review_queue",
			operation,
			accountId,
			extra: { orientation: "song" },
		});
	}
	if (analysisRow.error) {
		captureServerError(analysisRow.error, {
			area: "match_review_queue",
			operation,
			accountId,
			extra: { orientation: "song" },
		});
	}

	// Operational DB failure on the suggestion-playlist .in(...) read — captured
	// before delegating to the mapper so the playlist-error status has a server trace.
	if (playlistResult.error) {
		captureServerError(playlistResult.error, {
			area: "match_review_queue",
			operation,
			accountId,
			extra: { orientation: "song" },
		});
	}

	const analysis = analysisRow.data?.analysis as
		| MatchingSong["analysis"]
		| undefined;

	return mapSongOrientationRows(
		songRow.data ? (songRow.data as SongRow) : null,
		audioRow.data ?? null,
		analysis ?? null,
		playlistResult.error ? null : (playlistResult.data ?? []),
		suggestions,
	);
}
