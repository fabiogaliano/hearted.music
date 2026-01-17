/**
 * SpotifyService - High-level Spotify API operations with Result-based error handling.
 *
 * Wraps the Spotify SDK with:
 * - Rate limit handling (429 + Retry-After)
 * - Automatic pagination for multi-page endpoints
 * - Composable Result types instead of throwing
 */

import { Result } from "better-result";
import type { Market, MaxInt, SpotifyApi } from "@fostertheweb/spotify-web-sdk";
import type { SpotifyError } from "@/lib/errors/spotify";
import { fetchWithRetry } from "./request";
import { fetchAllPages } from "./pagination";

/** Spotify track from saved tracks endpoint */
export interface SpotifyTrackDTO {
	added_at: string;
	track: {
		id: string;
		name: string;
		artists: Array<{ id: string; name: string }>;
		album: {
			id: string;
			name: string;
			images: Array<{ url: string; width: number; height: number }>;
		};
		duration_ms: number;
		uri: string;
	};
}

/** Spotify playlist summary */
export interface SpotifyPlaylistDTO {
	id: string;
	name: string;
	description: string | null;
	owner: { id: string };
	track_count: number;
}

export class SpotifyService {
	private sdk: SpotifyApi;

	constructor(sdk: SpotifyApi) {
		this.sdk = sdk;
	}

	/**
	 * Gets the current user's liked/saved tracks.
	 * @param since - Optional ISO date string; only returns tracks added after this date
	 */
	getLikedTracks(
		since?: string | null,
	): Promise<Result<SpotifyTrackDTO[], SpotifyError>> {
		const sinceDate = since ? new Date(since) : null;

		return fetchAllPages<SpotifyTrackDTO>({
			fetchPage: (limit, offset) =>
				this.sdk.currentUser.tracks.savedTracks(
					limit,
					offset,
				) as Promise<{ items: SpotifyTrackDTO[] }>,
			limit: 50,
			filterFn: sinceDate
				? (track) => new Date(track.added_at) > sinceDate
				: undefined,
			shouldStopEarly: sinceDate
				? (originalItems, filteredItems) =>
						filteredItems.length < originalItems.length
				: undefined,
		});
	}

	/**
	 * Gets all playlists owned by the current user.
	 */
	async getPlaylists(): Promise<Result<SpotifyPlaylistDTO[], SpotifyError>> {
		return Result.gen(async function* (this: SpotifyService) {
			const currentUser = yield* Result.await(
				fetchWithRetry(() => this.sdk.currentUser.profile()),
			);

			const LIMIT: MaxInt<50> = 50;
			let offset = 0;
			const allPlaylists: SpotifyPlaylistDTO[] = [];
			let shouldContinue = true;

			while (shouldContinue) {
				const playlists = yield* Result.await(
					fetchWithRetry(() =>
						this.sdk.playlists.getUsersPlaylists(currentUser.id, LIMIT, offset),
					),
				);

				const filteredPlaylists = playlists.items
					.filter((p) => p.owner.id === currentUser.id)
					.map(
						(p) =>
							({
								id: p.id,
								name: p.name,
								description: p.description,
								owner: { id: p.owner.id },
								track_count: p.tracks?.total ?? 0,
							}) satisfies SpotifyPlaylistDTO,
					);

				allPlaylists.push(...filteredPlaylists);

				if (playlists.items.length < LIMIT) {
					shouldContinue = false;
				}
				offset += LIMIT;
			}

			return Result.ok(allPlaylists);
		}.bind(this));
	}

