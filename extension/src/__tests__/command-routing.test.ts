import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenProvider } from "../background/command-handler";
import { handleSpotifyCommand } from "../background/command-handler";
import type { SpotifyCommand, SpotifyTokenPayload } from "../shared/types";

vi.mock("../shared/spotify-client/reads", () => ({
	queryArtistOverview: vi.fn().mockResolvedValue({
		id: "abc",
		name: "Test Artist",
		avatarImages: [],
	}),
}));

vi.mock("../shared/spotify-client/mutations", () => ({
	addToPlaylist: vi.fn().mockResolvedValue({ typename: "Success" }),
	removeFromPlaylist: vi.fn().mockResolvedValue({ typename: "Success" }),
}));

vi.mock("../shared/spotify-client/playlist-v2", () => ({
	createPlaylist: vi
		.fn()
		.mockResolvedValue({ uri: "spotify:playlist:new", revision: "r1" }),
	updatePlaylist: vi.fn().mockResolvedValue({ revision: "r2" }),
	deletePlaylist: vi.fn().mockResolvedValue({ revision: "r3" }),
}));

const globalAny = globalThis as any;
globalAny.chrome = {
	storage: {
		local: {
			get: vi.fn().mockResolvedValue({}),
			set: vi.fn().mockResolvedValue(undefined),
			remove: vi.fn().mockResolvedValue(undefined),
		},
	},
};

function makeToken(valid: boolean): SpotifyTokenPayload {
	return {
		accessToken: "test-token-abc",
		expiresAtMs: valid ? Date.now() + 60_000 : Date.now() - 1000,
		isAnonymous: false,
	};
}

function makeTokenProvider(valid: boolean): TokenProvider {
	const token = valid ? makeToken(true) : null;
	return {
		getCachedToken: () => token,
		setCachedToken: vi.fn(),
		isTokenValid: () => valid,
	};
}

