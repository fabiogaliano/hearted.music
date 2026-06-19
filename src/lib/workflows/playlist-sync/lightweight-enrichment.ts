/**
 * Lightweight enrichment workflow for target-playlist-only songs.
 *
 * Runs cheap/free enrichment steps only:
 * 1. Audio features (ReccoBeats — free)
 * 2. Genre tagging (Last.fm — free)
 *
 * No LLM analysis, no embeddings, no reranking, no paid steps. Embeddings come
 * only from the analysis-prose pipeline (one representation per embedding space);
 * cheap-path members contribute audio + genre, and the matcher's adaptive weights
 * redistribute around their missing embedding factor.
 * Called by the target-playlist refresh orchestrator.
 */

import { Result } from "better-result";
import {
	createGenreEnrichmentService,
	type GenreEnrichmentInput,
} from "@/lib/domains/enrichment/genre-tagging/service";
import { resolveVocalGenderForSongs } from "@/lib/domains/enrichment/vocal-gender/service";
import {
	getPlaylistSongs,
	getTargetPlaylists,
	type Playlist,
} from "@/lib/domains/library/playlists/queries";
import type { Song } from "@/lib/domains/library/songs/queries";
import { getByIds } from "@/lib/domains/library/songs/queries";
import {
	createAudioFeaturesService,
	type TrackInfo,
} from "@/lib/integrations/audio/service";
import { createReccoBeatsService } from "@/lib/integrations/reccobeats/service";
import type { DbError } from "@/lib/shared/errors/database";
import { chunkArray, mapWithConcurrency } from "@/lib/shared/utils/concurrency";
import { fromSupabaseMany } from "@/lib/shared/utils/result-wrappers/supabase";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface LightweightEnrichmentOptions {
	accountId: string;
	/** Restrict to specific playlists (default: all target playlists) */
	playlistIds?: string[];
	/** Restrict to specific songs (skip candidate selection) */
	songIds?: string[];
}

