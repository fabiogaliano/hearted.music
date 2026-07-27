import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPairExtension, mockExpectLoginReturn } = vi.hoisted(() => ({
	mockPairExtension: vi.fn(),
	mockExpectLoginReturn: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../connect", () => ({
	pairExtension: () => mockPairExtension(),
}));

vi.mock("../../detect", () => ({
	expectLoginReturn: (armToken: string) => mockExpectLoginReturn(armToken),
}));

import {
	getAuthFailedAt,
	resetAuthFailedAtForTests,
	setAuthFailedAt,
} from "../auth-failed-store";
import { extensionConnectionKey } from "../connection-state";
import { repairConnection } from "../repair";

const SPOTIFY_URL = "https://accounts.spotify.com/en/login";
const TEST_TOKEN = "11111111-2222-3333-4444-555555555555";

function client() {
	return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	mockPairExtension.mockReset().mockResolvedValue({ ok: true });
	mockExpectLoginReturn.mockClear();
	openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
	vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(TEST_TOKEN);
	resetAuthFailedAtForTests();
});

afterEach(() => {
	vi.restoreAllMocks();
	resetAuthFailedAtForTests();
});

describe("repairConnection — spotify-disconnected", () => {
	it("opens an armed Spotify URL and fires pairExtension", async () => {
		const qc = client();

		const promise = repairConnection({
			verdict: { kind: "spotify-disconnected" },
			queryClient: qc,
			spotifyLoginUrl: SPOTIFY_URL,
		});

		expect(openSpy).toHaveBeenCalledWith(
			`${SPOTIFY_URL}#hearted-arm=${TEST_TOKEN}`,
			"_blank",
			"noopener,noreferrer",
		);
		expect(mockPairExtension).toHaveBeenCalledOnce();
		await promise;
	});

	it("clears a sticky authFailedAt — the user is acting on the prompt", async () => {
		setAuthFailedAt(Date.now());
		const qc = client();

		await repairConnection({
			verdict: { kind: "spotify-disconnected" },
			queryClient: qc,
			spotifyLoginUrl: SPOTIFY_URL,
		});

		expect(getAuthFailedAt()).toBeNull();
	});

	it("invalidates the connection query after pairing settles", async () => {
		const qc = client();
		const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

		await repairConnection({
			verdict: { kind: "spotify-disconnected" },
			queryClient: qc,
			spotifyLoginUrl: SPOTIFY_URL,
		});

		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: extensionConnectionKey,
		});
	});
});

describe("repairConnection — invariant 1: window.open fires synchronously, never after an awaited pair", () => {
	it("has already called window.open by the time repairConnection returns, before the pairing promise gets a chance to settle", () => {
		// Order pinned via a shared log, not just "was it called" — a version that
		// inserted `await pairExtension()` before `window.open` would still
		// produce a call to both eventually, but `open-called` would be missing
		// from this synchronous checkpoint (it would only land after a
		// microtask flush this test never performs).
		const order: string[] = [];
		mockPairExtension.mockImplementation(() => {
			order.push("pair-called");
			return new Promise((resolve) => {
				queueMicrotask(() => {
					order.push("pair-resolved");
					resolve({ ok: true });
				});
			});
		});
		openSpy.mockImplementation(() => {
			order.push("open-called");
			return null;
		});
		const qc = client();

		// Deliberately not awaited: the whole point is to inspect state
		// synchronously, right after the call returns, before any microtask runs.
		void repairConnection({
			verdict: { kind: "spotify-disconnected" },
			queryClient: qc,
			spotifyLoginUrl: SPOTIFY_URL,
		});

		expect(order).toEqual(["open-called", "pair-called"]);
	});
});

describe("repairConnection — unpaired", () => {
	it("does not open Spotify; pairs and invalidates", async () => {
		const qc = client();
		const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

		await repairConnection({
			verdict: { kind: "unpaired" },
			queryClient: qc,
			spotifyLoginUrl: SPOTIFY_URL,
		});

		expect(openSpy).not.toHaveBeenCalled();
		expect(mockPairExtension).toHaveBeenCalledOnce();
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: extensionConnectionKey,
		});
	});
});

describe("repairConnection — unverifiable", () => {
	it("does not open Spotify; pairs and invalidates (old-extension tolerance, invariant 6)", async () => {
		const qc = client();

		await repairConnection({
			verdict: { kind: "unverifiable" },
			queryClient: qc,
			spotifyLoginUrl: SPOTIFY_URL,
		});

		expect(openSpy).not.toHaveBeenCalled();
		expect(mockPairExtension).toHaveBeenCalledOnce();
	});
});

describe("repairConnection — mismatch", () => {
	it("opens Spotify to switch accounts, and never touches pairing", async () => {
		const qc = client();

		await repairConnection({
			verdict: {
				kind: "mismatch",
				extensionProfile: {
					spotifyId: "wrong-id",
					displayName: "Wrong Person",
					avatarUrl: null,
				},
			},
			queryClient: qc,
			spotifyLoginUrl: SPOTIFY_URL,
		});

		expect(openSpy).toHaveBeenCalledWith(
			`${SPOTIFY_URL}#hearted-arm=${TEST_TOKEN}`,
			"_blank",
			"noopener,noreferrer",
		);
		expect(mockPairExtension).not.toHaveBeenCalled();
	});

	it("clears a sticky authFailedAt on the switch-account path too", async () => {
		setAuthFailedAt(Date.now());
		const qc = client();

		await repairConnection({
			verdict: {
				kind: "mismatch",
				extensionProfile: {
					spotifyId: "wrong-id",
					displayName: "Wrong Person",
					avatarUrl: null,
				},
			},
			queryClient: qc,
			spotifyLoginUrl: SPOTIFY_URL,
		});

		expect(getAuthFailedAt()).toBeNull();
	});
});

describe.each([
	{ kind: "ok" as const },
	{ kind: "checking" as const },
	{ kind: "extension-missing" as const },
])("repairConnection — no-op verdicts ($kind)", (verdict) => {
	it("does not open Spotify or pair, and the returned promise still resolves", async () => {
		const qc = client();

		const promise = repairConnection({
			verdict,
			queryClient: qc,
			spotifyLoginUrl: SPOTIFY_URL,
		});

		await expect(promise).resolves.toBeUndefined();
		expect(openSpy).not.toHaveBeenCalled();
		expect(mockPairExtension).not.toHaveBeenCalled();
	});
});

describe("repairConnection — pairExtension rejects", () => {
	it("still invalidates the connection query (finally)", async () => {
		mockPairExtension.mockRejectedValue(new Error("network down"));
		const qc = client();
		const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

		await repairConnection({
			verdict: { kind: "unpaired" },
			queryClient: qc,
			spotifyLoginUrl: SPOTIFY_URL,
		}).catch(() => {});

		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: extensionConnectionKey,
		});
	});
});
