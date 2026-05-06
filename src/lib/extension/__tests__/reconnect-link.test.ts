import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockExpectLoginReturn } = vi.hoisted(() => {
	const mockExpectLoginReturn = vi.fn().mockResolvedValue(true);
	return { mockExpectLoginReturn };
});

vi.mock("../detect", () => ({
	expectLoginReturn: (armToken: string) => mockExpectLoginReturn(armToken),
}));

import type { MouseEvent } from "react";
import {
	ARM_TOKEN_FRAGMENT_PARAM,
	armReconnectOnActivation,
	buildArmedSpotifyUrl,
	shouldArmOnEvent,
} from "../reconnect-link";

const TEST_TOKEN = "11111111-2222-3333-4444-555555555555";
const SPOTIFY_URL = "https://open.spotify.com/";

function fakeEvent(
	type: string,
	button: number,
	detail: number,
): MouseEvent<HTMLElement> & { preventDefault: ReturnType<typeof vi.fn> } {
	return {
		type,
		button,
		detail,
		preventDefault: vi.fn(),
	} as MouseEvent<HTMLElement> & { preventDefault: ReturnType<typeof vi.fn> };
}

describe("shouldArmOnEvent (pure)", () => {
	it("arms on left click (button=0, detail>0 mouse activation)", () => {
		expect(shouldArmOnEvent({ type: "click", button: 0, detail: 1 })).toBe(
			true,
		);
	});

	it("arms on keyboard-activated click (button=0, detail=0)", () => {
		expect(shouldArmOnEvent({ type: "click", button: 0, detail: 0 })).toBe(
			true,
		);
	});

	it("does NOT arm on mousedown — canceled clicks must not arm", () => {
		expect(shouldArmOnEvent({ type: "mousedown", button: 0, detail: 1 })).toBe(
			false,
		);
	});

	it("arms on middle auxclick (button=1)", () => {
		expect(shouldArmOnEvent({ type: "auxclick", button: 1, detail: 1 })).toBe(
			true,
		);
	});

	it("does NOT arm on right auxclick (button=2)", () => {
		expect(shouldArmOnEvent({ type: "auxclick", button: 2, detail: 1 })).toBe(
			false,
		);
	});

	it("does NOT arm on contextmenu / pointerdown / other types", () => {
		expect(
			shouldArmOnEvent({ type: "contextmenu", button: 2, detail: 0 }),
		).toBe(false);
		expect(
			shouldArmOnEvent({ type: "pointerdown", button: 0, detail: 1 }),
		).toBe(false);
	});
});