describe("handleSpotifyCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("AUTH_REQUIRED when no valid token", () => {
		it("returns AUTH_REQUIRED error when token is invalid", async () => {
			const cmd: SpotifyCommand = {
				type: "SPOTIFY_COMMAND",
				command: "addToPlaylist",
				payload: {
					playlistUri: "spotify:playlist:1",
					trackUris: ["spotify:track:1"],
				},
				commandId: "cmd-1",
			};

			const result = await handleSpotifyCommand(cmd, makeTokenProvider(false));

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.errorCode).toBe("AUTH_REQUIRED");
				expect(result.message).toBe("No valid Spotify token");
				expect(result.retryable).toBe(false);
			}
		});

		it("attempts to re-hydrate token from storage when no cached token", async () => {
			const storedToken = makeToken(true);
			globalAny.chrome.storage.local.get.mockResolvedValueOnce({
				spotifyToken: storedToken,
			});

			const provider: TokenProvider = {
				getCachedToken: vi
					.fn()
					.mockReturnValueOnce(null)
					.mockReturnValue(storedToken),
				setCachedToken: vi.fn(),
				isTokenValid: () => true,
			};

			const cmd: SpotifyCommand = {
				type: "SPOTIFY_COMMAND",
				command: "addToPlaylist",
				payload: {
					playlistUri: "spotify:playlist:1",
					trackUris: ["spotify:track:1"],
				},
				commandId: "cmd-rehydrate",
			};

			const result = await handleSpotifyCommand(cmd, provider);

			expect(provider.setCachedToken).toHaveBeenCalledWith(storedToken);
			expect(result.ok).toBe(true);
		});
	});

	describe("commandId echoed back", () => {
		it("includes commandId in successful response", async () => {
			const cmd: SpotifyCommand = {
				type: "SPOTIFY_COMMAND",
				command: "addToPlaylist",
				payload: {
					playlistUri: "spotify:playlist:1",
					trackUris: ["spotify:track:1"],
				},
				commandId: "unique-id-123",
			};

			const result = await handleSpotifyCommand(cmd, makeTokenProvider(true));

			expect(result.commandId).toBe("unique-id-123");
		});

		it("includes commandId in error response", async () => {
			const cmd: SpotifyCommand = {
				type: "SPOTIFY_COMMAND",
				command: "addToPlaylist",
				payload: {
					playlistUri: "spotify:playlist:1",
					trackUris: ["spotify:track:1"],
				},
				commandId: "err-id-456",
			};

			const result = await handleSpotifyCommand(cmd, makeTokenProvider(false));

			expect(result.commandId).toBe("err-id-456");
		});
	});

	describe("command routing to correct client functions", () => {
		it("routes addToPlaylist to mutations.addToPlaylist", async () => {
			const { addToPlaylist } = await import(
				"../shared/spotify-client/mutations"
			);

			const cmd: SpotifyCommand = {
				type: "SPOTIFY_COMMAND",
				command: "addToPlaylist",
				payload: {
					playlistUri: "spotify:playlist:abc",
					trackUris: ["spotify:track:1", "spotify:track:2"],
					position: "TOP_OF_PLAYLIST",
				},
				commandId: "cmd-add",
			};

			const result = await handleSpotifyCommand(cmd, makeTokenProvider(true));

			expect(result.ok).toBe(true);
			expect(addToPlaylist).toHaveBeenCalledWith(
				"test-token-abc",
				"spotify:playlist:abc",
				["spotify:track:1", "spotify:track:2"],
				"TOP_OF_PLAYLIST",
			);
		});

		it("routes removeFromPlaylist to mutations.removeFromPlaylist", async () => {
			const { removeFromPlaylist } = await import(
				"../shared/spotify-client/mutations"
			);

			const cmd: SpotifyCommand = {
				type: "SPOTIFY_COMMAND",
				command: "removeFromPlaylist",
				payload: {
					playlistUri: "spotify:playlist:abc",
					uids: ["uid1", "uid2"],
				},
				commandId: "cmd-rem",
			};

			const result = await handleSpotifyCommand(cmd, makeTokenProvider(true));

			expect(result.ok).toBe(true);
			expect(removeFromPlaylist).toHaveBeenCalledWith(
				"test-token-abc",
				"spotify:playlist:abc",
				["uid1", "uid2"],
			);
		});

		it("routes createPlaylist to playlist-v2.createPlaylist", async () => {
			const { createPlaylist } = await import(
				"../shared/spotify-client/playlist-v2"
			);

			const cmd: SpotifyCommand = {
				type: "SPOTIFY_COMMAND",
				command: "createPlaylist",
				payload: { name: "My Playlist", userId: "user123" },
				commandId: "cmd-create",
			};

			const result = await handleSpotifyCommand(cmd, makeTokenProvider(true));

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data).toEqual({
					uri: "spotify:playlist:new",
					revision: "r1",
				});
			}
			expect(createPlaylist).toHaveBeenCalledWith(
				"test-token-abc",
				"My Playlist",
				"user123",
			);
		});

		it("routes updatePlaylist to playlist-v2.updatePlaylist", async () => {
			const { updatePlaylist } = await import(
				"../shared/spotify-client/playlist-v2"
			);

			const cmd: SpotifyCommand = {
				type: "SPOTIFY_COMMAND",
				command: "updatePlaylist",
				payload: { playlistId: "pl-id", name: "New Name", description: "desc" },
				commandId: "cmd-update",
			};

			const result = await handleSpotifyCommand(cmd, makeTokenProvider(true));

			expect(result.ok).toBe(true);
			expect(updatePlaylist).toHaveBeenCalledWith("test-token-abc", "pl-id", {
				name: "New Name",
				description: "desc",
			});
		});

		it("routes deletePlaylist to playlist-v2.deletePlaylist", async () => {
			const { deletePlaylist } = await import(
				"../shared/spotify-client/playlist-v2"
			);

			const cmd: SpotifyCommand = {
				type: "SPOTIFY_COMMAND",
				command: "deletePlaylist",
				payload: { playlistUri: "spotify:playlist:del", userId: "user123" },
				commandId: "cmd-delete",
			};

			const result = await handleSpotifyCommand(cmd, makeTokenProvider(true));

			expect(result.ok).toBe(true);
			expect(deletePlaylist).toHaveBeenCalledWith(
				"test-token-abc",
				"spotify:playlist:del",
				"user123",
			);
		});

		it("routes queryArtistOverview to reads.queryArtistOverview", async () => {
			const { queryArtistOverview } = await import(
				"../shared/spotify-client/reads"
			);

			const cmd: SpotifyCommand = {
				type: "SPOTIFY_COMMAND",
				command: "queryArtistOverview",
				payload: { artistUri: "spotify:artist:xyz", locale: "sv" },
				commandId: "cmd-artist",
			};

			const result = await handleSpotifyCommand(cmd, makeTokenProvider(true));

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data).toEqual({
					id: "abc",
					name: "Test Artist",
					avatarImages: [],
				});
			}
			expect(queryArtistOverview).toHaveBeenCalledWith(
				"test-token-abc",
				"spotify:artist:xyz",
				"sv",
			);
		});
	});

	describe("error mapping", () => {
		it("maps rate limit errors to RATE_LIMITED with retryable=true", async () => {
			const { addToPlaylist } = await import(
				"../shared/spotify-client/mutations"
			);
			vi.mocked(addToPlaylist).mockRejectedValueOnce(
				new Error("Spotify rate limit: max retries exceeded"),
			);

			const cmd: SpotifyCommand = {
				type: "SPOTIFY_COMMAND",
				command: "addToPlaylist",
				payload: {
					playlistUri: "spotify:playlist:1",
					trackUris: ["spotify:track:1"],
				},
				commandId: "cmd-rate",
			};

			const result = await handleSpotifyCommand(cmd, makeTokenProvider(true));

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.errorCode).toBe("RATE_LIMITED");
				expect(result.retryable).toBe(true);
			}
		});

		it("maps unknown operation errors to UNKNOWN_HASH", async () => {
			const { queryArtistOverview } = await import(
				"../shared/spotify-client/reads"
			);
			vi.mocked(queryArtistOverview).mockRejectedValueOnce(
				new Error(
					"Unknown operation: queryArtistOverview — no hash in storage or defaults",
				),
			);

			const cmd: SpotifyCommand = {
				type: "SPOTIFY_COMMAND",
				command: "queryArtistOverview",
				payload: { artistUri: "spotify:artist:xyz" },
				commandId: "cmd-hash",
			};

			const result = await handleSpotifyCommand(cmd, makeTokenProvider(true));

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.errorCode).toBe("UNKNOWN_HASH");
				expect(result.retryable).toBe(false);
			}
		});

		it("maps generic errors to UPSTREAM_ERROR with retryable=false", async () => {
			const { removeFromPlaylist } = await import(
				"../shared/spotify-client/mutations"
			);
			vi.mocked(removeFromPlaylist).mockRejectedValueOnce(
				new Error("Connection refused"),
			);

			const cmd: SpotifyCommand = {
				type: "SPOTIFY_COMMAND",
				command: "removeFromPlaylist",
				payload: { playlistUri: "spotify:playlist:1", uids: ["u1"] },
				commandId: "cmd-generic",
			};

			const result = await handleSpotifyCommand(cmd, makeTokenProvider(true));

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.errorCode).toBe("UPSTREAM_ERROR");
				expect(result.retryable).toBe(false);
				expect(result.message).toBe("Connection refused");
			}
		});
	});

	describe("exhaustive switch — unsupported command", () => {
		it("returns UNSUPPORTED_OPERATION for unknown commands", async () => {
			const cmd = {
				type: "SPOTIFY_COMMAND",
				command: "nonExistentCommand",
				payload: {},
				commandId: "cmd-unknown",
			} as any;

			const result = await handleSpotifyCommand(cmd, makeTokenProvider(true));

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.errorCode).toBe("UNSUPPORTED_OPERATION");
				expect(result.message).toContain("nonExistentCommand");
				expect(result.commandId).toBe("cmd-unknown");
			}
		});
	});
});
