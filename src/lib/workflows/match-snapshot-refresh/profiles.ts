/**
 * Target-playlist profiling for the refresh workflow.
 * Reuses the existing playlist profiling service with cache support.
 */

import { Result } from "better-result";
import {
	createGenreEnrichmentService,
	type GenreEnrichmentInput,
} from "@/lib/domains/enrichment/genre-tagging/service";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import {
	getPlaylistSongs,
	getTargetPlaylists,
} from "@/lib/domains/library/playlists/queries";
import { getByIds } from "@/lib/domains/library/songs/queries";
import { toAudioCentroidRecord } from "@/lib/domains/taste/playlist-profiling/calculations";
import type { PlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";
import type { MatchingPlaylistProfile } from "@/lib/domains/taste/song-matching/types";
import {
	createAudioFeaturesService,
	type TrackInfo,
} from "@/lib/integrations/audio/service";
import { createReccoBeatsService } from "@/lib/integrations/reccobeats/service";
import { log } from "@/lib/observability/logger";
import { mapWithConcurrency } from "@/lib/shared/utils/concurrency";

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
	const playlistsResult = await getTargetPlaylists(accountId);
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

	const PROFILE_CONCURRENCY = 2;
	const profileResults = await mapWithConcurrency(
		playlists,
		PROFILE_CONCURRENCY,
		async (
			playlist,
		): Promise<{
			playlist: Playlist;
			profile: MatchingPlaylistProfile;
		} | null> => {
			try {
				const playlistSongsResult = await getPlaylistSongs(playlist.id);
				if (Result.isError(playlistSongsResult)) {
					throw new Error(
						`[target-refresh] Failed to load songs for playlist ${playlist.id}: ${playlistSongsResult.error.message}`,
					);
				}

				const songIds = playlistSongsResult.value.map((ps) => ps.song_id);
				const songsResult = await getByIds(songIds);
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

				const genreInputs: GenreEnrichmentInput[] = songsResult.value.map(
					(s) => ({
						songId: s.id,
						artist: s.artists[0] ?? "Unknown",
						trackName: s.name,
						album: s.album_name ?? undefined,
					}),
				);
				await genreService.enrichBatch(genreInputs);

				// Re-read songs after enrichment for fresh genre data
				const freshSongsResult = await getByIds(songIds);
				const songs = Result.isOk(freshSongsResult)
					? freshSongsResult.value
					: songsResult.value;

				const profileResult = await profilingService.computeProfile(
					playlist.id,
					songs,
					{
						name: playlist.name,
						description: playlist.match_intent ?? undefined,
						// Thread pills so the embedding, blend, HyDE path, and hash all reflect
						// the user's declared genres — without this the pills only reach the
						// reranker query but are silently absent from the profile itself.
						genrePills: playlist.genre_pills ?? [],
					},
				);

				if (Result.isError(profileResult) || !profileResult.value) {
					throw new Error(
						`[target-refresh] Failed to compute profile for playlist ${playlist.id}`,
					);
				}

				const p = profileResult.value;
				return {
					playlist,
					profile: {
						playlistId: p.playlistId,
						embedding: p.embedding,
						audioCentroid: toAudioCentroidRecord(p.audioCentroid),
						genreDistribution: p.genreDistribution,
						// getTargetPlaylists uses select("*"), so genre_pills is always
						// present on the row. The boolean is all the matcher needs to
						// select the right base weights — the actual pill list is already
						// baked into genreDistribution and the intent embedding by
						// computeProfile (Task 1.4).
						hasGenrePills: (playlist.genre_pills?.length ?? 0) > 0,
					},
				};
			} catch (error) {
				// One playlist failing (load/enrich/compute) must not abort the whole
				// snapshot — drop just this playlist and let the refresh proceed with
				// the rest, instead of losing every other playlist's update.
				log.warn("match:playlist-profile-failed", {
					playlistId: playlist.id,
					error: error instanceof Error ? error.message : String(error),
				});
				return null;
			}
		},
	);

	const computed = profileResults.filter(
		(r): r is { playlist: Playlist; profile: MatchingPlaylistProfile } =>
			r !== null,
	);

	// Every playlist failing points at a systemic problem (e.g. a DB outage), not
	// a per-playlist quirk — abort so the job retries, rather than publishing an
	// empty snapshot that would wipe the user's existing suggestions.
	if (computed.length === 0) {
		throw new Error(
			`[target-refresh] All ${playlists.length} target playlist profiles failed to compute`,
		);
	}

	return {
		playlists: computed.map((r) => r.playlist),
		profiles: computed.map((r) => r.profile),
	};
}