describe("buildArmedSpotifyUrl", () => {
	it("appends hearted-arm fragment param to a clean Spotify base URL", () => {
		const href = buildArmedSpotifyUrl(SPOTIFY_URL, TEST_TOKEN);
		const url = new URL(href);
		expect(url.origin + url.pathname).toBe(SPOTIFY_URL);
		const params = new URLSearchParams(url.hash.replace(/^#/, ""));
		expect(params.get(ARM_TOKEN_FRAGMENT_PARAM)).toBe(TEST_TOKEN);
	});

	it("preserves and overwrites prior fragment params", () => {
		const href = buildArmedSpotifyUrl(
			"https://open.spotify.com/#foo=bar&hearted-arm=stale",
			TEST_TOKEN,
		);
		const url = new URL(href);
		const params = new URLSearchParams(url.hash.replace(/^#/, ""));
		expect(params.get("foo")).toBe("bar");
		expect(params.get(ARM_TOKEN_FRAGMENT_PARAM)).toBe(TEST_TOKEN);
	});

	it("arms the redirected Spotify destination inside accounts login continue param", () => {
		const href = buildArmedSpotifyUrl(
			"https://accounts.spotify.com/en-GB/login?continue=https%3A%2F%2Fopen.spotify.com%2F",
			TEST_TOKEN,
		);
		const url = new URL(href);
		expect(url.origin + url.pathname).toBe(
			"https://accounts.spotify.com/en-GB/login",
		);
		const continueUrl = new URL(url.searchParams.get("continue") ?? "");
		expect(continueUrl.origin + continueUrl.pathname).toBe(SPOTIFY_URL);
		const params = new URLSearchParams(continueUrl.hash.replace(/^#/, ""));
		expect(params.get(ARM_TOKEN_FRAGMENT_PARAM)).toBe(TEST_TOKEN);
	});
});

describe("armReconnectOnActivation (side effects)", () => {
	type RandomUuidSpy = {
		mockRestore: () => void;
		mockReturnValueOnce: (
			value: `${string}-${string}-${string}-${string}-${string}`,
		) => RandomUuidSpy;
	};
	let openSpy: { mockRestore: () => void };
	let randomUuidSpy: RandomUuidSpy;

	beforeEach(() => {
		mockExpectLoginReturn.mockClear();
		openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
		randomUuidSpy = vi
			.spyOn(globalThis.crypto, "randomUUID")
			.mockReturnValue(TEST_TOKEN);
	});

	afterEach(() => {
		openSpy.mockRestore();
		randomUuidSpy.mockRestore();
	});

	it("normal left click opens an armed URL and reports the generated token", () => {
		const handler = armReconnectOnActivation(SPOTIFY_URL);
		handler(fakeEvent("mousedown", 0, 1));
		expect(mockExpectLoginReturn).not.toHaveBeenCalled();

		const event = fakeEvent("click", 0, 1);
		handler(event);
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(mockExpectLoginReturn).toHaveBeenCalledOnce();
		expect(mockExpectLoginReturn).toHaveBeenCalledWith(TEST_TOKEN);
		expect(window.open).toHaveBeenCalledWith(
			`${SPOTIFY_URL}#hearted-arm=${TEST_TOKEN}`,
			"_blank",
			"noopener,noreferrer",
		);
	});

	it("middle auxclick arms with a fresh token", () => {
		const handler = armReconnectOnActivation(SPOTIFY_URL);
		const event = fakeEvent("auxclick", 1, 1);
		handler(event);
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(mockExpectLoginReturn).toHaveBeenCalledOnce();
		expect(mockExpectLoginReturn).toHaveBeenCalledWith(TEST_TOKEN);
	});

	it("canceled mousedown path does not arm (mousedown then no click)", () => {
		const handler = armReconnectOnActivation(SPOTIFY_URL);
		handler(fakeEvent("mousedown", 0, 1));
		// User dragged out / pressed Esc — no click event ever fires.
		expect(mockExpectLoginReturn).not.toHaveBeenCalled();
	});

	it("does not arm on right click", () => {
		const handler = armReconnectOnActivation(SPOTIFY_URL);
		handler(fakeEvent("click", 2, 1));
		handler(fakeEvent("auxclick", 2, 1));
		expect(mockExpectLoginReturn).not.toHaveBeenCalled();
	});

	it("keyboard activation (Enter on focused link) arms with a fresh token", () => {
		const handler = armReconnectOnActivation(SPOTIFY_URL);
		const event = fakeEvent("click", 0, 0);
		handler(event);
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(mockExpectLoginReturn).toHaveBeenCalledOnce();
		expect(mockExpectLoginReturn).toHaveBeenCalledWith(TEST_TOKEN);
	});

	it("each activation gets its own fresh token", () => {
		randomUuidSpy
			.mockReturnValueOnce("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
			.mockReturnValueOnce("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
		const handlerA = armReconnectOnActivation(SPOTIFY_URL);
		const handlerB = armReconnectOnActivation(SPOTIFY_URL);
		handlerA(fakeEvent("click", 0, 1));
		handlerB(fakeEvent("click", 0, 1));
		expect(mockExpectLoginReturn).toHaveBeenNthCalledWith(
			1,
			"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
		);
		expect(mockExpectLoginReturn).toHaveBeenNthCalledWith(
			2,
			"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
		);
	});
});
