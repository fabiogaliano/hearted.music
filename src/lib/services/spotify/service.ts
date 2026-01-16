/**
 * SpotifyService - High-level Spotify API operations with retry and pagination.
 *
 * Wraps the Spotify SDK with:
 * - Rate limit handling (429 + Retry-After)
 * - Automatic pagination for multi-page endpoints
 * - Configurable retry behavior
 */

import type { Market, MaxInt, SpotifyApi } from "@fostertheweb/spotify-web-sdk";

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

/** Options for retry behavior */
interface RetryOptions {
	maxRetries?: number;
	isRetryable?: (error: unknown) => boolean;
	getDelayMs?: (error: unknown, attempt: number) => number;
}

/** Options for paginated fetch */
interface PaginationOptions<T> {
	fetchFn: (limit: MaxInt<50>, offset: number) => Promise<{ items: T[] }>;
	limit: MaxInt<50>;
	filterFn?: (item: T) => boolean;
	shouldStopEarly?: (originalItems: T[], filteredItems: T[]) => boolean;
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
	async getLikedTracks(since?: string | null): Promise<SpotifyTrackDTO[]> {
		const allTracks = await this.fetchPaginatedData({
			fetchFn: (limit, offset) =>
				this.sdk.currentUser.tracks.savedTracks(limit, offset),
			limit: 50,
			filterFn: since
				? (track) => new Date(track.added_at) > new Date(since)
				: undefined,
			shouldStopEarly: since
				? (originalItems, filteredItems) =>
						filteredItems.length < originalItems.length
				: undefined,
		});

		return allTracks as SpotifyTrackDTO[];
	}

