import type { SpotifyApi } from "@fostertheweb/spotify-web-sdk";
import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";
import { SpotifyService } from "./service";

describe("SpotifyService", () => {
	it("retries on rate-limited playlist fetches", async () => {
		const rateLimitError = {
			status: 429,
			headers: { get: () => "0" },
		};

		const getUsersPlaylists = vi
			.fn()
			.mockRejectedValueOnce(rateLimitError)
			.mockResolvedValueOnce({
				items: [
					{
						id: "playlist-1",
						name: "Daily Mix",
						description: null,
						owner: { id: "user-1" },
						tracks: { total: 12 },
					},
				],
			});

		const sdk = {
			currentUser: {
				profile: vi.fn().mockResolvedValue({ id: "user-1" }),
			},
			playlists: {
				getUsersPlaylists,
			},
		} as unknown as SpotifyApi;

		const service = new SpotifyService(sdk);
		const result = await service.getPlaylists();

		expect(Result.isOk(result)).toBe(true);
		expect(getUsersPlaylists).toHaveBeenCalledTimes(2);

		if (Result.isOk(result)) {
			expect(result.value).toEqual([
				{
					id: "playlist-1",
					name: "Daily Mix",
					description: null,
					owner: { id: "user-1" },
					track_count: 12,
				},
			]);
		}
	});

	it("returns error after max retries exceeded", async () => {
		const rateLimitError = {
			status: 429,
			headers: { get: () => "0" },
		};

		const getUsersPlaylists = vi.fn().mockRejectedValue(rateLimitError);

		const sdk = {
			currentUser: {
				profile: vi.fn().mockResolvedValue({ id: "user-1" }),
			},
			playlists: {
				getUsersPlaylists,
			},
		} as unknown as SpotifyApi;

		const service = new SpotifyService(sdk);
		const result = await service.getPlaylists();

		expect(Result.isError(result)).toBe(true);
		if (Result.isError(result)) {
			expect(result.error._tag).toBe("SpotifyRateLimitError");
		}
	});

	it("stops pagination when filtered items drop", async () => {
		const items = [
			{
				added_at: "2024-02-01T00:00:00Z",
				track: {
					id: "track-1",
					name: "New Track",
					artists: [{ id: "artist-1", name: "Artist" }],
					album: {
						id: "album-1",
						name: "Album",
						images: [
							{ url: "https://example.com/cover.jpg", width: 300, height: 300 },
						],
					},
					duration_ms: 123000,
					uri: "spotify:track:track-1",
				},
			},
			{
				added_at: "2023-01-01T00:00:00Z",
				track: {
					id: "track-2",
					name: "Old Track",
					artists: [{ id: "artist-2", name: "Legacy" }],
					album: {
						id: "album-2",
						name: "Older Album",
						images: [
							{ url: "https://example.com/old.jpg", width: 300, height: 300 },
						],
					},
					duration_ms: 222000,
					uri: "spotify:track:track-2",
				},
			},
		];

		const savedTracks = vi.fn().mockResolvedValue({ items });

		const sdk = {
			currentUser: {
				tracks: {
					savedTracks,
				},
			},
		} as unknown as SpotifyApi;

		const service = new SpotifyService(sdk);
		const result = await service.getLikedTracks("2024-01-01T00:00:00Z");

		expect(Result.isOk(result)).toBe(true);
		expect(savedTracks).toHaveBeenCalledTimes(1);

		if (Result.isOk(result)) {
			expect(result.value).toEqual([items[0]]);
		}
	});

	it("returns auth error for 401 response", async () => {
		const authError = { status: 401 };

		const sdk = {
			currentUser: {
				profile: vi.fn().mockRejectedValue(authError),
			},
			playlists: {
				getUsersPlaylists: vi.fn(),
			},
		} as unknown as SpotifyApi;

		const service = new SpotifyService(sdk);
		const result = await service.getPlaylists();

		expect(Result.isError(result)).toBe(true);
		if (Result.isError(result)) {
			expect(result.error._tag).toBe("SpotifyAuthError");
		}
	});
});
