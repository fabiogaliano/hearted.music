/**
 * Lightweight enrichment workflow for target-playlist-only songs.
 *
 * Runs cheap/free enrichment steps only:
 * 1. Audio features (ReccoBeats — free)
 * 2. Genre tagging (Last.fm — free)
 * 3. Lyrics-based embeddings (Genius + ML provider)
 *
 * No LLM analysis, no reranking, no paid steps.
 * Called by the target-playlist refresh orchestrator.
 */

import { Result } from "better-result";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import {
	createGenreEnrichmentService,
	type GenreEnrichmentInput,
} from "@/lib/domains/enrichment/genre-tagging/service";
import { createLyricsService } from "@/lib/domains/enrichment/lyrics/service";
import * as playlists from "@/lib/domains/library/playlists/queries";
import type { Song } from "@/lib/domains/library/songs/queries";
import * as songs from "@/lib/domains/library/songs/queries";
import {
	createAudioFeaturesService,
	type TrackInfo,
} from "@/lib/integrations/audio/service";
import { createReccoBeatsService } from "@/lib/integrations/reccobeats/service";
import type { DbError } from "@/lib/shared/errors/database";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface LightweightEnrichmentOptions {
	accountId: string;
	/** Restrict to specific playlists (default: all target playlists) */
	playlistIds?: string[];
	/** Restrict to specific songs (skip candidate selection) */
	songIds?: string[];
}

export interface LightweightEnrichmentStats {
	songsScanned: number;
	audio: { filled: number; skipped: number; failed: number };
	genres: { filled: number; skipped: number; failed: number };
	lyricsEmbeddings: { stored: number; skipped: number; failed: number };
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
		const songsResult = await songs.getByIds(opts.songIds);
		if (Result.isError(songsResult)) return songsResult;
		// When explicit songIds are provided, we don't know which playlists — return empty
		return Result.ok({ songs: songsResult.value, playlistIds: [] });
	}

	// Determine target playlists
	let targetPlaylists: playlists.Playlist[];
	if (opts.playlistIds && opts.playlistIds.length > 0) {
		const targetResult = await playlists.getTargetPlaylists(opts.accountId);
		if (Result.isError(targetResult)) return targetResult;
		targetPlaylists = targetResult.value.filter((p) =>
			opts.playlistIds!.includes(p.id),
		);
	} else {
		const targetResult = await playlists.getTargetPlaylists(opts.accountId);
		if (Result.isError(targetResult)) return targetResult;
		targetPlaylists = targetResult.value;
	}

	if (targetPlaylists.length === 0) {
		return Result.ok({ songs: [], playlistIds: [] });
	}

	// Gather all song IDs from target playlists
	const allSongIds = new Set<string>();
	const affectedPlaylistIds: string[] = [];

	for (const pl of targetPlaylists) {
		const psResult = await playlists.getPlaylistSongs(pl.id);
		if (Result.isError(psResult)) continue;
		if (psResult.value.length > 0) {
			affectedPlaylistIds.push(pl.id);
			for (const ps of psResult.value) {
				allSongIds.add(ps.song_id);
			}
		}
	}

	if (allSongIds.size === 0) {
		return Result.ok({ songs: [], playlistIds: affectedPlaylistIds });
	}

	// Fetch the actual song rows
	const songsResult = await songs.getByIds([...allSongIds]);
	if (Result.isError(songsResult)) return songsResult;

	// Exclude liked songs — they go through the full enrichment pipeline
	const { createAdminSupabaseClient } = await import("@/lib/data/client");
	const supabase = createAdminSupabaseClient();
	const { data: likedRows } = await supabase
		.from("liked_song")
		.select("song_id")
		.eq("account_id", opts.accountId)
		.is("unliked_at", null)
		.in("song_id", [...allSongIds]);

	const likedSongIds = new Set((likedRows ?? []).map((r) => r.song_id));
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
		lyricsEmbeddings: { stored: 0, skipped: 0, failed: 0 },
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

	// 4. Fetch lyrics and store embeddings
	const lyricsStats = await backfillLyricsEmbeddings(candidateSongs);
	stats.lyricsEmbeddings = lyricsStats;

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

// ─────────────────────────────────────────────────────────────────────────────
// Stage: Lyrics-based embeddings
// ─────────────────────────────────────────────────────────────────────────────

async function backfillLyricsEmbeddings(
	candidateSongs: Song[],
): Promise<{ stored: number; skipped: number; failed: number }> {
	// Create services — both are optional/best-effort
	const lyricsResult = createLyricsService();
	if (Result.isError(lyricsResult)) {
		console.warn(
			"Lyrics service unavailable, skipping lyrics embeddings:",
			lyricsResult.error.message,
		);
		return { stored: 0, skipped: candidateSongs.length, failed: 0 };
	}
	const lyricsService = lyricsResult.value;

	let embeddingService: EmbeddingService;
	try {
		embeddingService = new EmbeddingService();
	} catch (err) {
		console.warn("Embedding service unavailable, skipping lyrics embeddings");
		return { stored: 0, skipped: candidateSongs.length, failed: 0 };
	}

	// Check which songs already have embeddings
	const songIds = candidateSongs.map((s) => s.id);
	const existingResult = await embeddingService.getEmbeddings(songIds);
	const existingIds = Result.isOk(existingResult)
		? new Set(existingResult.value.keys())
		: new Set<string>();

	let stored = 0;
	let skipped = 0;
	let failed = 0;

	for (const song of candidateSongs) {
		if (existingIds.has(song.id)) {
			skipped++;
			continue;
		}

		const artist = song.artists[0] ?? "";
		if (!artist) {
			skipped++;
			continue;
		}

		const textResult = await lyricsService.getLyricsText(artist, song.name);
		if (Result.isError(textResult)) {
			failed++;
			continue;
		}

		const storeResult = await embeddingService.embedAndStoreText(
			song.id,
			textResult.value,
			{ prefix: "passage:" },
		);

		if (Result.isOk(storeResult)) {
			stored++;
		} else {
			failed++;
		}
	}

	return { stored, skipped, failed };
}