interface LightweightEnrichmentStats {
	songsScanned: number;
	audio: { filled: number; skipped: number; failed: number };
	genres: { filled: number; skipped: number; failed: number };
	vocalGender: { resolvedLocal: number; resolvedWikidata: number };
	affectedSongIds: string[];
	affectedPlaylistIds: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidate selection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Selects playlist-only songs that need enrichment.
 * Excludes songs that are actively liked (those go through the full pipeline).
 */
async function selectCandidates(
	opts: LightweightEnrichmentOptions,
): Promise<Result<{ songs: Song[]; playlistIds: string[] }, DbError>> {
	if (opts.songIds && opts.songIds.length > 0) {
		const songsResult = await getByIds(opts.songIds);
		if (Result.isError(songsResult)) return songsResult;
		// When explicit songIds are provided, we don't know which playlists — return empty
		return Result.ok({ songs: songsResult.value, playlistIds: [] });
	}

	// Determine target playlists
	let targetPlaylists: Playlist[];
	if (opts.playlistIds && opts.playlistIds.length > 0) {
		const targetResult = await getTargetPlaylists(opts.accountId);
		if (Result.isError(targetResult)) return targetResult;
		const requestedPlaylistIds = new Set(opts.playlistIds);
		targetPlaylists = targetResult.value.filter((p) =>
			requestedPlaylistIds.has(p.id),
		);
	} else {
		const targetResult = await getTargetPlaylists(opts.accountId);
		if (Result.isError(targetResult)) return targetResult;
		targetPlaylists = targetResult.value;
	}

	if (targetPlaylists.length === 0) {
		return Result.ok({ songs: [], playlistIds: [] });
	}

	// Gather all song IDs from target playlists
	const PLAYLIST_SONGS_CONCURRENCY = 4;
	const playlistSongResults = await mapWithConcurrency(
		targetPlaylists,
		PLAYLIST_SONGS_CONCURRENCY,
		async (playlist) => ({
			playlistId: playlist.id,
			result: await getPlaylistSongs(playlist.id),
		}),
	);

	const allSongIds = new Set<string>();
	const affectedPlaylistIds: string[] = [];

	for (const { playlistId, result } of playlistSongResults) {
		if (Result.isError(result)) continue;
		if (result.value.length > 0) {
			affectedPlaylistIds.push(playlistId);
			for (const ps of result.value) {
				allSongIds.add(ps.song_id);
			}
		}
	}

	if (allSongIds.size === 0) {
		return Result.ok({ songs: [], playlistIds: affectedPlaylistIds });
	}

	// Fetch the actual song rows
	const songsResult = await getByIds([...allSongIds]);
	if (Result.isError(songsResult)) return songsResult;

	// Exclude liked songs — they go through the full enrichment pipeline
	const { createAdminSupabaseClient } = await import("@/lib/data/client");
	const supabase = createAdminSupabaseClient();
	const SONG_ID_BATCH_SIZE = 100;
	const SONG_ID_BATCH_CONCURRENCY = 4;
	const likedResults = await mapWithConcurrency(
		chunkArray([...allSongIds], SONG_ID_BATCH_SIZE),
		SONG_ID_BATCH_CONCURRENCY,
		(songIdBatch) =>
			fromSupabaseMany<{ song_id: string }>(
				supabase
					.from("liked_song")
					.select("song_id")
					.eq("account_id", opts.accountId)
					.is("unliked_at", null)
					.in("song_id", songIdBatch),
			),
	);

	const likedSongIds = new Set<string>();
	for (const likedResult of likedResults) {
		if (Result.isError(likedResult)) {
			return Result.err(likedResult.error);
		}
		for (const row of likedResult.value) {
			likedSongIds.add(row.song_id);
		}
	}
	const playlistOnlySongs = songsResult.value.filter(
		(s) => !likedSongIds.has(s.id),
	);

	return Result.ok({
		songs: playlistOnlySongs,
		playlistIds: affectedPlaylistIds,
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// Main workflow
// ─────────────────────────────────────────────────────────────────────────────

export async function runLightweightEnrichment(
	opts: LightweightEnrichmentOptions,
): Promise<LightweightEnrichmentStats> {
	const stats: LightweightEnrichmentStats = {
		songsScanned: 0,
		audio: { filled: 0, skipped: 0, failed: 0 },
		genres: { filled: 0, skipped: 0, failed: 0 },
		vocalGender: { resolvedLocal: 0, resolvedWikidata: 0 },
		affectedSongIds: [],
		affectedPlaylistIds: [],
	};

	// 1. Select candidates
	const candidatesResult = await selectCandidates(opts);
	if (Result.isError(candidatesResult)) {
		console.warn("Candidate selection failed:", candidatesResult.error.message);
		return stats;
	}

	const { songs: candidateSongs, playlistIds } = candidatesResult.value;
	stats.songsScanned = candidateSongs.length;
	stats.affectedPlaylistIds = playlistIds;

	if (candidateSongs.length === 0) {
		return stats;
	}

	stats.affectedSongIds = candidateSongs.map((s) => s.id);

	// 2. Backfill audio features
	const audioStats = await backfillAudio(candidateSongs);
	stats.audio = audioStats;

	// 3. Backfill genres
	const genreStats = await backfillGenres(candidateSongs);
	stats.genres = genreStats;

	// 4. Resolve vocal gender (local MusicBrainz dump -> Wikidata fallback)
	const genderStats = await resolveVocalGenderForSongs(candidateSongs);
	stats.vocalGender = {
		resolvedLocal: genderStats.resolvedLocal,
		resolvedWikidata: genderStats.resolvedWikidata,
	};

	return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage: Audio features
// ─────────────────────────────────────────────────────────────────────────────

async function backfillAudio(
	candidateSongs: Song[],
): Promise<{ filled: number; skipped: number; failed: number }> {
	const tracks: TrackInfo[] = candidateSongs.map((s) => ({
		songId: s.id,
		spotifyTrackId: s.spotify_id,
	}));

	try {
		const service = createAudioFeaturesService(createReccoBeatsService());
		const result = await service.backfillMissingFeatures(tracks);
		if (Result.isError(result)) {
			return { filled: 0, skipped: 0, failed: tracks.length };
		}
		return {
			filled: result.value.filled.size,
			skipped: result.value.skipped.length,
			failed: result.value.failed.length,
		};
	} catch (err) {
		console.warn("Audio backfill failed:", err);
		return { filled: 0, skipped: 0, failed: tracks.length };
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage: Genre tagging
// ─────────────────────────────────────────────────────────────────────────────

async function backfillGenres(
	candidateSongs: Song[],
): Promise<{ filled: number; skipped: number; failed: number }> {
	// Only enrich songs without genres
	const needsGenres = candidateSongs.filter(
		(s) => !s.genres || s.genres.length === 0,
	);

	if (needsGenres.length === 0) {
		return { filled: 0, skipped: candidateSongs.length, failed: 0 };
	}

	const inputs: GenreEnrichmentInput[] = needsGenres.map((s) => ({
		songId: s.id,
		artist: s.artists[0] ?? "",
		trackName: s.name,
		album: s.album_name ?? undefined,
	}));

	try {
		const service = createGenreEnrichmentService();
		const result = await service.enrichBatch(inputs);
		if (Result.isError(result)) {
			return { filled: 0, skipped: 0, failed: inputs.length };
		}
		return {
			filled: result.value.stats.fetched + result.value.stats.cached,
			skipped:
				candidateSongs.length -
				needsGenres.length +
				result.value.stats.notFound,
			failed: result.value.stats.failed,
		};
	} catch (err) {
		console.warn("Genre backfill failed:", err);
		return { filled: 0, skipped: 0, failed: inputs.length };
	}
}
