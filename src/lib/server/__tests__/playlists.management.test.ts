import { beforeEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import type { Song } from "@/lib/domains/library/songs/queries";
import { DatabaseError } from "@/lib/shared/errors/database";

const mockRequireAuthSession = vi.fn();
const mockGetPlaylists = vi.fn();
const mockGetTargetPlaylists = vi.fn();
const mockGetPlaylistSongs = vi.fn();
const mockGetSongsByIds = vi.fn();
const mockSetPlaylistTarget = vi.fn();
const mockApplyLibraryProcessingChange = vi.fn();

vi.mock("@tanstack/react-start", () => {
	const builder = (): Record<string, unknown> => ({
		middleware: () => builder(),
		inputValidator: () => builder(),
		handler: <T>(fn: T) => fn,
	});
	return { createServerFn: builder };
});

vi.mock("@/lib/platform/auth/auth.server", () => ({
	requireAuthSession: (...args: unknown[]) => mockRequireAuthSession(...args),
}));

vi.mock("@/lib/domains/library/playlists/queries", () => ({
	upsertPlaylists: vi.fn(),
	getPlaylists: (...args: unknown[]) => mockGetPlaylists(...args),
	getTargetPlaylists: (...args: unknown[]) => mockGetTargetPlaylists(...args),
	getPlaylistBySpotifyId: vi.fn(),
	getPlaylistSongs: (...args: unknown[]) => mockGetPlaylistSongs(...args),
	deletePlaylist: vi.fn(),
	setPlaylistTarget: (...args: unknown[]) => mockSetPlaylistTarget(...args),
	updatePlaylistMetadata: vi.fn(),
}));

vi.mock("@/lib/domains/library/songs/queries", () => ({
	getByIds: (...args: unknown[]) => mockGetSongsByIds(...args),
}));

vi.mock("@/lib/workflows/library-processing/service", () => ({
	applyLibraryProcessingChange: (...args: unknown[]) =>
		mockApplyLibraryProcessingChange(...args),
}));

const {
	getPlaylistManagementData,
	getPlaylistTrackPreview,
	setPlaylistTargetMutation,
	flushPlaylistManagementSession,
} = await import("../playlists.functions");

function makePlaylist(overrides: Partial<Playlist> = {}): Playlist {
	return {
		id: "uuid-1",
		account_id: "acct-1",
		spotify_id: "abc123",
		name: "Test Playlist",
		description: null,
		snapshot_id: null,
		is_public: true,
		song_count: 0,
		is_target: false,
		image_url: null,
		created_at: "2026-03-28T00:00:00Z",
		updated_at: "2026-03-28T00:00:00Z",
		...overrides,
	};
}

function makeSong(overrides: Partial<Song> = {}): Song {
	return {
		id: "song-1",
		spotify_id: "sp-song-1",
		name: "Test Song",
		album_id: null,
		album_name: "Test Album",
		image_url: null,
		isrc: null,
		artists: ["Artist A"],
		artist_ids: ["art-1"],
		duration_ms: 200000,
		genres: [],
		popularity: null,
		preview_url: null,
		created_at: "2026-03-28T00:00:00Z",
		updated_at: "2026-03-28T00:00:00Z",
		...overrides,
	};
}

describe("getPlaylistManagementData", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRequireAuthSession.mockResolvedValue({
			session: { accountId: "acct-1" },
		});
	});

	it("returns playlists and target IDs", async () => {
		const p1 = makePlaylist({ id: "uuid-1", is_target: true });
		const p2 = makePlaylist({ id: "uuid-2", is_target: false });
		mockGetPlaylists.mockResolvedValue(Result.ok([p1, p2]));
		mockGetTargetPlaylists.mockResolvedValue(Result.ok([p1]));

		const result = await getPlaylistManagementData();

		expect(result.playlists).toHaveLength(2);
		expect(result.targetPlaylistIds).toEqual(["uuid-1"]);
	});

	it("returns empty for account with no playlists", async () => {
		mockGetPlaylists.mockResolvedValue(Result.ok([]));
		mockGetTargetPlaylists.mockResolvedValue(Result.ok([]));

		const result = await getPlaylistManagementData();

		expect(result.playlists).toHaveLength(0);
		expect(result.targetPlaylistIds).toHaveLength(0);
	});

	it("throws when playlist fetch fails", async () => {
		mockGetPlaylists.mockResolvedValue(
			Result.err(new DatabaseError({ code: "42000", message: "db error" })),
		);
		mockGetTargetPlaylists.mockResolvedValue(Result.ok([]));

		await expect(getPlaylistManagementData()).rejects.toThrow(
			"Failed to load playlists",
		);
	});
});

