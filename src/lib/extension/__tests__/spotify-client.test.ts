import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSendExtensionCommand, MOCK_UUID, mockRandomUUID } = vi.hoisted(
	() => {
		const mockSendExtensionCommand = vi.fn();
		const MOCK_UUID = "test-uuid-1234-5678-abcd";
		const mockRandomUUID = vi.fn(() => MOCK_UUID);
		return { mockSendExtensionCommand, MOCK_UUID, mockRandomUUID };
	},
);

vi.mock("../detect", () => ({
	sendExtensionCommand: mockSendExtensionCommand,
}));

vi.stubGlobal("crypto", { randomUUID: mockRandomUUID });

import {
	addToPlaylist,
	removeFromPlaylist,
	createPlaylist,
	updatePlaylist,
	deletePlaylist,
	queryArtistOverview,
} from "../spotify-client";

beforeEach(() => {
	mockSendExtensionCommand.mockReset();
});

describe("command serialization", () => {
	it("addToPlaylist sends correct message shape", async () => {
		mockSendExtensionCommand.mockResolvedValue({
			ok: true,
			data: { typename: "Success" },
			commandId: MOCK_UUID,
		});

		await addToPlaylist("spotify:playlist:abc", ["spotify:track:1"]);

		expect(mockSendExtensionCommand).toHaveBeenCalledWith({
			type: "SPOTIFY_COMMAND",
			command: "addToPlaylist",
			payload: {
				playlistUri: "spotify:playlist:abc",
				trackUris: ["spotify:track:1"],
				position: "BOTTOM_OF_PLAYLIST",
			},
			commandId: MOCK_UUID,
			protocolVersion: 1,
		});
	});

	it("addToPlaylist passes custom position", async () => {
		mockSendExtensionCommand.mockResolvedValue({
			ok: true,
			data: { typename: "Success" },
			commandId: MOCK_UUID,
		});

		await addToPlaylist(
			"spotify:playlist:abc",
			["spotify:track:1"],
			"TOP_OF_PLAYLIST",
		);

		expect(mockSendExtensionCommand).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({ position: "TOP_OF_PLAYLIST" }),
			}),
		);
	});

	it("removeFromPlaylist sends correct message shape", async () => {
		mockSendExtensionCommand.mockResolvedValue({
			ok: true,
			data: { typename: "Success" },
			commandId: MOCK_UUID,
		});

		await removeFromPlaylist("spotify:playlist:abc", ["uid-1", "uid-2"]);

		expect(mockSendExtensionCommand).toHaveBeenCalledWith({
			type: "SPOTIFY_COMMAND",
			command: "removeFromPlaylist",
			payload: {
				playlistUri: "spotify:playlist:abc",
				uids: ["uid-1", "uid-2"],
			},
			commandId: MOCK_UUID,
			protocolVersion: 1,
		});
	});

	it("createPlaylist sends correct message shape", async () => {
		mockSendExtensionCommand.mockResolvedValue({
			ok: true,
			data: { uri: "spotify:playlist:new", revision: "r1" },
			commandId: MOCK_UUID,
		});

		await createPlaylist("My Playlist", "user-123");

		expect(mockSendExtensionCommand).toHaveBeenCalledWith({
			type: "SPOTIFY_COMMAND",
			command: "createPlaylist",
			payload: { name: "My Playlist", userId: "user-123" },
			commandId: MOCK_UUID,
			protocolVersion: 1,
		});
	});

	it("updatePlaylist spreads attrs into payload", async () => {
		mockSendExtensionCommand.mockResolvedValue({
			ok: true,
			data: { revision: "r2" },
			commandId: MOCK_UUID,
		});

		await updatePlaylist("playlist-id", {
			name: "New Name",
			description: "New Desc",
		});

		expect(mockSendExtensionCommand).toHaveBeenCalledWith({
			type: "SPOTIFY_COMMAND",
			command: "updatePlaylist",
			payload: {
				playlistId: "playlist-id",
				name: "New Name",
				description: "New Desc",
			},
			commandId: MOCK_UUID,
			protocolVersion: 1,
		});
	});

	it("deletePlaylist sends correct message shape", async () => {
		mockSendExtensionCommand.mockResolvedValue({
			ok: true,
			data: { revision: "r3" },
			commandId: MOCK_UUID,
		});

		await deletePlaylist("spotify:playlist:abc", "user-123");

		expect(mockSendExtensionCommand).toHaveBeenCalledWith({
			type: "SPOTIFY_COMMAND",
			command: "deletePlaylist",
			payload: {
				playlistUri: "spotify:playlist:abc",
				userId: "user-123",
			},
			commandId: MOCK_UUID,
			protocolVersion: 1,
		});
	});

	it("queryArtistOverview sends correct message shape", async () => {
		mockSendExtensionCommand.mockResolvedValue({
			ok: true,
			data: { id: "artist-1", name: "Artist", avatarImages: [] },
			commandId: MOCK_UUID,
		});

		await queryArtistOverview("spotify:artist:abc", "en");

		expect(mockSendExtensionCommand).toHaveBeenCalledWith({
			type: "SPOTIFY_COMMAND",
			command: "queryArtistOverview",
			payload: { artistUri: "spotify:artist:abc", locale: "en" },
			commandId: MOCK_UUID,
			protocolVersion: 1,
		});
	});

	it("queryArtistOverview passes undefined locale when omitted", async () => {
		mockSendExtensionCommand.mockResolvedValue({
			ok: true,
			data: { id: "artist-1", name: "Artist", avatarImages: [] },
			commandId: MOCK_UUID,
		});

		await queryArtistOverview("spotify:artist:abc");

		expect(mockSendExtensionCommand).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: { artistUri: "spotify:artist:abc", locale: undefined },
			}),
		);
	});
});

