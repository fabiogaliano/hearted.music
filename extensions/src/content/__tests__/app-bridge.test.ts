import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BRIDGE_ENVELOPE_TAG,
	BRIDGE_SOURCE,
	PAGE_SOURCE,
} from "../../../../shared/extension-bridge-protocol";

// Exercises the Firefox-only app-bridge content script in the node env. The
// script only reads event.source/origin/data and calls a few window/crypto/
// browser APIs, so a minimal fake window (rather than jsdom) is enough — and it
// keeps the test inside the extension's own tsconfig (which carries the chrome
// types the script needs) instead of dragging extension source into the web
// app's typecheck.

type FakeEvent = { source: unknown; origin: string; data: unknown };
type Listener = (event: FakeEvent) => void;

const sendMessage = vi.fn();
const posted: Array<Record<string, unknown>> = [];
let messageListener: Listener | null = null;
let nonce: string;

const fakeWindow = {
	addEventListener: (type: string, cb: Listener) => {
		if (type === "message") messageListener = cb;
	},
	removeEventListener: () => {},
	postMessage: (message: Record<string, unknown>) => {
		posted.push(message);
	},
	location: { origin: "https://hearted.music" },
};

beforeAll(async () => {
	const g = globalThis as { window?: unknown; chrome?: unknown };
	g.window = fakeWindow;
	g.chrome = { runtime: { sendMessage } };
	await import("../app-bridge");
	nonce = posted.find((m) => m.kind === "ready")?.nonce as string;
});

beforeEach(() => {
	sendMessage.mockReset();
	posted.length = 0;
});

function deliver(
	data: unknown,
	opts: { origin?: string; source?: unknown } = {},
): void {
	messageListener?.({
		data,
		origin: opts.origin ?? "https://hearted.music",
		source: "source" in opts ? opts.source : fakeWindow,
	});
}

describe("app-bridge content script", () => {
	it("posts a READY message with a nonce on load", () => {
		expect(typeof nonce).toBe("string");
		expect(nonce.length).toBeGreaterThan(0);
	});

	it("answers hello with READY carrying the same nonce", () => {
		deliver({ source: PAGE_SOURCE, kind: "hello" });
		expect(posted.at(-1)).toEqual({
			source: BRIDGE_SOURCE,
			kind: "ready",
			nonce,
		});
	});

	it("relays a valid command and posts the response with the matching id", async () => {
		sendMessage.mockResolvedValue({ type: "PONG" });
		deliver({
			source: PAGE_SOURCE,
			kind: "command",
			id: "req-1",
			nonce,
			payload: { type: "PING" },
		});
		expect(sendMessage).toHaveBeenCalledWith({
			__heartedBridge: BRIDGE_ENVELOPE_TAG,
			payload: { type: "PING" },
		});
		await vi.waitFor(() => {
			expect(posted.find((m) => m.kind === "response")).toEqual({
				source: BRIDGE_SOURCE,
				kind: "response",
				id: "req-1",
				response: { type: "PONG" },
			});
		});
	});

	it("ignores commands from a disallowed origin", () => {
		deliver(
			{ source: PAGE_SOURCE, kind: "command", id: "x", nonce, payload: {} },
			{ origin: "https://evil.com" },
		);
		expect(sendMessage).not.toHaveBeenCalled();
	});

	it("ignores messages whose source is not the window (iframes/other frames)", () => {
		deliver(
			{ source: PAGE_SOURCE, kind: "command", id: "x", nonce, payload: {} },
			{ source: null },
		);
		expect(sendMessage).not.toHaveBeenCalled();
	});

	it("ignores commands carrying a wrong nonce", () => {
		deliver({
			source: PAGE_SOURCE,
			kind: "command",
			id: "x",
			nonce: "not-the-nonce",
			payload: {},
		});
		expect(sendMessage).not.toHaveBeenCalled();
	});

	it("ignores malformed page messages", () => {
		deliver({ source: PAGE_SOURCE, kind: "command" });
		deliver({ foo: "bar" });
		deliver("just a string");
		expect(sendMessage).not.toHaveBeenCalled();
	});
});
