/**
 * Target-playlist profiling for the refresh workflow.
 * Reuses the existing playlist profiling service with cache support.
 */

import { Result } from "better-result";
import {
	createAudioFeaturesService,
	type TrackInfo,
} from "@/lib/domains/enrichment/audio-features/service";
import { getModelBundleHash } from "@/lib/domains/enrichment/embeddings/versioning";
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
import type { ComputedPlaylistProfile } from "@/lib/domains/taste/playlist-profiling/types";
import type { MatchingPlaylistProfile } from "@/lib/domains/taste/song-matching/types";
import { createReccoBeatsService } from "@/lib/integrations/reccobeats/service";
import { captureServerError } from "@/lib/observability/capture-server-error";
import { log } from "@/lib/observability/logger";
import { errorMessage } from "@/lib/shared/errors/error-message";
import { mapWithConcurrency } from "@/lib/shared/utils/concurrency";

type ProfilingOutcome =
	| { status: "computed"; playlist: Playlist; profile: MatchingPlaylistProfile }
	| { status: "failed"; playlist: Playlist; error: unknown };

function toMatchingProfile(
	playlist: Playlist,
	p: ComputedPlaylistProfile,
): MatchingPlaylistProfile {
	return {
		playlistId: p.playlistId,
		embedding: p.embedding,
		audioCentroid: toAudioCentroidRecord(p.audioCentroid),
		genreDistribution: p.genreDistribution,
		// getTargetPlaylists uses select("*"), so genre_pills is always
		// present on the row. The boolean is all the matcher needs to
		// select the right base weights — the actual pill list is already
		// baked into genreDistribution and the intent embedding by
		// computeProfile (Task 1.4).
		// For a carried-forward profile this reads today's pills while the
		// distribution and embedding hold the pills it was computed with: the
		// stored profile records that pill state only inside content_hash, which
		// can't be reversed. A pill edit since then mismatches the weight set
		// until the next successful profile.
		hasGenrePills: (playlist.genre_pills?.length ?? 0) > 0,
	};
}

/**
 * Publishing without a target playlist would hide its suggestions until the
 * next library change, so a playlist that fails to profile is matched on its
 * last persisted profile instead. Without a usable one the run throws, the job
 * retries, and the previous complete snapshot stays published meanwhile.
 */
async function carryForwardPriorProfile(
	accountId: string,
	playlist: Playlist,
	error: unknown,
	profilingService: PlaylistProfilingService,
): Promise<MatchingPlaylistProfile> {
	const failure = `[target-refresh] Failed to profile playlist ${playlist.id} (${errorMessage(error)})`;
	const [priorResult, bundleResult] = await Promise.all([
		profilingService.getProfile(playlist.id),
		getModelBundleHash(),
	]);
	if (Result.isError(priorResult)) {
		throw new Error(
			`${failure} and its prior profile could not be read: ${priorResult.error.message}`,
			{ cause: error },
		);
	}
	if (Result.isError(bundleResult)) {
		throw new Error(
			`${failure} and the model bundle could not be resolved: ${bundleResult.error.message}`,
			{ cause: error },
		);
	}
	const prior = priorResult.value;
	if (!prior) {
		throw new Error(`${failure} and it has no prior profile`, {
			cause: error,
		});
	}
	// Another bundle's embedding lives in a different vector space from the
	// candidates' embeddings, so scoring against it would be meaningless.
	if (prior.modelBundleHash !== bundleResult.value) {
		throw new Error(
			`${failure} and its prior profile predates the current model bundle`,
			{ cause: error },
		);
	}

	captureServerError(error, {
		area: "matching",
		operation: "profile_target_playlist",
		accountId,
		extra: { playlistId: playlist.id, carriedForward: true },
	});
	return toMatchingProfile(playlist, prior);
}

/**
 * Loads current target playlists and computes/caches their profiles.
 * Returns every target playlist with a matching-ready profile, and how many of
 * those profiles were carried forward from a failed computation.
 */
export async function loadTargetPlaylistProfiles(
	accountId: string,
	profilingService: PlaylistProfilingService,
): Promise<{
	playlists: Playlist[];
	profiles: MatchingPlaylistProfile[];
	carriedForwardCount: number;
}> {
	const playlistsResult = await getTargetPlaylists(accountId);
	if (Result.isError(playlistsResult)) {
		throw new Error(
			`[target-refresh] Failed to load target playlists: ${playlistsResult.error.message}`,
		);
	}
	if (playlistsResult.value.length === 0) {
		return { playlists: [], profiles: [], carriedForwardCount: 0 };
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
		async (playlist): Promise<ProfilingOutcome> => {
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

				if (Result.isError(profileResult)) {
					throw new Error(
						`[target-refresh] Failed to compute profile for playlist ${playlist.id}: ${profileResult.error.message}`,
						{ cause: profileResult.error },
					);
				}

				return {
					status: "computed",
					playlist,
					profile: toMatchingProfile(playlist, profileResult.value),
				};
			} catch (error) {
				log.warn("match:playlist-profile-failed", {
					playlistId: playlist.id,
					error: errorMessage(error),
				});
				return { status: "failed", playlist, error };
			}
		},
	);

	const failures = profileResults.filter((r) => r.status === "failed");

	// All failing signals a systemic problem, not a per-playlist quirk — abort and
	// retry for fresh profiles rather than publish on stale ones.
	if (failures.length === playlists.length) {
		throw new Error(
			`[target-refresh] All ${playlists.length} target playlist profiles failed to compute`,
			{ cause: failures[0]?.error },
		);
	}

	const profiles: MatchingPlaylistProfile[] = [];
	for (const outcome of profileResults) {
		if (outcome.status === "computed") {
			profiles.push(outcome.profile);
			continue;
		}
		profiles.push(
			await carryForwardPriorProfile(
				accountId,
				outcome.playlist,
				outcome.error,
				profilingService,
			),
		);
	}

	return {
		playlists: profileResults.map((r) => r.playlist),
		profiles,
		carriedForwardCount: failures.length,
	};
}