	/**
	 * Gets all playlists owned by the current user.
	 */
	async getPlaylists(): Promise<SpotifyPlaylistDTO[]> {
		const LIMIT: MaxInt<50> = 50;
		let offset = 0;
		const allPlaylists: SpotifyPlaylistDTO[] = [];
		let shouldContinue = true;

		const currentUser = await this.fetchWithRetry(() =>
			this.sdk.currentUser.profile(),
		);

		while (shouldContinue) {
			const playlists = await this.fetchWithRetry(() =>
				this.sdk.playlists.getUsersPlaylists(currentUser.id, LIMIT, offset),
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

		return allPlaylists;
	}

	/**
	 * Gets all tracks from a playlist.
	 */
	async getPlaylistTracks(playlistId: string): Promise<SpotifyTrackDTO[]> {
		const LIMIT: MaxInt<50> = 50;
		let offset = 0;
		const allTracks: SpotifyTrackDTO[] = [];
		let shouldContinue = true;

		const market = (await this.sdk.currentUser.profile()).country as Market;

		while (shouldContinue) {
			const response = await this.fetchWithRetry(() =>
				this.sdk.playlists.getPlaylistItems(
					playlistId,
					market,
					"",
					LIMIT,
					offset,
				),
			);

			allTracks.push(...(response.items as SpotifyTrackDTO[]));

			if (response.items.length < LIMIT) {
				shouldContinue = false;
			}

			offset += LIMIT;
		}

		return allTracks;
	}

	/**
	 * Creates a new playlist for the current user.
	 */
	async createPlaylist(
		name: string,
		description: string,
	): Promise<{ id: string; name: string }> {
		const currentUser = await this.fetchWithRetry(() =>
			this.sdk.currentUser.profile(),
		);

		const playlist = await this.fetchWithRetry(() =>
			this.sdk.playlists.createPlaylist(currentUser.id, {
				name,
				description,
				public: false,
			}),
		);

		return { id: playlist.id, name: playlist.name };
	}

	/**
	 * Updates a playlist's name and/or description.
	 */
	async updatePlaylist(
		playlistId: string,
		name: string,
		description: string,
	): Promise<void> {
		await this.fetchWithRetry(() =>
			this.sdk.playlists.changePlaylistDetails(playlistId, {
				name,
				description,
			}),
		);
	}

	/**
	 * Gets album art URLs for multiple tracks.
	 * Returns a map of trackId -> album art URL (largest available).
	 */
	async getTracksAlbumArt(trackIds: string[]): Promise<Map<string, string>> {
		const result = new Map<string, string>();

		// Spotify allows up to 50 tracks per request
		const chunks = this.chunkArray(trackIds, 50);

		for (const chunk of chunks) {
			const tracks = await this.fetchWithRetry(() =>
				this.sdk.tracks.get(chunk),
			);

			for (const track of tracks) {
				if (track.album?.images?.length > 0) {
					result.set(track.id, track.album.images[0].url);
				}
			}
		}

		return result;
	}

	/**
	 * Gets artist images for multiple artists.
	 * Returns a map of artistId -> image URL (largest available).
	 */
	async getArtistsImages(artistIds: string[]): Promise<Map<string, string>> {
		const result = new Map<string, string>();
		if (artistIds.length === 0) return result;

		const chunks = this.chunkArray(artistIds, 50);

		for (const chunk of chunks) {
			const artists = await this.fetchWithRetry(() =>
				this.sdk.artists.get(chunk),
			);

			for (const artist of artists) {
				if (artist.images?.length > 0) {
					result.set(artist.id, artist.images[0].url);
				}
			}
		}

		return result;
	}

	/**
	 * Gets the cover image URL for a playlist.
	 */
	async getPlaylistImage(playlistId: string): Promise<string | null> {
		const playlist = await this.fetchWithRetry(() =>
			this.sdk.playlists.getPlaylist(playlistId, undefined),
		);

		if (playlist.images && playlist.images.length > 0) {
			return playlist.images[0].url;
		}

		return null;
	}

	/**
	 * Fetches paginated data with configurable filtering and stop conditions.
	 */
	private async fetchPaginatedData<T>({
		fetchFn,
		limit,
		filterFn,
		shouldStopEarly,
	}: PaginationOptions<T>): Promise<T[]> {
		const allItems: T[] = [];
		let offset = 0;
		let shouldContinue = true;

		while (shouldContinue) {
			const response = await this.fetchWithRetry(() => fetchFn(limit, offset));
			const originalItems = response.items;

			const filteredItems = filterFn
				? originalItems.filter(filterFn)
				: originalItems;
			allItems.push(...filteredItems);

			if (shouldStopEarly?.(originalItems, filteredItems)) {
				shouldContinue = false;
			} else if (originalItems.length < limit) {
				shouldContinue = false;
			}

			offset += limit;
		}

		return allItems;
	}

	/**
	 * Executes a function with automatic retry on rate limits.
	 * Handles HTTP 429 with Retry-After header.
	 */
	private async fetchWithRetry<T>(
		fetchFunction: () => Promise<T>,
		options: RetryOptions = {},
	): Promise<T> {
		const {
			maxRetries = 3,
			isRetryable = (error) =>
				typeof error === "object" &&
				error !== null &&
				"status" in error &&
				(error as { status: number }).status === 429,
			getDelayMs = (error) => {
				if (typeof error === "object" && error !== null && "headers" in error) {
					const headers = (
						error as { headers?: { get?: (key: string) => string | null } }
					).headers;
					const retryAfter = headers?.get?.("Retry-After");
					if (retryAfter) {
						return Number.parseInt(retryAfter, 10) * 1000;
					}
				}
				return 1000; // Default 1 second
			},
		} = options;

		let attempt = 0;

		while (attempt <= maxRetries) {
			try {
				return await fetchFunction();
			} catch (error) {
				if (isRetryable(error) && attempt < maxRetries) {
					await this.sleep(getDelayMs(error, attempt));
					attempt++;
				} else {
					throw error;
				}
			}
		}

		throw new Error(`Maximum retry attempts (${maxRetries}) reached`);
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	private chunkArray<T>(array: T[], size: number): T[][] {
		const chunks: T[][] = [];
		for (let i = 0; i < array.length; i += size) {
			chunks.push(array.slice(i, i + size));
		}
		return chunks;
	}
}