describe("response handling", () => {
	it("passes through success responses", async () => {
		const successResponse = {
			ok: true as const,
			data: { typename: "AddResult" },
			commandId: MOCK_UUID,
		};
		mockSendExtensionCommand.mockResolvedValue(successResponse);

		const result = await addToPlaylist("spotify:playlist:abc", [
			"spotify:track:1",
		]);

		expect(result).toEqual(successResponse);
	});

	it("passes through error responses from extension", async () => {
		const errorResponse = {
			ok: false as const,
			errorCode: "RATE_LIMITED",
			message: "Too many requests",
			retryable: true,
			commandId: MOCK_UUID,
		};
		mockSendExtensionCommand.mockResolvedValue(errorResponse);

		const result = await addToPlaylist("spotify:playlist:abc", [
			"spotify:track:1",
		]);

		expect(result).toEqual(errorResponse);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errorCode).toBe("RATE_LIMITED");
			expect(result.retryable).toBe(true);
		}
	});
});

describe("extension unavailable", () => {
	it("returns NETWORK_ERROR when sendExtensionCommand returns null", async () => {
		mockSendExtensionCommand.mockResolvedValue(null);

		const result = await createPlaylist("Test", "user-1");

		expect(result).toEqual({
			ok: false,
			errorCode: "NETWORK_ERROR",
			message: "Extension not available",
			retryable: false,
			commandId: MOCK_UUID,
		});
	});

	it("returns NETWORK_ERROR for all command types when extension is unavailable", async () => {
		mockSendExtensionCommand.mockResolvedValue(null);

		const results = await Promise.all([
			addToPlaylist("uri", ["track"]),
			removeFromPlaylist("uri", ["uid"]),
			createPlaylist("name", "user"),
			updatePlaylist("id", { name: "n" }),
			deletePlaylist("uri", "user"),
			queryArtistOverview("uri"),
		]);

		for (const result of results) {
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.errorCode).toBe("NETWORK_ERROR");
				expect(result.retryable).toBe(false);
			}
		}
	});
});

describe("commandId generation", () => {
	it("includes the generated UUID in the command message", async () => {
		mockSendExtensionCommand.mockResolvedValue(null);

		await addToPlaylist("uri", ["track"]);

		expect(mockSendExtensionCommand).toHaveBeenCalledWith(
			expect.objectContaining({ commandId: MOCK_UUID }),
		);
	});

	it("includes the commandId in NETWORK_ERROR fallback response", async () => {
		mockSendExtensionCommand.mockResolvedValue(null);

		const result = await addToPlaylist("uri", ["track"]);

		expect(result.commandId).toBe(MOCK_UUID);
	});

	it("generates a unique commandId per call", async () => {
		const uuids = ["uuid-1", "uuid-2", "uuid-3"];
		let callCount = 0;
		mockRandomUUID.mockImplementation(() => uuids[callCount++]);
		mockSendExtensionCommand.mockResolvedValue(null);

		await addToPlaylist("uri", ["t1"]);
		await removeFromPlaylist("uri", ["u1"]);
		await createPlaylist("name", "user");

		const calls = mockSendExtensionCommand.mock.calls;
		expect(calls[0][0].commandId).toBe("uuid-1");
		expect(calls[1][0].commandId).toBe("uuid-2");
		expect(calls[2][0].commandId).toBe("uuid-3");
	});
});
