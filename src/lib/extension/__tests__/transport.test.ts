import { afterEach, describe, expect, it, vi } from "vitest";
import {
	BRIDGE_SOURCE,
	isPageMessage,
	type PageCommandMessage,
} from "../../../../shared/extension-bridge-protocol";

type WindowWithChrome = typeof globalThis & { chrome?: unknown };

let cleanupBridge: (() => void) | null = null;

afterEach(() => {
	cleanupBridge?.();
	cleanupBridge = null;
	vi.unstubAllEnvs();
	vi.useRealTimers();
	delete (window as WindowWithChrome).chrome;
	vi.resetModules();
});

// Fresh module per test so EXTENSION_ID (read from import.meta.env at module
// top) and the bridge-nonce cache don't leak across cases.
async function loadTransport() {
	const mod = await import("../transport");
	return mod.sendExtensionCommand;
}

describe("sendExtensionCommand — chrome path", () => {
	it("forwards to chrome.runtime.sendMessage with the configured extension id", async () => {
		vi.stubEnv("VITE_CHROME_EXTENSION_ID", "ext-123");
		let received: { id: string; msg: unknown } | null = null;
		(window as WindowWithChrome).chrome = {
			runtime: {
				sendMessage: (id: string, msg: unknown, cb: (r: unknown) => void) => {
					received = { id, msg };
					cb({ type: "PONG" });
				},
			},
		};
		const send = await loadTransport();
		const res = await send({ type: "PING" });
		expect(received).toEqual({ id: "ext-123", msg: { type: "PING" } });
		expect(res).toEqual({ type: "PONG" });
	});

	it("resolves null on chrome lastError (extension not installed)", async () => {
		vi.stubEnv("VITE_CHROME_EXTENSION_ID", "ext-123");
		(window as WindowWithChrome).chrome = {
			runtime: {
				lastError: { message: "Could not establish connection" },
				sendMessage: (_id: string, _msg: unknown, cb: (r: unknown) => void) =>
					cb(undefined),
			},
		};
		const send = await loadTransport();
		expect(await send({ type: "PING" })).toBeNull();
	});

	it("resolves null without calling sendMessage when no extension id is set", async () => {
		vi.stubEnv("VITE_CHROME_EXTENSION_ID", "");
		const sendMessage = vi.fn();
		(window as WindowWithChrome).chrome = { runtime: { sendMessage } };
		const send = await loadTransport();
		expect(await send({ type: "PING" })).toBeNull();
		expect(sendMessage).not.toHaveBeenCalled();
	});
});

// jsdom's window.postMessage delivers events with source=null, but the real
// bridge posts to the same window where source===window. Replies are dispatched
// with an explicit source so transport's source===window guard (a genuine
// security check) is exercised rather than bypassed.
function bridgeReply(data: unknown): void {
	window.dispatchEvent(
		new MessageEvent("message", {
			data,
			origin: window.location.origin,
			source: window,
		}),
	);
}

describe("sendExtensionCommand — firefox bridge path", () => {
	it("handshakes for a nonce and correlates the response by id", async () => {
		// No window.chrome → bridge path. A stand-in bridge listener mimics the
		// app-bridge content script: answers hello with READY, echoes commands.
		const nonce = "test-nonce";
		const commands: PageCommandMessage[] = [];
		const bridge = (event: MessageEvent) => {
			const data = event.data;
			if (!isPageMessage(data)) return;
			if (data.kind === "hello") {
				bridgeReply({ source: BRIDGE_SOURCE, kind: "ready", nonce });
				return;
			}
			commands.push(data);
			bridgeReply({
				source: BRIDGE_SOURCE,
				kind: "response",
				id: data.id,
				response: { ok: true, echo: data.payload },
			});
		};
		window.addEventListener("message", bridge);
		cleanupBridge = () => window.removeEventListener("message", bridge);

		const send = await loadTransport();
		const res = await send({ type: "TRIGGER_SYNC" });

		expect(res).toEqual({ ok: true, echo: { type: "TRIGGER_SYNC" } });
		expect(commands).toHaveLength(1);
		expect(commands[0].nonce).toBe(nonce);
	});

	it("ignores bridge responses whose id does not match the request", async () => {
		const nonce = "test-nonce";
		const bridge = (event: MessageEvent) => {
			const data = event.data;
			if (!isPageMessage(data)) return;
			if (data.kind === "hello") {
				bridgeReply({ source: BRIDGE_SOURCE, kind: "ready", nonce });
				return;
			}
			// Reply with a mismatched id, then the correct one — only the latter
			// should resolve the awaiting command.
			bridgeReply({
				source: BRIDGE_SOURCE,
				kind: "response",
				id: "other",
				response: 1,
			});
			bridgeReply({
				source: BRIDGE_SOURCE,
				kind: "response",
				id: data.id,
				response: { matched: true },
			});
		};
		window.addEventListener("message", bridge);
		cleanupBridge = () => window.removeEventListener("message", bridge);

		const send = await loadTransport();
		expect(await send({ type: "GET_STATUS" })).toEqual({ matched: true });
	});

	it("resolves null when no bridge answers within the ready timeout", async () => {
		vi.useFakeTimers();
		const send = await loadTransport();
		const pending = send({ type: "PING" });
		await vi.advanceTimersByTimeAsync(1100);
		expect(await pending).toBeNull();
	});

	it("maps a bridge error envelope to null (unreachable contract)", async () => {
		const bridge = (event: MessageEvent) => {
			const data = event.data;
			if (!isPageMessage(data)) return;
			if (data.kind === "hello") {
				bridgeReply({ source: BRIDGE_SOURCE, kind: "ready", nonce: "n" });
				return;
			}
			bridgeReply({
				source: BRIDGE_SOURCE,
				kind: "response",
				id: data.id,
				response: { __bridgeError: "Receiving end does not exist" },
			});
		};
		window.addEventListener("message", bridge);
		cleanupBridge = () => window.removeEventListener("message", bridge);

		const send = await loadTransport();
		expect(await send({ type: "GET_STATUS" })).toBeNull();
	});
});
