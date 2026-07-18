import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenProvider } from "../command-handler";
import type { DispatcherDeps } from "../dispatcher";
import {
	dispatchExtensionMessage,
	handleInboundMessage,
	parseExtensionWireMessage,
} from "../dispatcher";

function makeTokenProvider(valid: boolean): TokenProvider {
	const token = valid
		? {
				accessToken: "tok",
				expiresAtMs: Date.now() + 60_000,
				isAnonymous: false,
			}
		: null;
	return {
		getCachedToken: () => token,
		setCachedToken: vi.fn(),
		isTokenValid: () => valid,
	};
}

function makeDeps(overrides: Partial<DispatcherDeps> = {}): DispatcherDeps {
	return {
		isValidBackendUrl: (value: unknown): value is string =>
			typeof value === "string",
		normalizeBackendUrl: (url: string) => url,
		setConnectStorage: vi.fn().mockResolvedValue(undefined),
		rehydrateTokenIfMissing: vi.fn().mockResolvedValue(undefined),
		flushPendingSyncDiagnostics: vi.fn(),
		performSync: vi.fn().mockResolvedValue({ kind: "success", count: 3 }),
		hasSpotifySession: vi.fn().mockResolvedValue(true),
		clearSpotifyTokenCache: vi.fn(),
		isTokenValid: () => true,
		getCachedToken: () => ({
			accessToken: "tok",
			expiresAtMs: Date.now() + 60_000,
			isAnonymous: false,
		}),
		getSyncState: vi.fn().mockResolvedValue({
			status: "idle",
			phase: "idle",
			fetched: 0,
			total: 0,
			likedSongs: { fetched: 0, total: 0 },
			playlists: { fetched: 0, total: 0 },
			playlistTracks: { fetched: 0, total: 0 },
			artistImages: { fetched: 0, total: 0 },
			lastSyncAt: null,
			error: null,
		}),
		armLoginReturn: vi.fn().mockResolvedValue(undefined),
		reconcileArmedCandidates: vi.fn().mockResolvedValue(undefined),
		handleSpotifyTokenMessage: vi.fn().mockResolvedValue(undefined),
		updatePathfinderHash: vi.fn(),
		handleArmTokenPresent: vi.fn().mockResolvedValue(undefined),
		closeAndFocusHearted: vi.fn().mockResolvedValue({ ok: true }),
		getSpotifyProfile: vi.fn().mockResolvedValue(null),
		getHeartedAccountStatus: vi
			.fn()
			.mockResolvedValue({ state: "disconnected" }),
		isPaired: vi.fn().mockResolvedValue(false),
		disconnectSpotify: vi.fn().mockResolvedValue(undefined),
		disconnectHearted: vi.fn().mockResolvedValue(undefined),
		tokenProvider: makeTokenProvider(true),
		...overrides,
	};
}

const sender: chrome.runtime.MessageSender = {
	tab: { id: 7, windowId: 1 },
} as any;

