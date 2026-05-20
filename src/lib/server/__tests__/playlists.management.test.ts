import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import type { Song } from "@/lib/domains/library/songs/queries";
import { DatabaseError } from "@/lib/shared/errors/database";
import { PlaylistManagementChanges } from "@/lib/workflows/library-processing/changes/playlist-management";
import type { LibraryProcessingApplyOutcome } from "@/lib/workflows/library-processing/types";
import {
	flushPlaylistManagementSession,
	getPlaylistManagementData,
	getPlaylistTrackPreview,
	setPlaylistTargetMutation,
} from "../playlists.functions";

const {
	mockAuthContext,
	mockGetPlaylists,
	mockGetTargetPlaylists,
	mockGetPlaylistById,
	mockGetPlaylistSongs,
	mockGetSongsByIds,
	mockSetPlaylistTarget,
	mockApplyLibraryProcessingChange,
} = vi.hoisted(() => ({
	mockAuthContext: {
		session: { accountId: "acct-1" },
		account: null,
	},
	mockGetPlaylists: vi.fn(),
	mockGetTargetPlaylists: vi.fn(),
	mockGetPlaylistById: vi.fn(),
	mockGetPlaylistSongs: vi.fn(),
	mockGetSongsByIds: vi.fn(),
	mockSetPlaylistTarget: vi.fn(),
	mockApplyLibraryProcessingChange: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => {
	const builder = (): Record<string, unknown> => ({
		middleware: () => builder(),
		inputValidator: () => builder(),
		handler:
			(
				fn: (args: {
					context: typeof mockAuthContext;
					data: unknown;
				}) => unknown,
			) =>
			(input?: { data?: unknown }) =>
				fn({ context: mockAuthContext, data: input?.data }),
	});
	return {
		createServerFn: builder,
		createMiddleware: () => ({
			server: () => ({}),
			type: () => ({ server: () => ({}) }),
		}),
	};
});

vi.mock("@/lib/domains/library/playlists/queries", () => ({
	upsertPlaylists: vi.fn(),
	getPlaylists: (...args: unknown[]) => mockGetPlaylists(...args),
	getTargetPlaylists: (...args: unknown[]) => mockGetTargetPlaylists(...args),
	getPlaylistById: (...args: unknown[]) => mockGetPlaylistById(...args),
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

function makeApplyOutcome(): LibraryProcessingApplyOutcome {
	return {
		accountId: "acct-1",
		changeKind: "playlist_management_session_flushed",
		state: {
			accountId: "acct-1",
			enrichment: { requestedAt: null, settledAt: null, activeJobId: null },
			matchSnapshotRefresh: {
				requestedAt: null,
				settledAt: null,
				activeJobId: null,
			},
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		},
		effects: [],
		effectResults: [],
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
		artists: ["Artist A"],
		artist_ids: ["art-1"],
		duration_ms: 200000,
		genres: [],
		created_at: "2026-03-28T00:00:00Z",
		updated_at: "2026-03-28T00:00:00Z",
		...overrides,
	};
}

describe("getPlaylistManagementData", () => {
	beforeEach(() => {
		vi.clearAllMocks();
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
		mockGetPlaylistById.mockResolvedValue(
			Result.ok(makePlaylist({ account_id: "acct-1" })),
		);
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

	it("filters out songs missing from song table while keeping matched rows", async () => {
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
				{
					id: "ps-2",
					playlist_id: "uuid-1",
					song_id: "song-missing",
					position: 1,
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
		expect(result[0].songId).toBe("song-1");
	});

	it("throws sanitized error when playlist lookup fails", async () => {
		mockGetPlaylistById.mockResolvedValue(
			Result.err(new DatabaseError({ code: "42000", message: "db boom" })),
		);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		await expect(
			getPlaylistTrackPreview({ data: { playlistId: "uuid-1" } }),
		).rejects.toThrow("Failed to load playlist");

		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it("throws 'Playlist not found' when playlist is missing", async () => {
		mockGetPlaylistById.mockResolvedValue(Result.ok(null));

		await expect(
			getPlaylistTrackPreview({ data: { playlistId: "uuid-1" } }),
		).rejects.toThrow("Playlist not found");
	});

	it("throws 'Playlist not found' when playlist belongs to another account", async () => {
		mockGetPlaylistById.mockResolvedValue(
			Result.ok(makePlaylist({ account_id: "acct-other" })),
		);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		await expect(
			getPlaylistTrackPreview({ data: { playlistId: "uuid-1" } }),
		).rejects.toThrow("Playlist not found");

		expect(warnSpy).toHaveBeenCalledWith(
			"Playlist access denied: account mismatch",
			expect.objectContaining({
				playlistId: "uuid-1",
				ownerAccountId: "acct-other",
				sessionAccountId: "acct-1",
			}),
		);
		warnSpy.mockRestore();
	});

	it("throws sanitized error when playlist-song query fails", async () => {
		mockGetPlaylistSongs.mockResolvedValue(
			Result.err(new DatabaseError({ code: "42000", message: "db boom" })),
		);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		await expect(
			getPlaylistTrackPreview({ data: { playlistId: "uuid-1" } }),
		).rejects.toThrow("Failed to load playlist tracks");

		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it("throws sanitized error when song details query fails", async () => {
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
			Result.err(new DatabaseError({ code: "42000", message: "db boom" })),
		);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		await expect(
			getPlaylistTrackPreview({ data: { playlistId: "uuid-1" } }),
		).rejects.toThrow("Failed to load track details");

		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});

describe("setPlaylistTargetMutation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetPlaylistById.mockResolvedValue(
			Result.ok(makePlaylist({ account_id: "acct-1" })),
		);
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
		mockApplyLibraryProcessingChange.mockResolvedValue(
			Result.ok(makeApplyOutcome()),
		);
	});

	it("calls applyLibraryProcessingChange when targets changed", async () => {
		const result = await flushPlaylistManagementSession({
			data: { targetMembershipChanged: true, targetMetadataChanged: false },
		});

		expect(result.flushed).toBe(true);
		expect(mockApplyLibraryProcessingChange).toHaveBeenCalledWith(
			PlaylistManagementChanges.sessionFlushed({
				accountId: "acct-1",
				targetMembershipChanged: true,
				targetMetadataChanged: false,
			}),
		);
	});

	it("emits the same shape as the PlaylistManagementChanges factory", async () => {
		await flushPlaylistManagementSession({
			data: { targetMembershipChanged: true, targetMetadataChanged: true },
		});

		const emitted = mockApplyLibraryProcessingChange.mock.calls[0][0];
		const fromFactory = PlaylistManagementChanges.sessionFlushed({
			accountId: "acct-1",
			targetMembershipChanged: true,
			targetMetadataChanged: true,
		});

		expect(emitted).toEqual(fromFactory);
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
