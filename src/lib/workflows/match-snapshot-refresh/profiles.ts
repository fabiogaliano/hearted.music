/**
 * Target-playlist profiling for the refresh workflow.
 * Reuses the existing playlist profiling service with cache support.
 */

import { Result } from "better-result";
import * as playlistData from "@/lib/domains/library/playlists/queries";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import * as songData from "@/lib/domains/library/songs/queries";
import {
	createAudioFeaturesService,
	type TrackInfo,
} from "@/lib/integrations/audio/service";
import { createReccoBeatsService } from "@/lib/integrations/reccobeats/service";
import {
	createGenreEnrichmentService,
	type GenreEnrichmentInput,
} from "@/lib/domains/enrichment/genre-tagging/service";
import type { PlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";
import type { MatchingPlaylistProfile } from "@/lib/domains/taste/song-matching/types";

/**
 * Loads current target playlists and computes/caches their profiles.
 * Returns the playlist rows and their matching-ready profile data.
 */
export async function loadTargetPlaylistProfiles(
	accountId: string,
	profilingService: PlaylistProfilingService,
): Promise<{
	playlists: Playlist[];
	profiles: MatchingPlaylistProfile[];
}> {
	const playlistsResult = await playlistData.getTargetPlaylists(accountId);
	if (Result.isError(playlistsResult)) {
		throw new Error(
			`[target-refresh] Failed to load target playlists: ${playlistsResult.error.message}`,
		);
	}
	if (playlistsResult.value.length === 0) {
		return { playlists: [], profiles: [] };
	}

	const playlists = playlistsResult.value;
	const audioFeaturesService = createAudioFeaturesService(
		createReccoBeatsService(),
	);
	const genreService = createGenreEnrichmentService();

	const profiles: MatchingPlaylistProfile[] = [];

	for (const playlist of playlists) {
		const playlistSongsResult = await playlistData.getPlaylistSongs(
			playlist.id,
		);
		if (Result.isError(playlistSongsResult)) {
			throw new Error(
				`[target-refresh] Failed to load songs for playlist ${playlist.id}: ${playlistSongsResult.error.message}`,
			);
		}

		const songIds = playlistSongsResult.value.map((ps) => ps.song_id);
		const songsResult = await songData.getByIds(songIds);
		if (Result.isError(songsResult)) {
			throw new Error(
				`[target-refresh] Failed to load song data for playlist ${playlist.id}: ${songsResult.error.message}`,
			);
		}

		// Backfill audio features and genres for profile computation
		const trackInfos: TrackInfo[] = songsResult.value.map((s) => ({
			songId: s.id,
			spotifyTrackId: s.spotify_id,
		}));
		await audioFeaturesService.backfillMissingFeatures(trackInfos);

		const genreInputs: GenreEnrichmentInput[] = songsResult.value.map((s) => ({
			songId: s.id,
			artist: s.artists[0] ?? "Unknown",
			trackName: s.name,
			album: s.album_name ?? undefined,
		}));
		await genreService.enrichBatch(genreInputs);

		// Re-read songs after enrichment for fresh genre data
		const freshSongsResult = await songData.getByIds(songIds);
		const songs = Result.isOk(freshSongsResult)
			? freshSongsResult.value
			: songsResult.value;

		const profileResult = await profilingService.computeProfile(
			playlist.id,
			songs,
			{
				name: playlist.name,
				description: playlist.description ?? undefined,
			},
		);

		if (Result.isError(profileResult) || !profileResult.value) {
			throw new Error(
				`[target-refresh] Failed to compute profile for playlist ${playlist.id}`,
			);
		}

		const p = profileResult.value;
		profiles.push({
			playlistId: p.playlistId,
			embedding: p.embedding,
			audioCentroid: p.audioCentroid as Record<string, number>,
			genreDistribution: p.genreDistribution as Record<string, number>,
		});
	}

	return { playlists, profiles };
}
