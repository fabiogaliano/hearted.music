import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	Playlist,
	PlaylistSong,
} from "@/lib/domains/library/playlists/queries";
import type { Song } from "@/lib/domains/library/songs/queries";
import type { SpotifyPlaylistDTO, SpotifyTrackDTO } from "../types";

const mockGetPlaylists = vi.fn();
const mockUpsertPlaylists = vi.fn();
const mockDeletePlaylists = vi.fn();
const mockGetPlaylistSongs = vi.fn();
const mockUpsertPlaylistSongs = vi.fn();
const mockRemovePlaylistSongs = vi.fn();
const mockUpdatePlaylistSongCount = vi.fn();

vi.mock("@/lib/domains/library/playlists/queries", () => ({
	getPlaylists: (...args: unknown[]) => mockGetPlaylists(...args),
	upsertPlaylists: (...args: unknown[]) => mockUpsertPlaylists(...args),
	deletePlaylists: (...args: unknown[]) => mockDeletePlaylists(...args),
	getPlaylistSongs: (...args: unknown[]) => mockGetPlaylistSongs(...args),
	upsertPlaylistSongs: (...args: unknown[]) => mockUpsertPlaylistSongs(...args),
	removePlaylistSongs: (...args: unknown[]) => mockRemovePlaylistSongs(...args),
	updatePlaylistSongCount: (...args: unknown[]) =>
		mockUpdatePlaylistSongCount(...args),
}));

const mockImportSpotifyTracks = vi.fn();

vi.mock("../sync-helpers", () => ({
	importSpotifyTracks: (...args: unknown[]) => mockImportSpotifyTracks(...args),
}));

vi.mock("../dedupe", () => ({
	dedupeTracksBySpotifyId: (tracks: unknown[]) => tracks,
}));

const { syncPlaylists, syncPlaylistTracksFromData } = await import(
	"../playlist-sync"
);

function makePlaylist(overrides: Partial<Playlist> = {}): Playlist {
	return {
		account_id: "acct-1",
		created_at: "2026-03-27T00:00:00Z",
		description: "old description",
		match_intent: null,
		match_filters: { version: 1 },
		id: "playlist-1",
		image_url: "https://img.example/old.jpg",
		is_public: true,
		is_target: true,
		name: "Old name",
		snapshot_id: null,
		song_count: 10,
		spotify_id: "spotify-playlist-1",
		genre_pills: [],
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
		mockDeletePlaylists.mockResolvedValue(Result.ok(null));
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
		expect(mockDeletePlaylists).not.toHaveBeenCalled();
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

	it("does not flag description-only target updates as profile text changes", async () => {
		// description no longer feeds matching (match_intent does) — a Spotify
		// description edit must not retrigger re-profiling, but the column still stores
		// the latest value from Spotify
		mockGetPlaylists.mockResolvedValue(Result.ok([makePlaylist()]));

		const result = await syncPlaylists("acct-1", [
			makeSpotifyPlaylist({ description: "new description from Spotify" }),
		]);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.updatedTargetMetadataPlaylistIds).toEqual([
				"playlist-1",
			]);
			expect(result.value.updatedTargetProfileTextPlaylistIds).toEqual([]);
		}
		expect(mockUpsertPlaylists).toHaveBeenCalledWith(
			"acct-1",
			expect.arrayContaining([
				expect.objectContaining({
					description: "new description from Spotify",
				}),
			]),
		);
	});
});

describe("syncPlaylistTracksFromData", () => {
	const PLAYLIST: Playlist = {
		id: "playlist-1",
		account_id: "acct-1",
		spotify_id: "sp-playlist-1",
		name: "Test Playlist",
		description: null,
		match_intent: null,
		match_filters: { version: 1 },
		is_public: true,
		is_target: false,
		song_count: 0,
		snapshot_id: null,
		image_url: null,
		genre_pills: [],
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
	};

	function makePS(songId: string, position = 0): PlaylistSong {
		return {
			id: `ps-${songId}`,
			playlist_id: "playlist-1",
			song_id: songId,
			position,
			added_at: "2026-01-01T00:00:00Z",
			created_at: "2026-01-01T00:00:00Z",
			updated_at: "2026-01-01T00:00:00Z",
		} as PlaylistSong;
	}

	function makeSongEntry(id: string, spotifyId: string): Song {
		return { id, spotify_id: spotifyId } as Song;
	}

	beforeEach(() => {
		vi.clearAllMocks();
		mockUpsertPlaylistSongs.mockResolvedValue(Result.ok([]));
		mockRemovePlaylistSongs.mockResolvedValue(Result.ok([]));
		mockUpdatePlaylistSongCount.mockResolvedValue(Result.ok(null));
	});

	it("removes an existing song whose id is absent from the current upserted batch", async () => {
		mockGetPlaylistSongs.mockResolvedValue(Result.ok([makePS("song-old")]));
		mockImportSpotifyTracks.mockResolvedValue(
			Result.ok(
				new Map([["spotify-new", makeSongEntry("song-new", "spotify-new")]]),
			),
		);

		const result = await syncPlaylistTracksFromData(PLAYLIST, []);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.removed).toBe(1);
			expect(result.value.removedTracks).toEqual([{ id: "song-old" }]);
		}
		expect(mockRemovePlaylistSongs).toHaveBeenCalledWith("playlist-1", [
			"song-old",
		]);
	});

	it("removes an existing song whose spotify_id is no longer in the current tracklist", async () => {
		// song-a IS found in songById but its spotify_id is not in spotifyTrackIds
		mockGetPlaylistSongs.mockResolvedValue(Result.ok([makePS("song-a")]));
		mockImportSpotifyTracks.mockResolvedValue(
			Result.ok(
				new Map([["current-key", makeSongEntry("song-a", "old-spotify")]]),
			),
		);
		// rawTracks is empty → spotifyTrackIds is empty → "old-spotify" is not in it

		const result = await syncPlaylistTracksFromData(PLAYLIST, []);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.removed).toBe(1);
		}
	});

	it("does not remove a song still present in the Spotify tracklist", async () => {
		mockGetPlaylistSongs.mockResolvedValue(Result.ok([makePS("song-a", 0)]));
		mockImportSpotifyTracks.mockResolvedValue(
			Result.ok(new Map([["spotify-a", makeSongEntry("song-a", "spotify-a")]])),
		);
		// rawTracks with track.id = "spotify-a" so spotifyTrackIds contains it
		const rawTracks = [
			{ added_at: "2026-01-01T00:00:00Z", track: { id: "spotify-a" } },
		] as SpotifyTrackDTO[];

		const result = await syncPlaylistTracksFromData(PLAYLIST, rawTracks);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.removed).toBe(0);
			expect(result.value.removedTracks).toEqual([]);
		}
		expect(mockRemovePlaylistSongs).not.toHaveBeenCalled();
	});
});
