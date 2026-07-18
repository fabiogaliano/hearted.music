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

	it("stays null before the account has linked Spotify", async () => {
		const { result } = renderHook(() => useExtensionAccountConflict(null));
		await flush();
		expect(result.current.conflict).toBeNull();
		expect(mockIsExtensionInstalled).not.toHaveBeenCalled();
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
		expect(result.current.conflict).toEqual({
			kind: "spotify-mismatch",
			extensionProfile: {
				spotifyId: "other-2",
				displayName: "alex",
				avatarUrl: null,
			},
		});
	});

	it("flags unpaired when paired is explicitly false and Spotify matches", async () => {
		mockGetSpotifyAccountStatus.mockResolvedValue(
			status({ paired: false, profile: null }),
		);
		const { result } = renderHook(() =>
			useExtensionAccountConflict("linked-1"),
		);
		await flush();
		expect(result.current.conflict).toEqual({ kind: "unpaired" });
	});

	it("mismatch outranks unpaired", async () => {
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
		expect(result.current.conflict).toMatchObject({ kind: "spotify-mismatch" });
	});

	it("treats a missing paired field (older extension) as no conflict", async () => {
		mockGetSpotifyAccountStatus.mockResolvedValue(
			status({ paired: null, profile: null }),
		);
		const { result } = renderHook(() =>
			useExtensionAccountConflict("linked-1"),
		);
		await flush();
		expect(result.current.conflict).toBeNull();
	});

	it("stays null when the extension isn't installed", async () => {
		mockIsExtensionInstalled.mockResolvedValue(false);
		const { result } = renderHook(() =>
			useExtensionAccountConflict("linked-1"),
		);
		await flush();
		expect(result.current.conflict).toBeNull();
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
		expect(result.current.conflict).toMatchObject({ kind: "spotify-mismatch" });

		mockGetSpotifyAccountStatus.mockResolvedValue(status({}));
		await act(async () => {
			vi.advanceTimersByTime(6_000);
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(result.current.conflict).toBeNull();
	});
});
