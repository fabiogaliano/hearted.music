// Single exhaustive dispatcher for the extension's control-message vocabulary
// (see shared/types.ts `ExtensionWireMessage`). Both front doors — the web
// app's `runtime.onMessageExternal` / app-bridge envelope, and the extension's
// own `runtime.onMessage` (popup, content scripts) — funnel through
// `dispatchExtensionMessage` so each message type has exactly one
// implementation and one response contract. Modeled on
// `command-handler.ts`'s `handleSpotifyCommand`: side effects live behind an
// injected `deps` bag so the switch itself is unit-testable without mocking
// the WebExtension globals.
import type {
	ExtensionSyncBackendFailure,
	ExtensionSyncRequestResult,
} from "../../../shared/extension-sync-contract";
import { parseSpotifyCommand } from "../../../shared/spotify-command-protocol";
import type { SyncState } from "../shared/storage";
import type {
	AccountsResponse,
	ExtensionWireMessage,
	HeartedAccountStatus,
	SpotifyTokenPayload,
	StatusResponse,
	UserProfile,
} from "../shared/types";
import type { TokenProvider } from "./command-handler";
import { handleSpotifyCommand } from "./command-handler";

export type SyncBackendFailure = ExtensionSyncBackendFailure;

export type SyncResult =
	| { kind: "success"; count: number; backendResult?: unknown }
	| { kind: "backend-failure"; count: number; failure: SyncBackendFailure };

/** Capabilities the dispatcher needs from the service worker's mutable state
 * and side-effecting collaborators. Constructed once in service-worker.ts. */
export type DispatcherDeps = {
	isValidBackendUrl: (value: unknown) => value is string;
	normalizeBackendUrl: (url: string) => string;
	setConnectStorage: (payload: {
		apiToken: string;
		backendUrl?: string;
	}) => Promise<void>;
	rehydrateTokenIfMissing: () => Promise<void>;
	flushPendingSyncDiagnostics: () => void;
	performSync: () => Promise<SyncResult>;
	hasSpotifySession: () => Promise<boolean>;
	clearSpotifyTokenCache: () => Promise<void>;
	isTokenValid: () => boolean;
	getCachedToken: () => SpotifyTokenPayload | null;
	getSyncState: () => Promise<SyncState>;
	armLoginReturn: (input: {
		originTabId: number;
		originWindowId: number;
		armToken: string;
	}) => Promise<void>;
	reconcileArmedCandidates: (input: {
		originTabId: number;
		originWindowId: number;
	}) => Promise<void>;
	handleSpotifyTokenMessage: (
		payload: SpotifyTokenPayload,
		sender: chrome.runtime.MessageSender,
	) => Promise<void>;
	updatePathfinderHash: (payload: {
		operationName: string;
		sha256Hash: string;
	}) => void;
	handleArmTokenPresent: (
		token: string,
		sender: chrome.runtime.MessageSender,
	) => Promise<void>;
	closeAndFocusHearted: (
		sender: chrome.runtime.MessageSender,
	) => Promise<{ ok: true } | { ok: false; error: string }>;
	/** Cached-or-fetched Spotify profile for the current token; null when the
	 * token is missing/anonymous/expired or the profile fetch failed. */
	getSpotifyProfile: () => Promise<UserProfile | null>;
	/** Live pairing check against the backend (GET /api/extension/status). */
	getHeartedAccountStatus: () => Promise<HeartedAccountStatus>;
	/** apiToken presence — cheap storage read, no network. */
	isPaired: () => Promise<boolean>;
	disconnectSpotify: () => Promise<void>;
	disconnectHearted: () => Promise<void>;
	tokenProvider: TokenProvider;
};

function toSyncRequestResult(result: SyncResult): ExtensionSyncRequestResult {
	if (result.kind === "success") {
		return {
			ok: true,
			count: result.count,
			backendResult: result.backendResult,
		};
	}
	return {
		ok: false,
		source: "backend",
		count: result.count,
		backendFailure: result.failure,
	};
}

async function dispatchTriggerSync(
	deps: DispatcherDeps,
): Promise<ExtensionSyncRequestResult> {
	await deps.rehydrateTokenIfMissing();
	try {
		const result = await deps.performSync();
		return toSyncRequestResult(result);
	} catch (err) {
		const error = err instanceof Error ? err.message : "Unknown error";
		return { ok: false, source: "extension", error };
	}
}

function assertNever(value: never): never {
	throw new Error(`Unhandled extension message: ${JSON.stringify(value)}`);
}

