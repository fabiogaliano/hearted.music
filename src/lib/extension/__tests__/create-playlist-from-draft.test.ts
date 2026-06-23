/**
 * Tests for the createPlaylistFromDraft orchestrator.
 *
 * Mocks the extension transport (isExtensionInstalled, getSpotifyConnectionStatus,
 * createPlaylistAcknowledged, addToPlaylist) and the server functions
 * (resolveSpotifyUserId, persistNewPlaylistConfig, recordPlaylistMatchDecisions)
 * so these tests exercise the orchestration decision logic only, not the real
 * extension or network.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Server function mocks ──────────────────────────────────────────────────

const mockResolveSpotifyUserId = vi.fn();
const mockPersistNewPlaylistConfig = vi.fn();
const mockRecordPlaylistMatchDecisions = vi.fn();

vi.mock("@/lib/server/playlist-draft.functions", () => ({
	resolveSpotifyUserId: (...args: unknown[]) =>
		mockResolveSpotifyUserId(...args),
	persistNewPlaylistConfig: (...args: unknown[]) =>
		mockPersistNewPlaylistConfig(...args),
	recordPlaylistMatchDecisions: (...args: unknown[]) =>
		mockRecordPlaylistMatchDecisions(...args),
}));

// ── Extension transport mocks ──────────────────────────────────────────────

const mockIsExtensionInstalled = vi.fn();
const mockGetSpotifyConnectionStatus = vi.fn();

vi.mock("../detect", () => ({
	isExtensionInstalled: (...args: unknown[]) =>
		mockIsExtensionInstalled(...args),
	getSpotifyConnectionStatus: (...args: unknown[]) =>
		mockGetSpotifyConnectionStatus(...args),
}));

const mockCreatePlaylistAcknowledged = vi.fn();

vi.mock("../playlist-write-acknowledgement", () => ({
	createPlaylistAcknowledged: (...args: unknown[]) =>
		mockCreatePlaylistAcknowledged(...args),
}));

const mockAddToPlaylist = vi.fn();

vi.mock("../spotify-client", () => ({
	addToPlaylist: (...args: unknown[]) => mockAddToPlaylist(...args),
}));

// ── Import under test ──────────────────────────────────────────────────────

const { createPlaylistFromDraft } = await import(
	"../create-playlist-from-draft"
);

// ── Shared fixtures ────────────────────────────────────────────────────────

const BASE_INPUT: import("../create-playlist-from-draft").CreatePlaylistFromDraftInput =
	{
		name: "My Draft Playlist",
		songIds: ["song-uuid-1", "song-uuid-2"],
		genrePills: ["indie", "folk"],
		matchFilters: { version: 1 },
		intentApplied: false,
		intent: null,
	};

const SUCCESS_CREATE_RESULT = {
	ok: true as const,
	data: { uri: "spotify:playlist:abc123", revision: "r1" },
	acknowledged: true as const,
};

const SUCCESS_ADD_RESULT = {
	ok: true as const,
	data: { typename: "AddItemsToPlaylistPayload" },
	commandId: "cmd-add-1",
};

function setupHappyPath() {
	mockIsExtensionInstalled.mockResolvedValue(true);
	mockGetSpotifyConnectionStatus.mockResolvedValue(true);
	mockResolveSpotifyUserId.mockResolvedValue({
		spotifyUserId: "spotify-user-42",
	});
	mockCreatePlaylistAcknowledged.mockResolvedValue(SUCCESS_CREATE_RESULT);
	mockPersistNewPlaylistConfig.mockResolvedValue({
		trackUris: ["spotify:track:track1", "spotify:track:track2"],
	});
	mockAddToPlaylist.mockResolvedValue(SUCCESS_ADD_RESULT);
	mockRecordPlaylistMatchDecisions.mockResolvedValue({ recorded: 2 });
}

beforeEach(() => {
	vi.clearAllMocks();
});

// ── Success path ───────────────────────────────────────────────────────────

describe("success path", () => {
	it("returns success with playlist URI and spotifyId", async () => {
		setupHappyPath();

		const result = await createPlaylistFromDraft({ ...BASE_INPUT });

		expect(result).toEqual({
			status: "success",
			playlistUri: "spotify:playlist:abc123",
			spotifyId: "abc123",
		});
	});

	it("calls createPlaylistAcknowledged with resolved userId", async () => {
		setupHappyPath();

		await createPlaylistFromDraft({ ...BASE_INPUT });

		expect(mockCreatePlaylistAcknowledged).toHaveBeenCalledWith(
			"My Draft Playlist",
			"spotify-user-42",
		);
	});

	it("calls addToPlaylist in bulk (single call with all URIs)", async () => {
		setupHappyPath();

		await createPlaylistFromDraft({ ...BASE_INPUT });

		expect(mockAddToPlaylist).toHaveBeenCalledTimes(1);
		expect(mockAddToPlaylist).toHaveBeenCalledWith("spotify:playlist:abc123", [
			"spotify:track:track1",
			"spotify:track:track2",
		]);
	});

	it("passes the correct config fields to persistNewPlaylistConfig", async () => {
		setupHappyPath();

		await createPlaylistFromDraft({
			...BASE_INPUT,
			genrePills: ["rock"],
			intentApplied: true,
			intent: "melancholic rainy day",
		});

		expect(mockPersistNewPlaylistConfig).toHaveBeenCalledWith({
			data: {
				spotifyId: "abc123",
				songIds: BASE_INPUT.songIds,
				intent: "melancholic rainy day",
				genrePills: ["rock"],
				matchFilters: { version: 1 },
				intentApplied: true,
			},
		});
	});

	it("succeeds even when there are no songs to add", async () => {
		setupHappyPath();
		mockPersistNewPlaylistConfig.mockResolvedValue({ trackUris: [] });

		const result = await createPlaylistFromDraft({
			...BASE_INPUT,
			songIds: [],
		});

		expect(result).toEqual({
			status: "success",
			playlistUri: "spotify:playlist:abc123",
			spotifyId: "abc123",
		});
		expect(mockAddToPlaylist).not.toHaveBeenCalled();
	});
});

// ── extension-unavailable mapping ─────────────────────────────────────────

describe("extension-unavailable", () => {
	it("returns extension-unavailable when extension is not installed", async () => {
		mockIsExtensionInstalled.mockResolvedValue(false);

		const result = await createPlaylistFromDraft({ ...BASE_INPUT });

		expect(result).toEqual({ status: "extension-unavailable" });
		expect(mockGetSpotifyConnectionStatus).not.toHaveBeenCalled();
	});
});

// ── reconnect-required mapping ─────────────────────────────────────────────

describe("reconnect-required", () => {
	it("returns reconnect-required when Spotify is not connected", async () => {
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyConnectionStatus.mockResolvedValue(false);

		const result = await createPlaylistFromDraft({ ...BASE_INPUT });

		expect(result).toEqual({ status: "reconnect-required" });
		expect(mockResolveSpotifyUserId).not.toHaveBeenCalled();
	});

	it("returns reconnect-required when spotifyUserId is null", async () => {
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyConnectionStatus.mockResolvedValue(true);
		mockResolveSpotifyUserId.mockResolvedValue({ spotifyUserId: null });

		const result = await createPlaylistFromDraft({ ...BASE_INPUT });

		expect(result).toEqual({ status: "reconnect-required" });
		expect(mockCreatePlaylistAcknowledged).not.toHaveBeenCalled();
	});

	it("returns reconnect-required when createPlaylist fails with AUTH_REQUIRED", async () => {
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyConnectionStatus.mockResolvedValue(true);
		mockResolveSpotifyUserId.mockResolvedValue({ spotifyUserId: "sp-user" });
		mockCreatePlaylistAcknowledged.mockResolvedValue({
			ok: false as const,
			commandResponse: {
				ok: false as const,
				errorCode: "AUTH_REQUIRED" as const,
				message: "Not authenticated",
				retryable: false,
				commandId: "cmd-1",
			},
		});

		const result = await createPlaylistFromDraft({ ...BASE_INPUT });

		expect(result).toEqual({ status: "reconnect-required" });
	});

	it("returns reconnect-required when createPlaylist fails with TOKEN_EXPIRED", async () => {
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyConnectionStatus.mockResolvedValue(true);
		mockResolveSpotifyUserId.mockResolvedValue({ spotifyUserId: "sp-user" });
		mockCreatePlaylistAcknowledged.mockResolvedValue({
			ok: false as const,
			commandResponse: {
				ok: false as const,
				errorCode: "TOKEN_EXPIRED" as const,
				message: "Token expired",
				retryable: false,
				commandId: "cmd-1",
			},
		});

		const result = await createPlaylistFromDraft({ ...BASE_INPUT });

		expect(result).toEqual({ status: "reconnect-required" });
	});
});

// ── partial add failure ────────────────────────────────────────────────────

describe("partial add failure", () => {
	it("returns partial when addToPlaylist fails after playlist was created", async () => {
		setupHappyPath();
		mockAddToPlaylist.mockResolvedValue({
			ok: false as const,
			errorCode: "UPSTREAM_ERROR" as const,
			message: "Spotify 500",
			retryable: true,
			commandId: "cmd-add-1",
		});

		const result = await createPlaylistFromDraft({ ...BASE_INPUT });

		expect(result).toEqual({
			status: "partial",
			playlistUri: "spotify:playlist:abc123",
			spotifyId: "abc123",
			failedTrackCount: 2,
		});
	});

	it("returns partial when persistNewPlaylistConfig throws", async () => {
		setupHappyPath();
		mockPersistNewPlaylistConfig.mockRejectedValue(new Error("DB failure"));

		const result = await createPlaylistFromDraft({ ...BASE_INPUT });

		expect(result).toEqual({
			status: "partial",
			playlistUri: "spotify:playlist:abc123",
			spotifyId: "abc123",
			failedTrackCount: BASE_INPUT.songIds.length,
		});
		// Track add must not be attempted when config persistence failed
		expect(mockAddToPlaylist).not.toHaveBeenCalled();
	});

	it("returns partial (not reconnect-required) when add fails with AUTH_REQUIRED after create succeeded", async () => {
		setupHappyPath();
		mockAddToPlaylist.mockResolvedValue({
			ok: false as const,
			errorCode: "AUTH_REQUIRED" as const,
			message: "Token expired mid-create",
			retryable: false,
			commandId: "cmd-add-1",
		});

		const result = await createPlaylistFromDraft({ ...BASE_INPUT });

		// Playlist exists — partial is the correct outcome so the user can see it
		expect(result.status).toBe("partial");
	});
});

// ── match_intent eligibility gate ──────────────────────────────────────────

describe("match_intent server-side eligibility", () => {
	it("passes intentApplied=false to persistNewPlaylistConfig when caller sets it false", async () => {
		setupHappyPath();

		await createPlaylistFromDraft({
			...BASE_INPUT,
			intentApplied: false,
			intent: "some intent",
		});

		expect(mockPersistNewPlaylistConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					intentApplied: false,
					intent: "some intent",
				}),
			}),
		);
		// The server function receives both, but its eligibility check decides what to persist.
		// The test asserts the orchestrator faithfully forwards what the client provides
		// without overriding it — the server is the authority.
	});

	it("passes intentApplied=true to persistNewPlaylistConfig when caller sets it true", async () => {
		setupHappyPath();

		await createPlaylistFromDraft({
			...BASE_INPUT,
			intentApplied: true,
			intent: "melancholic evening",
		});

		expect(mockPersistNewPlaylistConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					intentApplied: true,
					intent: "melancholic evening",
				}),
			}),
		);
	});
});

// ── match_decision non-fatal ───────────────────────────────────────────────

describe("match_decision recording", () => {
	it("succeeds even when recordPlaylistMatchDecisions rejects", async () => {
		setupHappyPath();
		mockRecordPlaylistMatchDecisions.mockRejectedValue(new Error("DB down"));

		const result = await createPlaylistFromDraft({ ...BASE_INPUT });

		// Decisions are fire-and-forget; failure must not degrade the result
		expect(result).toEqual({
			status: "success",
			playlistUri: "spotify:playlist:abc123",
			spotifyId: "abc123",
		});
	});
});
