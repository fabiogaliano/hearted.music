import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreatePlaylist = vi.fn();
const mockUpdatePlaylist = vi.fn();
const mockDeletePlaylist = vi.fn();
const mockAcknowledgeCreate = vi.fn();
const mockAcknowledgeUpdate = vi.fn();
const mockAcknowledgeDelete = vi.fn();

vi.mock("../spotify-client", () => ({
	createPlaylist: (...args: unknown[]) => mockCreatePlaylist(...args),
	updatePlaylist: (...args: unknown[]) => mockUpdatePlaylist(...args),
	deletePlaylist: (...args: unknown[]) => mockDeletePlaylist(...args),
}));

vi.mock("@/lib/server/playlists.functions", () => ({
	acknowledgePlaylistCreate: (...args: unknown[]) =>
		mockAcknowledgeCreate(...args),
	acknowledgePlaylistUpdate: (...args: unknown[]) =>
		mockAcknowledgeUpdate(...args),
	acknowledgePlaylistDelete: (...args: unknown[]) =>
		mockAcknowledgeDelete(...args),
}));

const {
	createPlaylistAcknowledged,
	updatePlaylistAcknowledged,
	deletePlaylistAcknowledged,
} = await import("../playlist-write-acknowledgement");

describe("createPlaylistAcknowledged", () => {
	beforeEach(() => vi.clearAllMocks());

	it("executes command then acknowledges on success", async () => {
		mockCreatePlaylist.mockResolvedValue({
			ok: true,
			data: { uri: "spotify:playlist:new1", revision: "r1" },
			commandId: "cmd-1",
		});
		mockAcknowledgeCreate.mockResolvedValue({ success: true });

		const result = await createPlaylistAcknowledged("My Playlist", "user1");

		expect(result).toEqual({
			ok: true,
			data: { uri: "spotify:playlist:new1", revision: "r1" },
			acknowledged: true,
		});
		expect(mockCreatePlaylist).toHaveBeenCalledWith("My Playlist", "user1");
		expect(mockAcknowledgeCreate).toHaveBeenCalledWith({
			data: { uri: "spotify:playlist:new1", name: "My Playlist" },
		});
	});

	it("short-circuits when command fails", async () => {
		mockCreatePlaylist.mockResolvedValue({
			ok: false,
			errorCode: "NETWORK_ERROR",
			message: "Extension not available",
			retryable: false,
			commandId: "cmd-1",
		});

		const result = await createPlaylistAcknowledged("My Playlist", "user1");

		expect(result.ok).toBe(false);
		expect(mockAcknowledgeCreate).not.toHaveBeenCalled();
	});

	it("returns success with acknowledged=false when acknowledgement fails", async () => {
		mockCreatePlaylist.mockResolvedValue({
			ok: true,
			data: { uri: "spotify:playlist:new1", revision: "r1" },
			commandId: "cmd-1",
		});
		mockAcknowledgeCreate.mockRejectedValue(new Error("DB down"));

		const result = await createPlaylistAcknowledged("My Playlist", "user1");

		expect(result).toMatchObject({
			ok: true,
			data: { uri: "spotify:playlist:new1", revision: "r1" },
			acknowledged: false,
		});
		if (result.ok && !result.acknowledged) {
			expect(result.acknowledgeError).toBeInstanceOf(Error);
		}
	});
});

describe("updatePlaylistAcknowledged", () => {
	beforeEach(() => vi.clearAllMocks());

	it("executes command then acknowledges on success", async () => {
		mockUpdatePlaylist.mockResolvedValue({
			ok: true,
			data: { revision: "r2" },
			commandId: "cmd-2",
		});
		mockAcknowledgeUpdate.mockResolvedValue({ success: true });

		const result = await updatePlaylistAcknowledged("pl-id", {
			name: "Renamed",
		});

		expect(result).toEqual({
			ok: true,
			data: { revision: "r2" },
			acknowledged: true,
		});
		expect(mockUpdatePlaylist).toHaveBeenCalledWith("pl-id", {
			name: "Renamed",
		});
		expect(mockAcknowledgeUpdate).toHaveBeenCalledWith({
			data: { spotifyId: "pl-id", name: "Renamed" },
		});
	});

	it("short-circuits when command fails", async () => {
		mockUpdatePlaylist.mockResolvedValue({
			ok: false,
			errorCode: "AUTH_REQUIRED",
			message: "Not authenticated",
			retryable: false,
			commandId: "cmd-2",
		});

		const result = await updatePlaylistAcknowledged("pl-id", {
			name: "Renamed",
		});

		expect(result.ok).toBe(false);
		expect(mockAcknowledgeUpdate).not.toHaveBeenCalled();
	});

	it("returns success with acknowledged=false when acknowledgement fails", async () => {
		mockUpdatePlaylist.mockResolvedValue({
			ok: true,
			data: { revision: "r2" },
			commandId: "cmd-2",
		});
		mockAcknowledgeUpdate.mockRejectedValue(new Error("Server error"));

		const result = await updatePlaylistAcknowledged("pl-id", {
			description: "New desc",
		});

		expect(result).toMatchObject({
			ok: true,
			data: { revision: "r2" },
			acknowledged: false,
		});
	});
});

describe("deletePlaylistAcknowledged", () => {
	beforeEach(() => vi.clearAllMocks());

	it("executes command then acknowledges on success", async () => {
		mockDeletePlaylist.mockResolvedValue({
			ok: true,
			data: { revision: "r3" },
			commandId: "cmd-3",
		});
		mockAcknowledgeDelete.mockResolvedValue({
			success: true,
			alreadyAbsent: false,
		});

		const result = await deletePlaylistAcknowledged(
			"spotify:playlist:abc",
			"user1",
		);

		expect(result).toEqual({
			ok: true,
			data: { revision: "r3" },
			acknowledged: true,
		});
		expect(mockDeletePlaylist).toHaveBeenCalledWith(
			"spotify:playlist:abc",
			"user1",
		);
		expect(mockAcknowledgeDelete).toHaveBeenCalledWith({
			data: { uri: "spotify:playlist:abc" },
		});
	});

	it("short-circuits when command fails", async () => {
		mockDeletePlaylist.mockResolvedValue({
			ok: false,
			errorCode: "RATE_LIMITED",
			message: "Too fast",
			retryable: true,
			commandId: "cmd-3",
		});

		const result = await deletePlaylistAcknowledged(
			"spotify:playlist:abc",
			"user1",
		);

		expect(result.ok).toBe(false);
		expect(mockAcknowledgeDelete).not.toHaveBeenCalled();
	});

	it("returns success with acknowledged=false when acknowledgement fails", async () => {
		mockDeletePlaylist.mockResolvedValue({
			ok: true,
			data: { revision: "r3" },
			commandId: "cmd-3",
		});
		mockAcknowledgeDelete.mockRejectedValue(new Error("DB down"));

		const result = await deletePlaylistAcknowledged(
			"spotify:playlist:abc",
			"user1",
		);

		expect(result).toMatchObject({
			ok: true,
			data: { revision: "r3" },
			acknowledged: false,
		});
	});
});