/**
 * Dispatch a single control message and return the payload to send back to
 * the caller (web app, popup, or content script). Every case returns a
 * concrete, truthful response — most importantly TRIGGER_SYNC always reports
 * `ok: false` on a backend failure instead of spreading a `{ kind:
 * "backend-failure" }` result under an `ok: true` envelope.
 */
export async function dispatchExtensionMessage(
	message: ExtensionWireMessage,
	sender: chrome.runtime.MessageSender,
	deps: DispatcherDeps,
): Promise<unknown> {
	switch (message.type) {
		case "PING":
			return { type: "PONG" };

		case "CONNECT": {
			const backendUrl = deps.isValidBackendUrl(message.backendUrl)
				? deps.normalizeBackendUrl(message.backendUrl)
				: undefined;
			await deps.setConnectStorage({ apiToken: message.token, backendUrl });
			await deps.rehydrateTokenIfMissing();
			deps.flushPendingSyncDiagnostics();
			return { type: "CONNECTED" };
		}

		case "TRIGGER_SYNC":
			return dispatchTriggerSync(deps);

		case "SPOTIFY_STATUS": {
			// `paired` rides along so the web app can spot a popup-side hearted
			// disconnect from the poll it already runs, without the backend hit
			// GET_ACCOUNTS implies.
			const paired = await deps.isPaired();
			const hasSession = await deps.hasSpotifySession();
			if (!hasSession) {
				await deps.clearSpotifyTokenCache();
				return { type: "SPOTIFY_STATUS", hasToken: false, paired };
			}
			await deps.rehydrateTokenIfMissing();
			const token = deps.getCachedToken();
			const hasUsableToken =
				token !== null && deps.isTokenValid() && !token.isAnonymous;
			if (!hasUsableToken && token) {
				await deps.clearSpotifyTokenCache();
			}
			return {
				type: "SPOTIFY_STATUS",
				hasToken: hasUsableToken,
				hasSession: true,
				paired,
				profile: hasUsableToken ? await deps.getSpotifyProfile() : null,
			};
		}

		case "EXPECT_LOGIN_RETURN": {
			const originTabId = sender.tab?.id;
			const originWindowId = sender.tab?.windowId;
			if (
				typeof originTabId !== "number" ||
				typeof originWindowId !== "number"
			) {
				// External arming must come from a hearted tab — without tab+window
				// ids we cannot scope binding to that window, so refuse to arm.
				return { ok: false, error: "no sender tab/window" };
			}
			if (message.armToken.length === 0) {
				return { ok: false, error: "missing armToken" };
			}
			await deps.armLoginReturn({
				originTabId,
				originWindowId,
				armToken: message.armToken,
			});
			await deps.reconcileArmedCandidates({ originTabId, originWindowId });
			return { ok: true };
		}

		case "GET_STATUS": {
			await deps.rehydrateTokenIfMissing();
			const token = deps.getCachedToken();
			const state = await deps.getSyncState();
			const response: StatusResponse = {
				hasToken: deps.isTokenValid(),
				tokenExpiresAtMs: token?.expiresAtMs ?? null,
			};
			return { ...response, sync: state };
		}

		case "GET_TOKEN": {
			const token = deps.getCachedToken();
			return deps.isTokenValid() && token
				? { token: token.accessToken }
				: { token: null };
		}

		case "CLOSE_AND_FOCUS_HEARTED":
			return deps.closeAndFocusHearted(sender);

		case "SPOTIFY_TOKEN":
			await deps.handleSpotifyTokenMessage(message.payload, sender);
			return { ok: true };

		case "PATHFINDER_HASH":
			deps.updatePathfinderHash(message.payload);
			return { ok: true };

		case "ARM_TOKEN_PRESENT": {
			const token = message.token;
			const senderTabId = sender.tab?.id;
			if (typeof senderTabId !== "number" || token.length === 0) {
				return { ok: false };
			}
			await deps.handleArmTokenPresent(token, sender);
			return { ok: true };
		}

		case "GET_ACCOUNTS": {
			// Mirror SPOTIFY_STATUS's session gate so a signed-out browser never
			// reports a stale captured profile as the current Spotify account.
			const hasSession = await deps.hasSpotifySession();
			if (!hasSession) await deps.clearSpotifyTokenCache();
			await deps.rehydrateTokenIfMissing();
			const spotify = hasSession ? await deps.getSpotifyProfile() : null;
			const hearted = await deps.getHeartedAccountStatus();
			const response: AccountsResponse = {
				type: "ACCOUNTS",
				spotify,
				hearted,
			};
			return response;
		}

		case "DISCONNECT_SPOTIFY":
			await deps.disconnectSpotify();
			return { ok: true };

		case "DISCONNECT_HEARTED":
			await deps.disconnectHearted();
			return { ok: true };

		case "SPOTIFY_COMMAND":
			return handleSpotifyCommand(message, deps.tokenProvider);

		default:
			return assertNever(message);
	}
}

