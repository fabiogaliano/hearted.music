import { beforeEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import type { SpotifyPlaylistDTO } from "../types";

const mockGetPlaylists = vi.fn();
const mockUpsertPlaylists = vi.fn();
const mockDeletePlaylist = vi.fn();

vi.mock("@/lib/domains/library/playlists/queries", () => ({
	getPlaylists: (...args: unknown[]) => mockGetPlaylists(...args),
	upsertPlaylists: (...args: unknown[]) => mockUpsertPlaylists(...args),
	deletePlaylist: (...args: unknown[]) => mockDeletePlaylist(...args),
}));

const { syncPlaylists } = await import("../playlist-sync");

function makePlaylist(overrides: Partial<Playlist> = {}): Playlist {
	return {
		account_id: "acct-1",
		created_at: "2026-03-27T00:00:00Z",
		description: "old description",
		id: "playlist-1",
		image_url: "https://img.example/old.jpg",
		is_public: true,
		is_target: true,
		name: "Old name",
		snapshot_id: null,
		song_count: 10,
		spotify_id: "spotify-playlist-1",
		updated_at: "2026-03-27T00:00:00Z",
		...overrides,
	};
}

function makeSpotifyPlaylist(
	overrides: Partial<SpotifyPlaylistDTO> = {},
): SpotifyPlaylistDTO {
	return {
		id: "spotify-playlist-1",
		name: "Old name",
		description: "old description",
		owner: { id: "owner-1" },
		track_count: 10,
		image_url: "https://img.example/old.jpg",
		...overrides,
	};
}

describe("syncPlaylists", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDeletePlaylist.mockResolvedValue(Result.ok(null));
		mockUpsertPlaylists.mockResolvedValue(Result.ok([]));
	});

	it("flags target playlist profile text changes for library-processing", async () => {
		mockGetPlaylists.mockResolvedValue(Result.ok([makePlaylist()]));

		const result = await syncPlaylists("acct-1", [
			makeSpotifyPlaylist({ name: "New name" }),
		]);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.updatedTargetMetadataPlaylistIds).toEqual([
				"playlist-1",
			]);
			expect(result.value.updatedTargetProfileTextPlaylistIds).toEqual([
				"playlist-1",
			]);
		}
	});

	it("upserts (not duplicates) an acknowledged provisional playlist row when sync sees it from Spotify", async () => {
		const acknowledgedRow = makePlaylist({
			spotify_id: "ack-new-1",
			name: "Created via ack",
			description: null,
			image_url: null,
			song_count: 0,
			is_target: false,
		});
		mockGetPlaylists.mockResolvedValue(Result.ok([acknowledgedRow]));

		const result = await syncPlaylists("acct-1", [
			makeSpotifyPlaylist({
				id: "ack-new-1",
				name: "Created via ack",
				description: "Full description from Spotify",
				image_url: "https://img.example/enriched.jpg",
				track_count: 5,
			}),
		]);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.created).toBe(0);
			expect(result.value.updated).toBe(1);
			expect(mockUpsertPlaylists).toHaveBeenCalledWith("acct-1", [
				expect.objectContaining({
					spotify_id: "ack-new-1",
					name: "Created via ack",
					description: "Full description from Spotify",
					image_url: "https://img.example/enriched.jpg",
					song_count: 5,
				}),
			]);
		}
	});

	it("does not recreate an acknowledged-deleted playlist absent from Spotify", async () => {
		mockGetPlaylists.mockResolvedValue(Result.ok([]));

		const result = await syncPlaylists("acct-1", []);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.created).toBe(0);
			expect(result.value.removed).toBe(0);
		}
		expect(mockUpsertPlaylists).not.toHaveBeenCalled();
		expect(mockDeletePlaylist).not.toHaveBeenCalled();
	});

	it("preserves is_target on acknowledged row during sync enrichment", async () => {
		const acknowledgedRow = makePlaylist({
			spotify_id: "ack-target-1",
			name: "Target Playlist",
			is_target: true,
			image_url: null,
			song_count: 0,
		});
		mockGetPlaylists.mockResolvedValue(Result.ok([acknowledgedRow]));

		await syncPlaylists("acct-1", [
			makeSpotifyPlaylist({
				id: "ack-target-1",
				name: "Target Playlist",
				image_url: "https://img.example/new.jpg",
				track_count: 12,
			}),
		]);

		expect(mockUpsertPlaylists).toHaveBeenCalledWith("acct-1", [
			expect.objectContaining({
				spotify_id: "ack-target-1",
				is_target: true,
			}),
		]);
	});

	it("does not flag image-only target updates as profile text changes", async () => {
		mockGetPlaylists.mockResolvedValue(Result.ok([makePlaylist()]));

		const result = await syncPlaylists("acct-1", [
			makeSpotifyPlaylist({ image_url: "https://img.example/new.jpg" }),
		]);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.updatedTargetMetadataPlaylistIds).toEqual([
				"playlist-1",
			]);
			expect(result.value.updatedTargetProfileTextPlaylistIds).toEqual([]);
		}
	});
});