describe("getPlaylistTrackPreview", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRequireAuthSession.mockResolvedValue({
			session: { accountId: "acct-1" },
		});
	});

	it("joins playlist songs with song data", async () => {
		mockGetPlaylistSongs.mockResolvedValue(
			Result.ok([
				{
					id: "ps-1",
					playlist_id: "uuid-1",
					song_id: "song-1",
					position: 0,
					added_at: "2026-03-28T00:00:00Z",
					created_at: "2026-03-28T00:00:00Z",
				},
			]),
		);
		mockGetSongsByIds.mockResolvedValue(
			Result.ok([makeSong({ id: "song-1" })]),
		);

		const result = await getPlaylistTrackPreview({
			data: { playlistId: "uuid-1" },
		});

		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("Test Song");
		expect(result[0].artists).toEqual(["Artist A"]);
		expect(result[0].position).toBe(0);
	});

	it("returns empty for playlist with no tracks", async () => {
		mockGetPlaylistSongs.mockResolvedValue(Result.ok([]));

		const result = await getPlaylistTrackPreview({
			data: { playlistId: "uuid-1" },
		});

		expect(result).toHaveLength(0);
	});

	it("filters out songs missing from song table", async () => {
		mockGetPlaylistSongs.mockResolvedValue(
			Result.ok([
				{
					id: "ps-1",
					playlist_id: "uuid-1",
					song_id: "song-missing",
					position: 0,
					added_at: "2026-03-28T00:00:00Z",
					created_at: "2026-03-28T00:00:00Z",
				},
			]),
		);
		mockGetSongsByIds.mockResolvedValue(Result.ok([]));

		const result = await getPlaylistTrackPreview({
			data: { playlistId: "uuid-1" },
		});

		expect(result).toHaveLength(0);
	});
});

describe("setPlaylistTargetMutation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRequireAuthSession.mockResolvedValue({
			session: { accountId: "acct-1" },
		});
	});

	it("sets target flag via setPlaylistTarget", async () => {
		const updated = makePlaylist({ is_target: true });
		mockSetPlaylistTarget.mockResolvedValue(Result.ok(updated));

		const result = await setPlaylistTargetMutation({
			data: { playlistId: "uuid-1", isTarget: true },
		});

		expect(result.success).toBe(true);
		expect(mockSetPlaylistTarget).toHaveBeenCalledWith("uuid-1", true);
	});

	it("throws when setPlaylistTarget fails", async () => {
		mockSetPlaylistTarget.mockResolvedValue(
			Result.err(new DatabaseError({ code: "42000", message: "db error" })),
		);

		await expect(
			setPlaylistTargetMutation({
				data: { playlistId: "uuid-1", isTarget: true },
			}),
		).rejects.toThrow("Failed to set playlist target");
	});
});

describe("flushPlaylistManagementSession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRequireAuthSession.mockResolvedValue({
			session: { accountId: "acct-1" },
		});
		mockApplyLibraryProcessingChange.mockResolvedValue(undefined);
	});

	it("calls applyLibraryProcessingChange when targets changed", async () => {
		const result = await flushPlaylistManagementSession({
			data: { targetMembershipChanged: true, targetMetadataChanged: false },
		});

		expect(result.flushed).toBe(true);
		expect(mockApplyLibraryProcessingChange).toHaveBeenCalledWith({
			kind: "playlist_management_session_flushed",
			accountId: "acct-1",
			targetMembershipChanged: true,
			targetMetadataChanged: false,
		});
	});

	it("skips processing when nothing changed", async () => {
		const result = await flushPlaylistManagementSession({
			data: {
				targetMembershipChanged: false,
				targetMetadataChanged: false,
			},
		});

		expect(result.flushed).toBe(false);
		expect(mockApplyLibraryProcessingChange).not.toHaveBeenCalled();
	});
});
