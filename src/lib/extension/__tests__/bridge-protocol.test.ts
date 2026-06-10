import { describe, expect, it } from "vitest";
import {
	BRIDGE_ENVELOPE_TAG,
	BRIDGE_SOURCE,
	isAllowedBridgeOrigin,
	isBridgeEnvelope,
	isBridgeMessage,
	isPageMessage,
	PAGE_SOURCE,
} from "../../../../shared/extension-bridge-protocol";

describe("isAllowedBridgeOrigin", () => {
	it("allows production hearted.music and its subdomains over https", () => {
		expect(isAllowedBridgeOrigin("https://hearted.music")).toBe(true);
		expect(isAllowedBridgeOrigin("https://app.hearted.music")).toBe(true);
		expect(isAllowedBridgeOrigin("https://www.hearted.music")).toBe(true);
	});

	it("allows localhost and 127.0.0.1 over http (any port)", () => {
		expect(isAllowedBridgeOrigin("http://localhost:5173")).toBe(true);
		expect(isAllowedBridgeOrigin("http://127.0.0.1:3000")).toBe(true);
		expect(isAllowedBridgeOrigin("http://localhost")).toBe(true);
	});

	it("rejects look-alike and non-allowlisted origins", () => {
		expect(isAllowedBridgeOrigin("https://evil.com")).toBe(false);
		// Suffix attack: ends with "hearted.music" but not ".hearted.music".
		expect(isAllowedBridgeOrigin("https://evilhearted.music")).toBe(false);
		// Subdomain-of-attacker: hearted.music is a label, not the registrable domain.
		expect(isAllowedBridgeOrigin("https://hearted.music.evil.com")).toBe(false);
	});

	it("rejects production origin over http and dev hosts over https", () => {
		expect(isAllowedBridgeOrigin("http://hearted.music")).toBe(false);
		expect(isAllowedBridgeOrigin("https://localhost:5173")).toBe(false);
	});

	it("rejects non-http(s) protocols and malformed origins", () => {
		expect(isAllowedBridgeOrigin("ftp://hearted.music")).toBe(false);
		expect(isAllowedBridgeOrigin("not a url")).toBe(false);
		expect(isAllowedBridgeOrigin("")).toBe(false);
	});
});

describe("isPageMessage", () => {
	it("accepts a hello message", () => {
		expect(isPageMessage({ source: PAGE_SOURCE, kind: "hello" })).toBe(true);
	});

	it("accepts a well-formed command", () => {
		expect(
			isPageMessage({
				source: PAGE_SOURCE,
				kind: "command",
				id: "abc",
				nonce: "n",
				payload: { type: "PING" },
			}),
		).toBe(true);
	});

	it("rejects a command missing id or nonce", () => {
		expect(
			isPageMessage({ source: PAGE_SOURCE, kind: "command", nonce: "n" }),
		).toBe(false);
		expect(
			isPageMessage({ source: PAGE_SOURCE, kind: "command", id: "abc" }),
		).toBe(false);
	});

	it("rejects foreign source, unknown kind, and non-objects", () => {
		expect(isPageMessage({ source: BRIDGE_SOURCE, kind: "hello" })).toBe(false);
		expect(isPageMessage({ source: PAGE_SOURCE, kind: "nope" })).toBe(false);
		expect(isPageMessage(null)).toBe(false);
		expect(isPageMessage("hello")).toBe(false);
		expect(isPageMessage(undefined)).toBe(false);
	});
});

describe("isBridgeMessage", () => {
	it("accepts ready (with nonce) and response (with id)", () => {
		expect(
			isBridgeMessage({ source: BRIDGE_SOURCE, kind: "ready", nonce: "n" }),
		).toBe(true);
		expect(
			isBridgeMessage({
				source: BRIDGE_SOURCE,
				kind: "response",
				id: "abc",
				response: {},
			}),
		).toBe(true);
	});

	it("rejects ready without nonce and response without id", () => {
		expect(isBridgeMessage({ source: BRIDGE_SOURCE, kind: "ready" })).toBe(
			false,
		);
		expect(isBridgeMessage({ source: BRIDGE_SOURCE, kind: "response" })).toBe(
			false,
		);
	});

	it("rejects page-sourced and malformed messages", () => {
		expect(
			isBridgeMessage({ source: PAGE_SOURCE, kind: "ready", nonce: "n" }),
		).toBe(false);
		expect(isBridgeMessage(42)).toBe(false);
	});
});

describe("isBridgeEnvelope", () => {
	it("accepts the namespaced envelope and rejects internal messages", () => {
		expect(
			isBridgeEnvelope({ __heartedBridge: BRIDGE_ENVELOPE_TAG, payload: {} }),
		).toBe(true);
		expect(isBridgeEnvelope({ type: "SPOTIFY_TOKEN", payload: {} })).toBe(
			false,
		);
		expect(isBridgeEnvelope({ __heartedBridge: "wrong-tag" })).toBe(false);
		expect(isBridgeEnvelope(null)).toBe(false);
	});
});