describe("dispatchExtensionMessage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("PING returns PONG", async () => {
		const result = await dispatchExtensionMessage(
			{ type: "PING" },
			sender,
			makeDeps(),
		);
		expect(result).toEqual({ type: "PONG" });
	});

	it("CONNECT stores the token and rehydrates cached state", async () => {
		const deps = makeDeps();
		const result = await dispatchExtensionMessage(
			{
				type: "CONNECT",
				token: "abc123",
				backendUrl: "https://api.example.com",
			},
			sender,
			deps,
		);
		expect(deps.setConnectStorage).toHaveBeenCalledWith({
			apiToken: "abc123",
			backendUrl: "https://api.example.com",
		});
		expect(result).toEqual({ type: "CONNECTED" });
	});

	describe("TRIGGER_SYNC", () => {
		// Regression test for the live bug (deepening-opportunities-2026-07-02.md
		// finding #1): the reachable handler used to return `{ ok: true, ...result }`
		// even when the backend call failed, so callers could never observe the
		// failure. The unified dispatcher must report `ok: false` truthfully.
		it("reports ok:false with the backend failure when the sync backend rejects the request", async () => {
			const failure = {
				status: 429,
				code: "sync_cooldown" as const,
				message: "Too many syncs",
				retryAfterSeconds: 30,
			};
			const deps = makeDeps({
				performSync: vi.fn().mockResolvedValue({
					kind: "backend-failure",
					count: 0,
					failure,
				}),
			});

			const result = await dispatchExtensionMessage(
				{ type: "TRIGGER_SYNC" },
				sender,
				deps,
			);

			expect(result).toEqual({
				ok: false,
				source: "backend",
				count: 0,
				backendFailure: failure,
			});
		});

		it("reports ok:true on a successful sync", async () => {
			const deps = makeDeps({
				performSync: vi.fn().mockResolvedValue({
					kind: "success",
					count: 42,
					backendResult: { id: 1 },
				}),
			});

			const result = await dispatchExtensionMessage(
				{ type: "TRIGGER_SYNC" },
				sender,
				deps,
			);

			expect(result).toEqual({ ok: true, count: 42, backendResult: { id: 1 } });
		});

		it("reports ok:false, source:extension when performSync throws", async () => {
			const deps = makeDeps({
				performSync: vi
					.fn()
					.mockRejectedValue(new Error("Sync already in progress")),
			});

			const result = await dispatchExtensionMessage(
				{ type: "TRIGGER_SYNC" },
				sender,
				deps,
			);

			expect(result).toEqual({
				ok: false,
				source: "extension",
				error: "Sync already in progress",
			});
		});
	});

	it("EXPECT_LOGIN_RETURN refuses when sender has no tab/window", async () => {
		const result = await dispatchExtensionMessage(
			{ type: "EXPECT_LOGIN_RETURN", armToken: "tok" },
			{} as chrome.runtime.MessageSender,
			makeDeps(),
		);
		expect(result).toEqual({ ok: false, error: "no sender tab/window" });
	});

	it("EXPECT_LOGIN_RETURN refuses an empty armToken", async () => {
		const result = await dispatchExtensionMessage(
			{ type: "EXPECT_LOGIN_RETURN", armToken: "" },
			sender,
			makeDeps(),
		);
		expect(result).toEqual({ ok: false, error: "missing armToken" });
	});

	it("EXPECT_LOGIN_RETURN arms and reconciles when sender is valid", async () => {
		const deps = makeDeps();
		const result = await dispatchExtensionMessage(
			{ type: "EXPECT_LOGIN_RETURN", armToken: "tok" },
			sender,
			deps,
		);
		expect(deps.armLoginReturn).toHaveBeenCalledWith({
			originTabId: 7,
			originWindowId: 1,
			armToken: "tok",
		});
		expect(deps.reconcileArmedCandidates).toHaveBeenCalled();
		expect(result).toEqual({ ok: true });
	});

	it("SPOTIFY_STATUS reports no session", async () => {
		const deps = makeDeps({
			hasSpotifySession: vi.fn().mockResolvedValue(false),
			isPaired: vi.fn().mockResolvedValue(true),
		});
		const result = await dispatchExtensionMessage(
			{ type: "SPOTIFY_STATUS" },
			sender,
			deps,
		);
		expect(deps.clearSpotifyTokenCache).toHaveBeenCalled();
		expect(result).toEqual({
			type: "SPOTIFY_STATUS",
			hasToken: false,
			paired: true,
		});
	});

	it("SPOTIFY_STATUS attaches the profile + pairing when a session is usable", async () => {
		const profile = {
			spotifyId: "u1",
			displayName: "fabio",
			username: "fabio",
			avatarUrl: null,
		};
		const deps = makeDeps({
			isPaired: vi.fn().mockResolvedValue(true),
			getSpotifyProfile: vi.fn().mockResolvedValue(profile),
		});
		const result = await dispatchExtensionMessage(
			{ type: "SPOTIFY_STATUS" },
			sender,
			deps,
		);
		expect(result).toEqual({
			type: "SPOTIFY_STATUS",
			hasToken: true,
			hasSession: true,
			paired: true,
			profile,
		});
	});

	it("GET_ACCOUNTS returns Spotify profile + hearted status", async () => {
		const profile = {
			spotifyId: "u1",
			displayName: "fabio",
			username: "fabio",
			avatarUrl: null,
		};
		const hearted = {
			state: "connected" as const,
			verified: true,
			account: { displayName: "fabio", imageUrl: null, spotifyId: "u1" },
		};
		const deps = makeDeps({
			getSpotifyProfile: vi.fn().mockResolvedValue(profile),
			getHeartedAccountStatus: vi.fn().mockResolvedValue(hearted),
		});
		const result = await dispatchExtensionMessage(
			{ type: "GET_ACCOUNTS" },
			sender,
			deps,
		);
		expect(result).toEqual({ type: "ACCOUNTS", spotify: profile, hearted });
	});

	it("GET_ACCOUNTS omits a stale Spotify profile once the session is gone", async () => {
		const deps = makeDeps({
			hasSpotifySession: vi.fn().mockResolvedValue(false),
			getSpotifyProfile: vi.fn().mockResolvedValue({
				spotifyId: "u1",
				displayName: "fabio",
				username: "fabio",
				avatarUrl: null,
			}),
		});
		const result = await dispatchExtensionMessage(
			{ type: "GET_ACCOUNTS" },
			sender,
			deps,
		);
		expect(deps.clearSpotifyTokenCache).toHaveBeenCalled();
		expect(deps.getSpotifyProfile).not.toHaveBeenCalled();
		expect(result).toMatchObject({ type: "ACCOUNTS", spotify: null });
	});

	it("DISCONNECT_SPOTIFY / DISCONNECT_HEARTED delegate and ack", async () => {
		const deps = makeDeps();
		expect(
			await dispatchExtensionMessage(
				{ type: "DISCONNECT_SPOTIFY" },
				sender,
				deps,
			),
		).toEqual({ ok: true });
		expect(deps.disconnectSpotify).toHaveBeenCalled();
		expect(
			await dispatchExtensionMessage(
				{ type: "DISCONNECT_HEARTED" },
				sender,
				deps,
			),
		).toEqual({ ok: true });
		expect(deps.disconnectHearted).toHaveBeenCalled();
	});

	it("GET_STATUS returns token + sync state", async () => {
		const result = await dispatchExtensionMessage(
			{ type: "GET_STATUS" },
			sender,
			makeDeps(),
		);
		expect(result).toMatchObject({ hasToken: true, sync: { status: "idle" } });
	});

	it("GET_TOKEN returns null when token invalid", async () => {
		const deps = makeDeps({ isTokenValid: () => false });
		const result = await dispatchExtensionMessage(
			{ type: "GET_TOKEN" },
			sender,
			deps,
		);
		expect(result).toEqual({ token: null });
	});

	it("CLOSE_AND_FOCUS_HEARTED delegates to deps", async () => {
		const deps = makeDeps();
		const result = await dispatchExtensionMessage(
			{ type: "CLOSE_AND_FOCUS_HEARTED" },
			sender,
			deps,
		);
		expect(deps.closeAndFocusHearted).toHaveBeenCalledWith(sender);
		expect(result).toEqual({ ok: true });
	});

	it("SPOTIFY_TOKEN delegates to deps and acks", async () => {
		const deps = makeDeps();
		const payload = {
			accessToken: "x",
			expiresAtMs: Date.now() + 1000,
			isAnonymous: false,
		};
		const result = await dispatchExtensionMessage(
			{ type: "SPOTIFY_TOKEN", payload },
			sender,
			deps,
		);
		expect(deps.handleSpotifyTokenMessage).toHaveBeenCalledWith(
			payload,
			sender,
		);
		expect(result).toEqual({ ok: true });
	});

	it("PATHFINDER_HASH delegates synchronously", async () => {
		const deps = makeDeps();
		const payload = { operationName: "op", sha256Hash: "hash" };
		const result = await dispatchExtensionMessage(
			{ type: "PATHFINDER_HASH", payload },
			sender,
			deps,
		);
		expect(deps.updatePathfinderHash).toHaveBeenCalledWith(payload);
		expect(result).toEqual({ ok: true });
	});

	it("ARM_TOKEN_PRESENT rejects when sender tab is missing", async () => {
		const result = await dispatchExtensionMessage(
			{ type: "ARM_TOKEN_PRESENT", token: "abc" },
			{} as chrome.runtime.MessageSender,
			makeDeps(),
		);
		expect(result).toEqual({ ok: false });
	});
});

