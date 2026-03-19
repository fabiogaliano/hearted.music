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
import type { EnrichmentContext } from "../types";

export async function runPlaylistProfiling(ctx: EnrichmentContext): Promise<{
	total: number;
	succeeded: number;
	failed: number;
	playlists: Playlist[];
}> {
	let playlists: Playlist[];
	try {
		const playlistsResult = await playlistData.getDestinationPlaylists(
			ctx.accountId,
		);
		if (Result.isError(playlistsResult)) {
			return { total: 0, succeeded: 0, failed: 0, playlists: [] };
		}
		playlists = playlistsResult.value;
	} catch {
		return { total: 0, succeeded: 0, failed: 0, playlists: [] };
	}

	if (playlists.length === 0) {
		return { total: 0, succeeded: 0, failed: 0, playlists: [] };
	}

	const audioFeaturesService = createAudioFeaturesService(
		createReccoBeatsService(),
	);
	const genreService = createGenreEnrichmentService();

	let succeeded = 0;
	let failed = 0;

	for (const playlist of playlists) {
		const playlistSongsResult = await playlistData.getPlaylistSongs(
			playlist.id,
		);
		if (Result.isError(playlistSongsResult)) {
			failed++;
			continue;
		}

		const songIds = playlistSongsResult.value.map((ps) => ps.song_id);
		const songsResult = await songData.getByIds(songIds);
		if (Result.isError(songsResult)) {
			failed++;
			continue;
		}

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

		const freshSongsResult = await songData.getByIds(songIds);
		const songs = Result.isOk(freshSongsResult)
			? freshSongsResult.value
			: songsResult.value;

		const profileResult = await ctx.profilingService.computeProfile(
			playlist.id,
			songs,
			{ name: playlist.name, description: playlist.description ?? undefined },
		);
		if (Result.isOk(profileResult)) {
			if (!profileResult.value.fromCache) {
				succeeded++;
			}
		} else {
			failed++;
		}
	}

	return { total: playlists.length, succeeded, failed, playlists };
}
