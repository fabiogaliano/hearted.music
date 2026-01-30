import type { SpotifyApi } from "@fostertheweb/spotify-web-sdk";
import { describe, expect, it, vi } from "vitest";
import {
	PLAYLISTS,
	SONGS,
	TEST_ACCOUNT,
	toSpotifyApiPlaylist,
	toSpotifyApiSavedTrack,
	toSpotifyPlaylistDTO,
} from "@/test/fixtures";
import { SpotifyService } from "./service";

describe("SpotifyService", () => {
	it("retries on rate-limited playlist fetches", async () => {
		const rateLimitError = {
			status: 429,
			headers: { get: () => "0" },
		};

		const apiPlaylist = toSpotifyApiPlaylist(
			PLAYLISTS.lofiCityPop,
			TEST_ACCOUNT.spotify_id,
		);

		const getUsersPlaylists = vi
			.fn()
			.mockRejectedValueOnce(rateLimitError)
			.mockResolvedValueOnce({ items: [apiPlaylist] });

		const sdk = {
			currentUser: {
				profile: vi.fn().mockResolvedValue({ id: TEST_ACCOUNT.spotify_id }),
			},
			playlists: {
				getUsersPlaylists,
			},
		} as unknown as SpotifyApi;

		const service = new SpotifyService(sdk);
		const result = await service.getPlaylists();

		expect(result).toHaveOkValue([
			toSpotifyPlaylistDTO(PLAYLISTS.lofiCityPop, TEST_ACCOUNT.spotify_id),
		]);
		expect(getUsersPlaylists).toHaveBeenCalledTimes(2);
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

		expect(result).toBeErr();
		expect(result).toHaveErrValue(
			expect.objectContaining({ _tag: "SpotifyRateLimitError" }),
		);
	});

	it("stops pagination when filtered items drop", async () => {
		const newTrack = toSpotifyApiSavedTrack(
			SONGS.fancy,
			"2024-02-01T00:00:00Z",
		);
		const oldTrack = toSpotifyApiSavedTrack(
			SONGS.goneBaby,
			"2023-01-01T00:00:00Z",
		);
		const items = [newTrack, oldTrack];

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

		expect(result).toHaveOkValue([newTrack]);
		expect(savedTracks).toHaveBeenCalledTimes(1);
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

		expect(result).toBeErr();
		expect(result).toHaveErrValue(
			expect.objectContaining({ _tag: "SpotifyAuthError" }),
		);
	});
});
