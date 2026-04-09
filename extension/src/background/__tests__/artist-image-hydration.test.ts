import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpotifyTrackDTO } from "../../shared/types";

const mockQueryArtistOverview = vi.fn();
const mockSetSyncState = vi.fn();

vi.mock("../../shared/spotify-client/reads", () => ({
	queryArtistOverview: (...args: unknown[]) => mockQueryArtistOverview(...args),
}));

vi.mock("../../shared/storage", () => ({
	setSyncState: (...args: unknown[]) => mockSetSyncState(...args),
}));

const { fetchArtistImageUrls } = await import("../artist-image-hydration");

function makeTrack(
	artistOverrides: Array<{
		id: string;
		name: string;
		imageUrl?: string | null;
	}>,
): SpotifyTrackDTO {
	return {
		added_at: "2026-04-08T00:00:00.000Z",
		track: {
			id: "track-1",
			name: "Track 1",
			artists: artistOverrides,
			album: {
				id: "album-1",
				name: "Album 1",
				images: [],
			},
			duration_ms: 123,
			uri: "spotify:track:track-1",
		},
	};
}

describe("artist image hydration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSetSyncState.mockResolvedValue(undefined);
	});

	it("uses backend precheck results before Spotify hydration", async () => {
		mockQueryArtistOverview.mockResolvedValue({
			id: "artist-2",
			name: "Artist 2",
			avatarImages: [
				{ url: "https://img/2-small.jpg", width: 64, height: 64 },
				{ url: "https://img/2-large.jpg", width: 640, height: 640 },
			],
		});
		const postToBackend = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					artists: [{ spotify_id: "artist-1", image_url: "https://img/1.jpg" }],
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			),
		);

		const result = await fetchArtistImageUrls({
			token: "spotify-token",
			tracks: [
				makeTrack([
					{ id: "artist-1", name: "Artist 1", imageUrl: null },
					{ id: "artist-2", name: "Artist 2", imageUrl: null },
					{ id: "artist-3", name: "Artist 3", imageUrl: "https://img/3.jpg" },
				]),
			],
			postToBackend,
		});

		expect(postToBackend).toHaveBeenCalledWith("/api/extension/artists/check", {
			artistIds: ["artist-1", "artist-2"],
		});
		expect(mockQueryArtistOverview).toHaveBeenCalledTimes(1);
		expect(mockQueryArtistOverview).toHaveBeenCalledWith(
			"spotify-token",
			"spotify:artist:artist-2",
		);
		expect(result.get("artist-1")).toBe("https://img/1.jpg");
		expect(result.get("artist-2")).toBe("https://img/2-large.jpg");
		expect(result.get("artist-3")).toBe("https://img/3.jpg");
		expect(mockSetSyncState).toHaveBeenCalledWith({
			phase: "artistImages",
			fetched: 0,
			total: 1,
			artistImages: { fetched: 0, total: 1 },
		});
	});

	it("falls back to Spotify hydration when the backend precheck fails", async () => {
		mockQueryArtistOverview
			.mockResolvedValueOnce({
				id: "artist-1",
				name: "Artist 1",
				avatarImages: [{ url: "https://img/1.jpg", width: 320, height: 320 }],
			})
			.mockResolvedValueOnce({
				id: "artist-2",
				name: "Artist 2",
				avatarImages: [{ url: "https://img/2.jpg", width: 320, height: 320 }],
			});
		const postToBackend = vi
			.fn()
			.mockRejectedValue(new Error("backend unavailable"));

		const result = await fetchArtistImageUrls({
			token: "spotify-token",
			tracks: [
				makeTrack([
					{ id: "artist-1", name: "Artist 1", imageUrl: null },
					{ id: "artist-2", name: "Artist 2", imageUrl: null },
				]),
			],
			postToBackend,
		});

		expect(mockQueryArtistOverview).toHaveBeenCalledTimes(2);
		expect(result.get("artist-1")).toBe("https://img/1.jpg");
		expect(result.get("artist-2")).toBe("https://img/2.jpg");
		expect(mockSetSyncState).toHaveBeenCalledWith({
			phase: "artistImages",
			fetched: 0,
			total: 2,
			artistImages: { fetched: 0, total: 2 },
		});
	});
});