describe("parseExtensionWireMessage", () => {
	it("parses a well-formed message", () => {
		expect(parseExtensionWireMessage({ type: "PING" })).toEqual({
			type: "PING",
		});
	});

	it("parses the account messages", () => {
		expect(parseExtensionWireMessage({ type: "GET_ACCOUNTS" })).toEqual({
			type: "GET_ACCOUNTS",
		});
		expect(parseExtensionWireMessage({ type: "DISCONNECT_SPOTIFY" })).toEqual({
			type: "DISCONNECT_SPOTIFY",
		});
		expect(parseExtensionWireMessage({ type: "DISCONNECT_HEARTED" })).toEqual({
			type: "DISCONNECT_HEARTED",
		});
	});

	it("returns null for unrecognized shapes", () => {
		expect(
			parseExtensionWireMessage({ type: "NOT_A_REAL_MESSAGE" }),
		).toBeNull();
		expect(parseExtensionWireMessage("not an object")).toBeNull();
		expect(parseExtensionWireMessage({ type: "CONNECT" })).toBeNull(); // missing token
	});
});

describe("handleInboundMessage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns undefined for unrecognized payloads", async () => {
		const result = await handleInboundMessage(
			{ type: "UNKNOWN" },
			sender,
			makeDeps(),
		);
		expect(result).toBeUndefined();
	});

	it("propagates TRIGGER_SYNC backend failure through the full front door", async () => {
		const failure = {
			status: 500,
			code: "unknown" as const,
			message: "boom",
			retryAfterSeconds: null,
		};
		const deps = makeDeps({
			performSync: vi
				.fn()
				.mockResolvedValue({ kind: "backend-failure", count: 0, failure }),
		});
		const result = await handleInboundMessage(
			{ type: "TRIGGER_SYNC" },
			sender,
			deps,
		);
		expect(result).toEqual({
			ok: false,
			source: "backend",
			count: 0,
			backendFailure: failure,
		});
	});

	it("returns a structured INVALID_PARAMS error for a malformed SPOTIFY_COMMAND", async () => {
		const result = await handleInboundMessage(
			{ type: "SPOTIFY_COMMAND", command: "nope", commandId: "cmd-1" },
			sender,
			makeDeps(),
		);
		expect(result).toMatchObject({
			ok: false,
			errorCode: "INVALID_PARAMS",
			commandId: "cmd-1",
		});
	});
});