/**
 * Parses an arbitrary inbound payload (the wire format is trusted-but-unknown
 * at the front doors) into a typed `ExtensionWireMessage`, or `null` when it
 * doesn't match any known message shape — mirrors `parseSpotifyCommand`'s
 * "validate the seam, don't trust the caller" pattern.
 */
export function parseExtensionWireMessage(
	input: unknown,
): ExtensionWireMessage | null {
	if (typeof input !== "object" || input === null) return null;
	const v = input as Record<string, unknown>;
	if (typeof v.type !== "string") return null;

	switch (v.type) {
		case "PING":
			return { type: "PING" };
		case "CONNECT":
			if (typeof v.token !== "string") return null;
			return {
				type: "CONNECT",
				token: v.token,
				backendUrl: typeof v.backendUrl === "string" ? v.backendUrl : undefined,
			};
		case "TRIGGER_SYNC":
			return { type: "TRIGGER_SYNC" };
		case "SPOTIFY_STATUS":
			return { type: "SPOTIFY_STATUS" };
		case "EXPECT_LOGIN_RETURN":
			return {
				type: "EXPECT_LOGIN_RETURN",
				armToken: typeof v.armToken === "string" ? v.armToken : "",
			};
		case "GET_STATUS":
			return { type: "GET_STATUS" };
		case "GET_TOKEN":
			return { type: "GET_TOKEN" };
		case "CLOSE_AND_FOCUS_HEARTED":
			return { type: "CLOSE_AND_FOCUS_HEARTED" };
		case "SPOTIFY_TOKEN": {
			const payload = v.payload as SpotifyTokenPayload | undefined;
			if (!payload || typeof payload.accessToken !== "string") return null;
			return { type: "SPOTIFY_TOKEN", payload };
		}
		case "PATHFINDER_HASH": {
			const payload = v.payload as
				| { operationName: string; sha256Hash: string }
				| undefined;
			if (!payload || typeof payload.operationName !== "string") return null;
			return { type: "PATHFINDER_HASH", payload };
		}
		case "ARM_TOKEN_PRESENT":
			if (typeof v.token !== "string") return null;
			return { type: "ARM_TOKEN_PRESENT", token: v.token };
		case "GET_ACCOUNTS":
			return { type: "GET_ACCOUNTS" };
		case "DISCONNECT_SPOTIFY":
			return { type: "DISCONNECT_SPOTIFY" };
		case "DISCONNECT_HEARTED":
			return { type: "DISCONNECT_HEARTED" };
		case "SPOTIFY_COMMAND": {
			const parsed = parseSpotifyCommand(input);
			return parsed.ok ? parsed.value : null;
		}
		default:
			return null;
	}
}

/**
 * Full front-door entry point: parses an arbitrary inbound payload and
 * dispatches it. Returns `undefined` for payloads that don't match any known
 * message shape (mirrors the previous "unrecognized external command" no-op),
 * except SPOTIFY_COMMAND, which gets a structured INVALID_PARAMS response
 * (matching `handleSpotifyCommand`'s error contract) so a malformed command
 * still round-trips a `commandId` when the caller supplied one.
 */
export async function handleInboundMessage(
	rawMessage: unknown,
	sender: chrome.runtime.MessageSender,
	deps: DispatcherDeps,
): Promise<unknown> {
	if (
		typeof rawMessage === "object" &&
		rawMessage !== null &&
		(rawMessage as { type?: unknown }).type === "SPOTIFY_COMMAND"
	) {
		const parsed = parseSpotifyCommand(rawMessage);
		if (!parsed.ok) {
			const raw = rawMessage as { commandId?: unknown };
			const commandId =
				typeof raw.commandId === "string" ? raw.commandId : "invalid-command";
			return {
				ok: false,
				errorCode: "INVALID_PARAMS",
				message: parsed.error,
				retryable: false,
				commandId,
			};
		}
		return dispatchExtensionMessage(parsed.value, sender, deps);
	}

	const message = parseExtensionWireMessage(rawMessage);
	if (message === null) return undefined;
	return dispatchExtensionMessage(message, sender, deps);
}

export type { UserProfile };
