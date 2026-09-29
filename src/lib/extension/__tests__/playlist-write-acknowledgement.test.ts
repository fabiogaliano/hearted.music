import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreatePlaylist = vi.fn();
const mockAcknowledgeCreate = vi.fn();

vi.mock("../spotify-client", () => ({
	createPlaylist: (...args: unknown[]) => mockCreatePlaylist(...args),
}));

vi.mock("@/lib/server/playlists.functions", () => ({
	acknowledgePlaylistCreate: (...args: unknown[]) =>
		mockAcknowledgeCreate(...args),
}));

const { createPlaylistAcknowledged } = await import(
	"../playlist-write-acknowledgement"
);

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

	it("preserves the created URI and skips DB acknowledgement when rootlist registration fails", async () => {
		mockCreatePlaylist.mockResolvedValue({
			ok: true,
			data: {
				uri: "spotify:playlist:new1",
				revision: "r1",
				rootlistRegistered: false,
			},
			commandId: "cmd-1",
		});

		const result = await createPlaylistAcknowledged("My Playlist", "user1");

		expect(result).toEqual({
			ok: true,
			data: {
				uri: "spotify:playlist:new1",
				revision: "r1",
				rootlistRegistered: false,
			},
			acknowledged: false,
			rootlistRegistered: false,
		});
		expect(mockAcknowledgeCreate).not.toHaveBeenCalled();
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

	it("retries a failed acknowledge and reports acknowledged=true when a later attempt lands", async () => {
		mockCreatePlaylist.mockResolvedValue({
			ok: true,
			data: { uri: "spotify:playlist:new1", revision: "r1" },
			commandId: "cmd-1",
		});
		// First attempt fails (transient DB blip), second attempt succeeds.
		mockAcknowledgeCreate
			.mockRejectedValueOnce(new Error("transient"))
			.mockResolvedValueOnce({ success: true });

		const result = await createPlaylistAcknowledged("My Playlist", "user1");

		expect(result).toEqual({
			ok: true,
			data: { uri: "spotify:playlist:new1", revision: "r1" },
			acknowledged: true,
		});
		expect(mockAcknowledgeCreate).toHaveBeenCalledTimes(2);
	});

	it("returns success with acknowledged=false when acknowledgement fails on every retry", async () => {
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
		if (result.ok && !result.acknowledged && result.rootlistRegistered) {
			expect(result.acknowledgeError).toBeInstanceOf(Error);
		}
		// Initial attempt + 2 bounded retries.
		expect(mockAcknowledgeCreate).toHaveBeenCalledTimes(3);
	});
});
