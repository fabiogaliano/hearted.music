/**
 * Tests for useSongPlaylistSuggestions after 05-liked-songs-matching.md: the
 * per-song useSpotifyReconnectState poll is gone — a reconnect-required
 * add-to-playlist pushes into the shared connection state
 * (reportSpotifyAuthFailure) instead of setting a local flag, and the
 * panel's reconnectNeeded mirrors the shared verdict (spotify-disconnected)
 * rather than the one song that happened to fail. A successful Spotify write
 * pushes reportSpotifyAuthSuccess so a sticky failure can't outlive it.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSongSuggestions = vi.fn();
const mockAddSongToPlaylist = vi.fn();
const mockAddToPlaylist = vi.fn();
const mockOutcomeFromCommandResponse = vi.fn();
const mockUseExtensionConnection = vi.fn();
const mockReportSpotifyAuthFailure = vi.fn();
const mockReportSpotifyAuthSuccess = vi.fn();

vi.mock("@/lib/server/matching.functions", () => ({
	getSongSuggestions: (...args: unknown[]) => mockGetSongSuggestions(...args),
	addSongToPlaylist: (...args: unknown[]) => mockAddSongToPlaylist(...args),
}));

vi.mock("@/lib/extension/spotify-client", () => ({
	addToPlaylist: (...args: unknown[]) => mockAddToPlaylist(...args),
}));

vi.mock("@/lib/extension/spotify-action-outcome", () => ({
	outcomeFromCommandResponse: (...args: unknown[]) =>
		mockOutcomeFromCommandResponse(...args),
}));

vi.mock("@/lib/extension/connection/useExtensionConnection", () => ({
	useExtensionConnection: (...args: unknown[]) =>
		mockUseExtensionConnection(...args),
}));

vi.mock("@/lib/extension/connection/report-failure", () => ({
	reportSpotifyAuthFailure: (...args: unknown[]) =>
		mockReportSpotifyAuthFailure(...args),
	reportSpotifyAuthSuccess: (...args: unknown[]) =>
		mockReportSpotifyAuthSuccess(...args),
}));

import { useSongPlaylistSuggestions } from "../useSongPlaylistSuggestions";

function makeWrapper() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return {
		queryClient,
		Wrapper: ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		),
	};
}

const SONG = { id: "song-1", spotifyTrackId: "sp-track-1" };
const SUGGESTIONS_RESULT = {
	snapshotId: "snap-1",
	matches: [
		{
			playlistId: "pl-1",
			playlistName: "Chill",
			playlistSpotifyId: "sp-pl-1",
			fitScore: 0.8,
		},
	],
};

beforeEach(() => {
	mockGetSongSuggestions.mockReset().mockResolvedValue(SUGGESTIONS_RESULT);
	mockAddSongToPlaylist.mockReset().mockResolvedValue(undefined);
	mockAddToPlaylist.mockReset();
	mockOutcomeFromCommandResponse.mockReset();
	mockUseExtensionConnection.mockReset().mockReturnValue({
		connection: undefined,
		verdict: { kind: "ok" },
		refetch: vi.fn(),
	});
	mockReportSpotifyAuthFailure.mockReset();
	mockReportSpotifyAuthSuccess.mockReset();
});

describe("useSongPlaylistSuggestions — reconnectNeeded mirrors the shared verdict", () => {
	it("is true when the shared verdict is spotify-disconnected, false for ok", async () => {
		mockUseExtensionConnection.mockReturnValue({
			connection: undefined,
			verdict: { kind: "spotify-disconnected" },
			refetch: vi.fn(),
		});
		const { Wrapper } = makeWrapper();
		const { result } = renderHook(
			() => useSongPlaylistSuggestions(SONG, true, "linked-spotify-id"),
			{ wrapper: Wrapper },
		);

		await waitFor(() => expect(result.current).toBeDefined());
		expect(result.current?.reconnectNeeded).toBe(true);
	});

	it("is false when the shared verdict is ok", async () => {
		const { Wrapper } = makeWrapper();
		const { result } = renderHook(
			() => useSongPlaylistSuggestions(SONG, true, "linked-spotify-id"),
			{ wrapper: Wrapper },
		);

		await waitFor(() => expect(result.current).toBeDefined());
		expect(result.current?.reconnectNeeded).toBe(false);
	});

	it("passes linkedSpotifyId through to useExtensionConnection (so a mismatch is actually derivable, not silently 'ok')", async () => {
		const { Wrapper } = makeWrapper();
		renderHook(
			() => useSongPlaylistSuggestions(SONG, true, "linked-spotify-id"),
			{
				wrapper: Wrapper,
			},
		);

		await waitFor(() =>
			expect(mockUseExtensionConnection).toHaveBeenCalledWith(
				"linked-spotify-id",
			),
		);
	});
});

describe("useSongPlaylistSuggestions — onAdd auth-failure push", () => {
	it("pushes reportSpotifyAuthFailure on a reconnect-required outcome and leaves the song unadded (row stays actionable)", async () => {
		mockAddToPlaylist.mockResolvedValue({
			ok: false,
			errorCode: "AUTH_REQUIRED",
		});
		mockOutcomeFromCommandResponse.mockReturnValue({
			status: "reconnect-required",
		});
		const { Wrapper } = makeWrapper();
		const { result } = renderHook(
			() => useSongPlaylistSuggestions(SONG, true, "linked-spotify-id"),
			{ wrapper: Wrapper },
		);
		await waitFor(() => expect(result.current).toBeDefined());

		await act(async () => {
			await result.current?.onAdd("pl-1");
		});

		expect(mockReportSpotifyAuthFailure).toHaveBeenCalledTimes(1);
		expect(mockReportSpotifyAuthSuccess).not.toHaveBeenCalled();
		// Bails before the DB write — the song must not be marked added.
		expect(mockAddSongToPlaylist).not.toHaveBeenCalled();
		expect(result.current?.addedTo).toEqual([]);
	});

	it("pushes reportSpotifyAuthSuccess on a successful Spotify write, then still records the decision server-side", async () => {
		mockAddToPlaylist.mockResolvedValue({ ok: true });
		mockOutcomeFromCommandResponse.mockReturnValue({ status: "success" });
		const { Wrapper } = makeWrapper();
		const { result } = renderHook(
			() => useSongPlaylistSuggestions(SONG, true, "linked-spotify-id"),
			{ wrapper: Wrapper },
		);
		await waitFor(() => expect(result.current).toBeDefined());

		await act(async () => {
			await result.current?.onAdd("pl-1");
		});

		expect(mockReportSpotifyAuthSuccess).toHaveBeenCalledTimes(1);
		expect(mockReportSpotifyAuthFailure).not.toHaveBeenCalled();
		expect(mockAddSongToPlaylist).toHaveBeenCalledWith({
			data: { songId: "song-1", playlistId: "pl-1", snapshotId: "snap-1" },
		});
	});

	it("a non-auth error neither pushes nor records the decision (unchanged pre-existing handling)", async () => {
		mockAddToPlaylist.mockResolvedValue({
			ok: false,
			errorCode: "INVALID_TARGET",
		});
		mockOutcomeFromCommandResponse.mockReturnValue({
			status: "error",
			errorCode: "INVALID_TARGET",
		});
		const { Wrapper } = makeWrapper();
		const { result } = renderHook(
			() => useSongPlaylistSuggestions(SONG, true, "linked-spotify-id"),
			{ wrapper: Wrapper },
		);
		await waitFor(() => expect(result.current).toBeDefined());

		await act(async () => {
			await result.current?.onAdd("pl-1");
		});

		expect(mockReportSpotifyAuthFailure).not.toHaveBeenCalled();
		expect(mockReportSpotifyAuthSuccess).not.toHaveBeenCalled();
		expect(mockAddSongToPlaylist).not.toHaveBeenCalled();
	});
});

// Post-review fix (CRITICAL, invariant 2): threading the real linkedSpotifyId
// (above) makes `mismatch` reachable here for the first time — the
// extension's live Spotify session can now genuinely differ from the song's
// linked account. Nothing blocked the write under that verdict originally:
// onAdd would write through addToPlaylist using the extension's live (wrong)
// token, then still record the song "added" in the DB — a phantom write on
// someone else's Spotify account, the same class of bug phase 04's studio
// CRITICAL finding closed for playlist create. Closed here the same way:
// onAdd refuses the write outright under `mismatch`, and the panel exposes
// `mismatch`/`onRecheck` so SongDetailPanelSurface can render
// AccountMismatchPrompt instead of Add.
describe("useSongPlaylistSuggestions — account mismatch blocks the write (post-review fix)", () => {
	const MISMATCH_PROFILE = {
		spotifyId: "wrong-id",
		displayName: "Someone Else",
	};

	beforeEach(() => {
		mockUseExtensionConnection.mockReset().mockReturnValue({
			connection: undefined,
			verdict: { kind: "mismatch", extensionProfile: MISMATCH_PROFILE },
			refetch: vi.fn(),
		});
	});

	it("never calls addToPlaylist or records the decision, and neither push fires", async () => {
		const { Wrapper } = makeWrapper();
		const { result } = renderHook(
			() => useSongPlaylistSuggestions(SONG, true, "linked-spotify-id"),
			{ wrapper: Wrapper },
		);
		await waitFor(() => expect(result.current).toBeDefined());

		await act(async () => {
			await result.current?.onAdd("pl-1");
		});

		expect(mockAddToPlaylist).not.toHaveBeenCalled();
		expect(mockAddSongToPlaylist).not.toHaveBeenCalled();
		expect(mockReportSpotifyAuthFailure).not.toHaveBeenCalled();
		expect(mockReportSpotifyAuthSuccess).not.toHaveBeenCalled();
		expect(result.current?.addedTo).toEqual([]);
	});

	it("blocks the write even when the Spotify command would have reported success (defense-in-depth: the gate, not the outcome, decides)", async () => {
		mockAddToPlaylist.mockResolvedValue({ ok: true });
		mockOutcomeFromCommandResponse.mockReturnValue({ status: "success" });
		const { Wrapper } = makeWrapper();
		const { result } = renderHook(
			() => useSongPlaylistSuggestions(SONG, true, "linked-spotify-id"),
			{ wrapper: Wrapper },
		);
		await waitFor(() => expect(result.current).toBeDefined());

		await act(async () => {
			await result.current?.onAdd("pl-1");
		});

		expect(mockAddToPlaylist).not.toHaveBeenCalled();
		expect(mockAddSongToPlaylist).not.toHaveBeenCalled();
		expect(mockReportSpotifyAuthSuccess).not.toHaveBeenCalled();
	});

	it("exposes the extension's live profile via `mismatch`, and `onRecheck` drives the shared refetch", async () => {
		const refetch = vi.fn().mockResolvedValue(undefined);
		mockUseExtensionConnection.mockReset().mockReturnValue({
			connection: undefined,
			verdict: { kind: "mismatch", extensionProfile: MISMATCH_PROFILE },
			refetch,
		});
		const { Wrapper } = makeWrapper();
		const { result } = renderHook(
			() => useSongPlaylistSuggestions(SONG, true, "linked-spotify-id"),
			{ wrapper: Wrapper },
		);
		await waitFor(() => expect(result.current).toBeDefined());

		expect(result.current?.mismatch).toEqual({
			extensionProfile: MISMATCH_PROFILE,
		});
		expect(result.current?.reconnectNeeded).toBe(false);

		await act(async () => {
			await result.current?.onRecheck();
		});
		expect(refetch).toHaveBeenCalledTimes(1);
	});

	it("`mismatch` is null for every other verdict", async () => {
		mockUseExtensionConnection.mockReset().mockReturnValue({
			connection: undefined,
			verdict: { kind: "ok" },
			refetch: vi.fn(),
		});
		const { Wrapper } = makeWrapper();
		const { result } = renderHook(
			() => useSongPlaylistSuggestions(SONG, true, "linked-spotify-id"),
			{ wrapper: Wrapper },
		);
		await waitFor(() => expect(result.current).toBeDefined());

		expect(result.current?.mismatch).toBeNull();
	});
});
