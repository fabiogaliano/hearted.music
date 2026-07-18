import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpotifyAccountStatus } from "../detect";

const { mockIsExtensionInstalled, mockGetSpotifyAccountStatus } = vi.hoisted(
	() => ({
		mockIsExtensionInstalled: vi.fn(),
		mockGetSpotifyAccountStatus: vi.fn(),
	}),
);

vi.mock("../detect", () => ({
	isExtensionInstalled: () => mockIsExtensionInstalled(),
	getSpotifyAccountStatus: () => mockGetSpotifyAccountStatus(),
}));

import { useExtensionAccountConflict } from "../useExtensionAccountConflict";

function status(
	overrides: Partial<SpotifyAccountStatus>,
): SpotifyAccountStatus {
	return {
		connected: true,
		paired: true,
		profile: {
			spotifyId: "linked-1",
			displayName: "fabio",
			avatarUrl: null,
		},
		...overrides,
	};
}

describe("useExtensionAccountConflict", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyAccountStatus.mockResolvedValue(status({}));
	});

	afterEach(() => {
		vi.useRealTimers();
		mockIsExtensionInstalled.mockReset();
		mockGetSpotifyAccountStatus.mockReset();
	});

	async function flush() {
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});
	}

	it("does not require an account check before Spotify is linked", async () => {
		const { result } = renderHook(() => useExtensionAccountConflict(null));
		await flush();
		expect(result.current.check).toEqual({ kind: "not-required" });
		expect(mockIsExtensionInstalled).not.toHaveBeenCalled();
	});

	it("fails closed while the first identity check is pending", () => {
		mockIsExtensionInstalled.mockReturnValue(new Promise(() => {}));
		const { result } = renderHook(() =>
			useExtensionAccountConflict("linked-1"),
		);
		expect(result.current.check).toEqual({ kind: "checking" });
	});

	it("verifies matching Spotify and hearted identities", async () => {
		const { result } = renderHook(() =>
			useExtensionAccountConflict("linked-1"),
		);
		await flush();
		expect(result.current.check).toEqual({ kind: "verified" });
	});

	it("flags a Spotify mismatch when the captured account differs", async () => {
		mockGetSpotifyAccountStatus.mockResolvedValue(
			status({
				profile: { spotifyId: "other-2", displayName: "alex", avatarUrl: null },
			}),
		);
		const { result } = renderHook(() =>
			useExtensionAccountConflict("linked-1"),
		);
		await flush();
		expect(result.current.check).toEqual({
			kind: "conflict",
			conflict: {
				kind: "spotify-mismatch",
				extensionProfile: {
					spotifyId: "other-2",
					displayName: "alex",
					avatarUrl: null,
				},
			},
		});
	});

	it("flags unpaired when paired is explicitly false", async () => {
		mockGetSpotifyAccountStatus.mockResolvedValue(
			status({ paired: false, profile: null }),
		);
		const { result } = renderHook(() =>
			useExtensionAccountConflict("linked-1"),
		);
		await flush();
		expect(result.current.check).toEqual({
			kind: "conflict",
			conflict: { kind: "unpaired" },
		});
	});

	it("keeps mismatch higher priority than an unpaired state", async () => {
		mockGetSpotifyAccountStatus.mockResolvedValue(
			status({
				paired: false,
				profile: { spotifyId: "other-2", displayName: "alex", avatarUrl: null },
			}),
		);
		const { result } = renderHook(() =>
			useExtensionAccountConflict("linked-1"),
		);
		await flush();
		expect(result.current.check).toMatchObject({
			kind: "conflict",
			conflict: { kind: "spotify-mismatch" },
		});
	});

	it.each([
		["an unreachable extension status", null],
		["a missing Spotify profile", status({ profile: null })],
		["an extension without pairing status", status({ paired: null })],
	] as const)("fails closed for %s", async (_label, accountStatus) => {
		mockGetSpotifyAccountStatus.mockResolvedValue(accountStatus);
		const { result } = renderHook(() =>
			useExtensionAccountConflict("linked-1"),
		);
		await flush();
		expect(result.current.check).toEqual({ kind: "unavailable" });
	});

	it("reports unavailable when the extension isn't installed", async () => {
		mockIsExtensionInstalled.mockResolvedValue(false);
		const { result } = renderHook(() =>
			useExtensionAccountConflict("linked-1"),
		);
		await flush();
		expect(result.current.check).toEqual({ kind: "unavailable" });
		expect(mockGetSpotifyAccountStatus).not.toHaveBeenCalled();
	});

	it("clears a conflict once the accounts agree on the next poll", async () => {
		mockGetSpotifyAccountStatus.mockResolvedValue(
			status({
				profile: { spotifyId: "other-2", displayName: "alex", avatarUrl: null },
			}),
		);
		const { result } = renderHook(() =>
			useExtensionAccountConflict("linked-1"),
		);
		await flush();
		expect(result.current.check).toMatchObject({ kind: "conflict" });

		mockGetSpotifyAccountStatus.mockResolvedValue(status({}));
		await act(async () => {
			vi.advanceTimersByTime(6_000);
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(result.current.check).toEqual({ kind: "verified" });
	});
});
