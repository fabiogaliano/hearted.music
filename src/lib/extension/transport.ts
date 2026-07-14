/**
 * Transparent web-app → extension transport.
 *
 * Two runtime paths sit behind one `sendExtensionCommand`:
 *  - **Chrome**: `chrome.runtime.sendMessage(EXTENSION_ID, …)` via
 *    externally_connectable. Absence resolves immediately (lastError).
 *  - **Firefox**: `window.postMessage` to the app-bridge content script, which
 *    relays to the background. Absence resolves `null` after a short timeout.
 *
 * Firefox web pages don't expose `window.chrome`, so the Chrome branch
 * fast-fails there and the bridge branch takes over. Callers in detect.ts stay
 * unaware of which path served them.
 */

// Type-only — the extension's control-message vocabulary, kept in one place
// (extensions/src/shared/types.ts) so the web-app transport and the
// background dispatcher agree on the wire shape instead of the app
// constructing untyped `Record<string, unknown>` literals.
import type { ExtensionWireMessage } from "../../../extensions/src/shared/types";
import {
	type BridgeMessage,
	isBridgeErrorResponse,
	isBridgeMessage,
	PAGE_SOURCE,
} from "../../../shared/extension-bridge-protocol";

const EXTENSION_ID =
	typeof import.meta.env.VITE_CHROME_EXTENSION_ID === "string" &&
	import.meta.env.VITE_CHROME_EXTENSION_ID.length > 0
		? import.meta.env.VITE_CHROME_EXTENSION_ID
		: "";

// "Installed?" detection rides entirely on the READY handshake: the bridge is a
// content script, always present on the page, and answers HELLO without waking
// the background — so a missing READY within ~1s means "not installed".
const BRIDGE_READY_TIMEOUT_MS = 1000;

// Per-command timeout is only a leak-guard for a silently-dead background (the
// bridge otherwise always posts a response, success or __bridgeError). It must
// comfortably exceed a full library sync — on Chrome TRIGGER_SYNC blocks
// runtime.sendMessage for the whole sync with no timeout at all, so we mustn't
// abort a legitimately long Firefox sync early. 5 min is a generous ceiling.
const BRIDGE_COMMAND_TIMEOUT_MS = 5 * 60_000;

type ChromeRuntime = {
	sendMessage: (
		extensionId: string,
		message: unknown,
		callback: (response: unknown) => void,
	) => void;
	lastError?: { message?: string };
};

function getChromeRuntime(): ChromeRuntime | null {
	if (typeof window === "undefined") return null;
	const chrome = (window as { chrome?: { runtime?: ChromeRuntime } }).chrome;
	if (chrome?.runtime?.sendMessage) return chrome.runtime;
	return null;
}

let warnedMissingExtensionId = false;

function sendViaChrome<T>(
	runtime: ChromeRuntime,
	message: ExtensionWireMessage,
): Promise<T | null> {
	if (!EXTENSION_ID) {
		// Reaching the Chrome path without an id means the env is misconfigured,
		// not that the extension is absent — say so once instead of failing mute.
		if (!warnedMissingExtensionId) {
			warnedMissingExtensionId = true;
			console.warn(
				"[hearted.] VITE_CHROME_EXTENSION_ID is empty — extension detection is disabled on Chrome",
			);
		}
		return Promise.resolve(null);
	}
	return new Promise<T | null>((resolve) => {
		runtime.sendMessage(EXTENSION_ID, message, (response) => {
			if (runtime.lastError) {
				resolve(null);
				return;
			}
			resolve((response ?? null) as T | null);
		});
	}).catch(() => null);
}

// ── Firefox bridge path ────────────────────────────────────────────────────

let bridgeNonce: string | null = null;
let readyHandshake: Promise<string | null> | null = null;

function postToBridge(message: unknown): void {
	window.postMessage(message, window.location.origin);
}

// Resolve (and cache) the bridge's per-load nonce via the HELLO→READY
// handshake. Resolves `null` when no bridge answers within the timeout — the
// Firefox equivalent of "extension not installed".
function ensureBridgeReady(): Promise<string | null> {
	if (bridgeNonce) return Promise.resolve(bridgeNonce);
	if (readyHandshake) return readyHandshake;

	readyHandshake = new Promise<string | null>((resolve) => {
		let settled = false;
		const finish = (value: string | null) => {
			if (settled) return;
			settled = true;
			window.clearTimeout(timer);
			window.removeEventListener("message", onReady);
			readyHandshake = null;
			resolve(value);
		};
		const timer = window.setTimeout(
			() => finish(null),
			BRIDGE_READY_TIMEOUT_MS,
		);
		const onReady = (event: MessageEvent) => {
			if (event.source !== window) return;
			const data: unknown = event.data;
			if (isBridgeMessage(data) && data.kind === "ready") {
				bridgeNonce = data.nonce;
				finish(data.nonce);
			}
		};
		window.addEventListener("message", onReady);
		postToBridge({ source: PAGE_SOURCE, kind: "hello" });
	});

	return readyHandshake;
}

function sendViaBridge<T>(message: ExtensionWireMessage): Promise<T | null> {
	return ensureBridgeReady().then((nonce) => {
		if (!nonce) return null;
		return new Promise<T | null>((resolve) => {
			const id = crypto.randomUUID();
			let settled = false;
			const finish = (value: T | null) => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timer);
				window.removeEventListener("message", onMessage);
				resolve(value);
			};
			const timer = window.setTimeout(
				() => finish(null),
				BRIDGE_COMMAND_TIMEOUT_MS,
			);
			const onMessage = (event: MessageEvent) => {
				if (event.source !== window) return;
				const data: unknown = event.data;
				if (!isBridgeMessage(data)) return;
				if (data.kind === "response" && data.id === id) {
					// Relay failures come back as an error envelope; map them to the
					// same `null` the Chrome path yields on lastError so the
					// "null ⇔ unreachable" contract holds for callers.
					if (isBridgeErrorResponse(data.response)) {
						console.warn(
							"[hearted.] Extension bridge error:",
							data.response.__bridgeError,
						);
						finish(null);
						return;
					}
					finish((data.response ?? null) as T | null);
				}
			};
			window.addEventListener("message", onMessage);
			postToBridge({
				source: PAGE_SOURCE,
				kind: "command",
				id,
				nonce,
				payload: message,
			});
		});
	});
}

/**
 * Send a command to the extension and await its response. Resolves `null` when
 * the extension is unreachable (Chrome: immediate lastError; Firefox: timeout).
 */
export function sendExtensionCommand<T = unknown>(
	message: ExtensionWireMessage,
): Promise<T | null> {
	if (typeof window === "undefined") return Promise.resolve(null);
	const runtime = getChromeRuntime();
	if (runtime) return sendViaChrome<T>(runtime, message);
	return sendViaBridge<T>(message);
}

export type { BridgeMessage };
