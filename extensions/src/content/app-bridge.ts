/**
 * Firefox-only page⇄extension bridge (replaces externally_connectable, which
 * Firefox does not implement). Injected into the hearted origins in the
 * isolated content-script world, it relays `window.postMessage` commands from
 * the page to the background via `runtime.sendMessage`, and posts responses
 * back. Excluded from the Chrome build, which keeps using onMessageExternal.
 *
 * See shared/extension-bridge-protocol.ts for the wire shapes and the security
 * rationale (origin allow-list, source===window, per-load nonce).
 */

import {
	BRIDGE_ENVELOPE_TAG,
	BRIDGE_SOURCE,
	type BridgeErrorResponse,
	type BridgeMessage,
	isAllowedBridgeOrigin,
	isPageMessage,
} from "../../../shared/extension-bridge-protocol";
import { browser } from "../shared/browser";

// Per-load nonce handed to the page in the READY handshake and required on
// every command. Regenerated on each content-script load so a stale page
// (e.g. an extension reload) can't replay against a fresh bridge.
const nonce = crypto.randomUUID();
const targetOrigin = window.location.origin;

function post(message: BridgeMessage): void {
	window.postMessage(message, targetOrigin);
}

function postReady(): void {
	post({ source: BRIDGE_SOURCE, kind: "ready", nonce });
}

window.addEventListener("message", (event: MessageEvent) => {
	// Reject anything not posted by this exact window (iframes, other frames).
	if (event.source !== window) return;
	if (!isAllowedBridgeOrigin(event.origin)) return;

	const data: unknown = event.data;
	if (!isPageMessage(data)) return;

	if (data.kind === "hello") {
		// The page just mounted its listener and is asking for the nonce. The
		// unsolicited READY below covers the reverse race (page already listening
		// at document_start); this covers the common case where the page's React
		// app mounts well after the bridge.
		postReady();
		return;
	}

	if (data.nonce !== nonce) return;

	const { id, payload } = data;
	browser.runtime
		.sendMessage({ __heartedBridge: BRIDGE_ENVELOPE_TAG, payload })
		.then((response) => {
			post({ source: BRIDGE_SOURCE, kind: "response", id, response });
		})
		.catch((err: unknown) => {
			// Surface the failure to the awaiting page rather than letting it time
			// out — keeps Firefox detection latency in line with Chrome's lastError.
			const response: BridgeErrorResponse = {
				__bridgeError: err instanceof Error ? err.message : String(err),
			};
			post({ source: BRIDGE_SOURCE, kind: "response", id, response });
		});
});

postReady();

console.log("[hearted.] App bridge content script loaded");