	/**
	 * Gets all tracks from a playlist.
	 */
	async getPlaylistTracks(
		playlistId: string,
	): Promise<Result<SpotifyTrackDTO[], SpotifyError>> {
		return Result.gen(async function* (this: SpotifyService) {
			const profile = yield* Result.await(
				fetchWithRetry(() => this.sdk.currentUser.profile()),
			);
			const market = profile.country as Market;

			const LIMIT: MaxInt<50> = 50;
			let offset = 0;
			const allTracks: SpotifyTrackDTO[] = [];
			let shouldContinue = true;

			while (shouldContinue) {
				const response = yield* Result.await(
					fetchWithRetry(() =>
						this.sdk.playlists.getPlaylistItems(
							playlistId,
							market,
							"",
							LIMIT,
							offset,
						),
					),
				);

				allTracks.push(...(response.items as SpotifyTrackDTO[]));

				if (response.items.length < LIMIT) {
					shouldContinue = false;
				}
				offset += LIMIT;
			}

			return Result.ok(allTracks);
		}.bind(this));
	}

	/**
	 * Creates a new playlist for the current user.
	 */
	async createPlaylist(
		name: string,
		description: string,
	): Promise<Result<{ id: string; name: string }, SpotifyError>> {
		return Result.gen(async function* (this: SpotifyService) {
			const currentUser = yield* Result.await(
				fetchWithRetry(() => this.sdk.currentUser.profile()),
			);

			const playlist = yield* Result.await(
				fetchWithRetry(() =>
					this.sdk.playlists.createPlaylist(currentUser.id, {
						name,
						description,
						public: false,
					}),
				),
			);

			return Result.ok({ id: playlist.id, name: playlist.name });
		}.bind(this));
	}

	/**
	 * Updates a playlist's name and/or description.
	 */
	async updatePlaylist(
		playlistId: string,
		name: string,
		description: string,
	): Promise<Result<void, SpotifyError>> {
		return Result.gen(async function* (this: SpotifyService) {
			yield* Result.await(
				fetchWithRetry(() =>
					this.sdk.playlists.changePlaylistDetails(playlistId, {
						name,
						description,
					}),
				),
			);

			return Result.ok(undefined);
		}.bind(this));
	}

	/**
	 * Gets album art URLs for multiple tracks.
	 * Returns a map of trackId -> album art URL (largest available).
	 */
	async getTracksAlbumArt(
		trackIds: string[],
	): Promise<Result<Map<string, string>, SpotifyError>> {
		return Result.gen(async function* (this: SpotifyService) {
			const result = new Map<string, string>();
			const chunks = chunkArray(trackIds, 50);

			for (const chunk of chunks) {
				const tracks = yield* Result.await(
					fetchWithRetry(() => this.sdk.tracks.get(chunk)),
				);

				for (const track of tracks) {
					if (track.album?.images?.length > 0) {
						result.set(track.id, track.album.images[0].url);
					}
				}
			}

			return Result.ok(result);
		}.bind(this));
	}

	/**
	 * Gets artist images for multiple artists.
	 * Returns a map of artistId -> image URL (largest available).
	 */
	async getArtistsImages(
		artistIds: string[],
	): Promise<Result<Map<string, string>, SpotifyError>> {
		if (artistIds.length === 0) {
			return Result.ok(new Map());
		}

		return Result.gen(async function* (this: SpotifyService) {
			const result = new Map<string, string>();
			const chunks = chunkArray(artistIds, 50);

			for (const chunk of chunks) {
				const artists = yield* Result.await(
					fetchWithRetry(() => this.sdk.artists.get(chunk)),
				);

				for (const artist of artists) {
					if (artist.images?.length > 0) {
						result.set(artist.id, artist.images[0].url);
					}
				}
			}

			return Result.ok(result);
		}.bind(this));
	}

	/**
	 * Gets the cover image URL for a playlist.
	 */
	async getPlaylistImage(
		playlistId: string,
	): Promise<Result<string | null, SpotifyError>> {
		return Result.gen(async function* (this: SpotifyService) {
			const playlist = yield* Result.await(
				fetchWithRetry(() =>
					this.sdk.playlists.getPlaylist(playlistId, undefined),
				),
			);

			if (playlist.images && playlist.images.length > 0) {
				return Result.ok(playlist.images[0].url);
			}

			return Result.ok(null);
		}.bind(this));
	}
}

function chunkArray<T>(array: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < array.length; i += size) {
		chunks.push(array.slice(i, i + size));
	}
	return chunks;
}
