import { beforeEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import { DatabaseError } from "@/lib/shared/errors/database";

const mockRequireAuthSession = vi.fn();
const mockUpsertPlaylists = vi.fn();
const mockGetPlaylistBySpotifyId = vi.fn();
const mockDeletePlaylist = vi.fn();
const mockUpdatePlaylistMetadata = vi.fn();

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
	upsertPlaylists: (...args: unknown[]) => mockUpsertPlaylists(...args),
	getPlaylists: vi.fn().mockResolvedValue({ ok: true, value: [] }),
	getTargetPlaylists: vi.fn().mockResolvedValue({ ok: true, value: [] }),
	getPlaylistBySpotifyId: (...args: unknown[]) =>
		mockGetPlaylistBySpotifyId(...args),
	getPlaylistSongs: vi.fn().mockResolvedValue({ ok: true, value: [] }),
	deletePlaylist: (...args: unknown[]) => mockDeletePlaylist(...args),
	setPlaylistTarget: vi.fn(),
	updatePlaylistMetadata: (...args: unknown[]) =>
		mockUpdatePlaylistMetadata(...args),
}));

vi.mock("@/lib/domains/library/songs/queries", () => ({
	getByIds: vi.fn().mockResolvedValue({ ok: true, value: [] }),
}));

vi.mock("@/lib/workflows/library-processing/service", () => ({
	applyLibraryProcessingChange: vi.fn(),
}));

const {
	acknowledgePlaylistCreate,
	acknowledgePlaylistUpdate,
	acknowledgePlaylistDelete,
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

describe("acknowledgePlaylistCreate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRequireAuthSession.mockResolvedValue({
			session: { accountId: "acct-1" },
		});
	});

	it("upserts a provisional playlist row from the create URI and name", async () => {
		mockUpsertPlaylists.mockResolvedValue(Result.ok([makePlaylist()]));

		const result = await acknowledgePlaylistCreate({
			data: { uri: "spotify:playlist:abc123", name: "My New Playlist" },
		});

		expect(result).toEqual({ success: true, spotifyId: "abc123" });
		expect(mockUpsertPlaylists).toHaveBeenCalledWith("acct-1", [
			{
				spotify_id: "abc123",
				name: "My New Playlist",
				description: null,
				snapshot_id: null,
				is_public: true,
				song_count: 0,
				is_target: false,
				image_url: null,
			},
		]);
	});

	it("throws when upsert fails", async () => {
		mockUpsertPlaylists.mockResolvedValue(
			Result.err(new DatabaseError({ code: "42000", message: "db error" })),
		);

		await expect(
			acknowledgePlaylistCreate({
				data: { uri: "spotify:playlist:abc123", name: "Test" },
			}),
		).rejects.toThrow("Failed to acknowledge playlist create");
	});
});

describe("acknowledgePlaylistUpdate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRequireAuthSession.mockResolvedValue({
			session: { accountId: "acct-1" },
		});
	});

	it("updates metadata for the account-scoped playlist", async () => {
		mockUpdatePlaylistMetadata.mockResolvedValue(
			Result.ok(makePlaylist({ name: "Renamed" })),
		);

		const result = await acknowledgePlaylistUpdate({
			data: { spotifyId: "abc123", name: "Renamed" },
		});

		expect(result).toEqual({ success: true });
		expect(mockUpdatePlaylistMetadata).toHaveBeenCalledWith(
			"acct-1",
			"abc123",
			{ name: "Renamed" },
		);
	});

	it("passes both name and description when provided", async () => {
		mockUpdatePlaylistMetadata.mockResolvedValue(
			Result.ok(makePlaylist({ name: "New", description: "Desc" })),
		);

		await acknowledgePlaylistUpdate({
			data: { spotifyId: "abc123", name: "New", description: "Desc" },
		});

		expect(mockUpdatePlaylistMetadata).toHaveBeenCalledWith(
			"acct-1",
			"abc123",
			{ name: "New", description: "Desc" },
		);
	});

	it("throws when metadata update fails", async () => {
		mockUpdatePlaylistMetadata.mockResolvedValue(
			Result.err(new DatabaseError({ code: "42000", message: "db error" })),
		);

		await expect(
			acknowledgePlaylistUpdate({
				data: { spotifyId: "abc123", name: "Test" },
			}),
		).rejects.toThrow("Failed to acknowledge playlist update");
	});
});

describe("acknowledgePlaylistDelete", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRequireAuthSession.mockResolvedValue({
			session: { accountId: "acct-1" },
		});
	});

	it("looks up and deletes the playlist row", async () => {
		mockGetPlaylistBySpotifyId.mockResolvedValue(Result.ok(makePlaylist()));
		mockDeletePlaylist.mockResolvedValue(Result.ok(null));

		const result = await acknowledgePlaylistDelete({
			data: { uri: "spotify:playlist:abc123" },
		});

		expect(result).toEqual({ success: true, alreadyAbsent: false });
		expect(mockGetPlaylistBySpotifyId).toHaveBeenCalledWith("acct-1", "abc123");
		expect(mockDeletePlaylist).toHaveBeenCalledWith("uuid-1");
	});

	it("treats already-absent row as idempotent success", async () => {
		mockGetPlaylistBySpotifyId.mockResolvedValue(Result.ok(null));

		const result = await acknowledgePlaylistDelete({
			data: { uri: "spotify:playlist:abc123" },
		});

		expect(result).toEqual({ success: true, alreadyAbsent: true });
		expect(mockDeletePlaylist).not.toHaveBeenCalled();
	});

	it("scopes lookup to authenticated account only", async () => {
		mockRequireAuthSession.mockResolvedValue({
			session: { accountId: "acct-other" },
		});
		mockGetPlaylistBySpotifyId.mockResolvedValue(Result.ok(null));

		await acknowledgePlaylistDelete({
			data: { uri: "spotify:playlist:abc123" },
		});

		expect(mockGetPlaylistBySpotifyId).toHaveBeenCalledWith(
			"acct-other",
			"abc123",
		);
	});

	it("throws when lookup fails", async () => {
		mockGetPlaylistBySpotifyId.mockResolvedValue(
			Result.err(new DatabaseError({ code: "42000", message: "db error" })),
		);

		await expect(
			acknowledgePlaylistDelete({
				data: { uri: "spotify:playlist:abc123" },
			}),
		).rejects.toThrow("Failed to look up playlist for delete");
	});

	it("throws when delete fails", async () => {
		mockGetPlaylistBySpotifyId.mockResolvedValue(Result.ok(makePlaylist()));
		mockDeletePlaylist.mockResolvedValue(
			Result.err(new DatabaseError({ code: "42000", message: "db error" })),
		);

		await expect(
			acknowledgePlaylistDelete({
				data: { uri: "spotify:playlist:abc123" },
			}),
		).rejects.toThrow("Failed to acknowledge playlist delete");
	});
});
