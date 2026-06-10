/**
 * Page ⇄ extension bridge protocol.
 *
 * Firefox does not implement `externally_connectable` /
 * `runtime.onMessageExternal`, so the hearted web app cannot message the
 * extension directly the way it does on Chrome. Instead a Firefox-only content
 * script (`extensions/src/content/app-bridge.ts`) is injected into the hearted
 * origins and relays `window.postMessage` traffic to/from the background via
 * `runtime.sendMessage`.
 *
 * This module is the single source of truth for the wire shapes, shared by all
 * three participants: the web-app transport (page world), the bridge content
 * script (extension isolated world), and the background dispatcher.
 *
 * Security model — mirrors what `externally_connectable` gave for free:
 *  - the bridge only runs on the allow-listed origins (manifest `matches`)
 *  - it rejects messages whose `event.source !== window` (iframes/other frames)
 *  - it rejects messages whose `event.origin` is not allow-listed
 *  - a per-load `nonce` minted by the bridge and handed to the page in the READY
 *    handshake is required on every command, so blind/replayed forgery from an
 *    unrelated injected script is rejected.
 */

// window.postMessage `source` tags. Distinct page→bridge vs bridge→page tags so
// neither side ever processes its own emitted messages (postMessage echoes to
// the same window).
export const PAGE_SOURCE = "hearted-page";
export const BRIDGE_SOURCE = "hearted-bridge";

// runtime.sendMessage envelope tag: lets the background dispatcher distinguish
// relayed web-app commands from the extension's own internal content-script
// messages (SPOTIFY_TOKEN, PATHFINDER_HASH, ARM_TOKEN_PRESENT).
export const BRIDGE_ENVELOPE_TAG = "hearted-bridge-command";

export type PageHelloMessage = {
	source: typeof PAGE_SOURCE;
	kind: "hello";
};

export type PageCommandMessage = {
	source: typeof PAGE_SOURCE;
	kind: "command";
	id: string;
	nonce: string;
	payload: unknown;
};

export type PageMessage = PageHelloMessage | PageCommandMessage;

export type BridgeReadyMessage = {
	source: typeof BRIDGE_SOURCE;
	kind: "ready";
	nonce: string;
};

export type BridgeResponseMessage = {
	source: typeof BRIDGE_SOURCE;
	kind: "response";
	id: string;
	response: unknown;
};

export type BridgeMessage = BridgeReadyMessage | BridgeResponseMessage;

export type BridgeEnvelope = {
	__heartedBridge: typeof BRIDGE_ENVELOPE_TAG;
	payload: unknown;
};

// Posted by the bridge in place of a real response when its relay to the
// background fails (extension reloading, background dead, …). The transport
// maps it back to `null` so callers keep the "null ⇔ unreachable" contract.
export type BridgeErrorResponse = {
	__bridgeError: string;
};

export function isBridgeErrorResponse(
	value: unknown,
): value is BridgeErrorResponse {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { __bridgeError?: unknown }).__bridgeError === "string"
	);
}

export function isBridgeEnvelope(value: unknown): value is BridgeEnvelope {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { __heartedBridge?: unknown }).__heartedBridge ===
			BRIDGE_ENVELOPE_TAG
	);
}

export function isPageMessage(value: unknown): value is PageMessage {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	if (v.source !== PAGE_SOURCE) return false;
	if (v.kind === "hello") return true;
	if (v.kind === "command") {
		return typeof v.id === "string" && typeof v.nonce === "string";
	}
	return false;
}

export function isBridgeMessage(value: unknown): value is BridgeMessage {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	if (v.source !== BRIDGE_SOURCE) return false;
	if (v.kind === "ready") return typeof v.nonce === "string";
	if (v.kind === "response") return typeof v.id === "string";
	return false;
}

/**
 * Origin allow-list, kept in lock-step with the bridge content script's
 * manifest `matches`: production `hearted.music` (+ subdomains) over https, and
 * `localhost` / `127.0.0.1` over http for local development. Any port is
 * allowed for the dev origins since Vite picks one at runtime.
 */
export function isAllowedBridgeOrigin(origin: string): boolean {
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return false;
	}
	if (url.protocol === "https:") {
		return url.hostname === "hearted.music" || url.hostname.endsWith(".hearted.music");
	}
	if (url.protocol === "http:") {
		return url.hostname === "localhost" || url.hostname === "127.0.0.1";
	}
	return false;
}
