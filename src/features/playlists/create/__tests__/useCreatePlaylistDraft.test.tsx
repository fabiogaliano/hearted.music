/**
 * Tests for useCreatePlaylistDraft — currently just the "Refresh suggestions"
 * paging seam, which had no coverage before.
 *
 * previewPlaylistDraft is mocked so the hook is exercised without a server;
 * the assertion reads the suggestionsOffset each call was made with, which is
 * the hook's only observable trace of its internal paging state.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SUGGESTIONS_COUNT } from "@/lib/domains/playlists/constants";
import type { PlaylistDraftPreview } from "@/lib/server/playlist-draft.functions";

const previewPlaylistDraftMock = vi.fn();

vi.mock("@/lib/server/playlist-draft.functions", () => ({
	previewPlaylistDraft: (...args: unknown[]) =>
		previewPlaylistDraftMock(...args),
}));

const resolveLikedArtistSongsMock = vi.fn();

vi.mock("@/lib/server/playlists.functions", () => ({
	resolveLikedArtistSongs: (...args: unknown[]) =>
		resolveLikedArtistSongsMock(...args),
	searchLikedArtists: vi.fn(),
}));

import { useCreatePlaylistDraft } from "../useCreatePlaylistDraft";

const EMPTY_RESULT: PlaylistDraftPreview = {
	tracklist: [],
	suggestions: [],
	totalEligible: 0,
	intentApplied: false,
	droppedPinnedSongIds: [],
};

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}

describe("useCreatePlaylistDraft — refreshSuggestions paging", () => {
	beforeEach(() => {
		previewPlaylistDraftMock.mockReset();
		previewPlaylistDraftMock.mockResolvedValue(EMPTY_RESULT);
		queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
	});

	it("advances suggestionsOffset by exactly SUGGESTIONS_COUNT per call", async () => {
		const { result } = renderHook(() => useCreatePlaylistDraft(), {
			wrapper,
		});

		await waitFor(() => expect(result.current.isLoading).toBe(false));
		expect(previewPlaylistDraftMock).toHaveBeenLastCalledWith({
			data: expect.objectContaining({ suggestionsOffset: 0 }),
		});

		act(() => {
			result.current.refreshSuggestions();
		});
		await waitFor(() =>
			expect(previewPlaylistDraftMock).toHaveBeenLastCalledWith({
				data: expect.objectContaining({ suggestionsOffset: SUGGESTIONS_COUNT }),
			}),
		);

		act(() => {
			result.current.refreshSuggestions();
		});
		await waitFor(() =>
			expect(previewPlaylistDraftMock).toHaveBeenLastCalledWith({
				data: expect.objectContaining({
					suggestionsOffset: 2 * SUGGESTIONS_COUNT,
				}),
			}),
		);
	});
});

describe("useCreatePlaylistDraft — artist selections", () => {
	beforeEach(() => {
		previewPlaylistDraftMock.mockReset();
		previewPlaylistDraftMock.mockResolvedValue(EMPTY_RESULT);
		resolveLikedArtistSongsMock.mockReset();
		queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
	});

	it("addArtist resolves filter-aware song ids and pins the allocation", async () => {
		resolveLikedArtistSongsMock.mockResolvedValue({
			artists: [{ name: "Radiohead", songIds: ["r1", "r2"] }],
		});

		const { result } = renderHook(() => useCreatePlaylistDraft(), { wrapper });
		await waitFor(() => expect(result.current.isLoading).toBe(false));

		act(() => {
			result.current.addArtist("Radiohead");
		});

		await waitFor(() =>
			expect(previewPlaylistDraftMock).toHaveBeenLastCalledWith({
				data: expect.objectContaining({
					pinnedSongIds: ["r1", "r2"],
					manualPinnedSongIds: [],
				}),
			}),
		);
		expect(resolveLikedArtistSongsMock).toHaveBeenLastCalledWith({
			data: expect.objectContaining({ artists: ["Radiohead"] }),
		});
		await waitFor(() =>
			expect(result.current.artistSelections).toEqual([
				{ name: "Radiohead", enabled: true, songCount: 2 },
			]),
		);
	});

	it("interleaves two artists' pins round-robin", async () => {
		resolveLikedArtistSongsMock.mockResolvedValue({
			artists: [
				{ name: "A", songIds: ["a1", "a2"] },
				{ name: "B", songIds: ["b1", "b2"] },
			],
		});

		const { result } = renderHook(() => useCreatePlaylistDraft(), { wrapper });
		await waitFor(() => expect(result.current.isLoading).toBe(false));

		act(() => {
			result.current.addArtist("A");
			result.current.addArtist("B");
		});

		await waitFor(() =>
			expect(previewPlaylistDraftMock).toHaveBeenLastCalledWith({
				data: expect.objectContaining({
					pinnedSongIds: ["a1", "b1", "a2", "b2"],
				}),
			}),
		);
	});

	it("toggleArtist off removes its pins without touching manual pins", async () => {
		resolveLikedArtistSongsMock.mockResolvedValue({
			artists: [{ name: "A", songIds: ["a1"] }],
		});

		const { result } = renderHook(() => useCreatePlaylistDraft(), { wrapper });
		await waitFor(() => expect(result.current.isLoading).toBe(false));

		act(() => {
			result.current.addArtist("A");
			result.current.addSong("m1");
		});
		await waitFor(() =>
			expect(previewPlaylistDraftMock).toHaveBeenLastCalledWith({
				data: expect.objectContaining({ pinnedSongIds: ["a1", "m1"] }),
			}),
		);

		act(() => {
			result.current.toggleArtist("A");
		});
		// Assert on the derived union, not the mock: the ["m1"]-only query key was
		// already cached from the intermediate state, so no new fetch fires.
		await waitFor(() =>
			expect(result.current.effectivePinnedSongIds).toEqual(["m1"]),
		);
		expect(result.current.selection.pinnedSongIds).toEqual(["m1"]);
		// The disabled artist stays in the list, dimmed, ready to re-enable.
		expect(result.current.artistSelections[0]).toMatchObject({
			name: "A",
			enabled: false,
		});
	});

	it("manual pins come off the top of the artist budget (maxSongs honored)", async () => {
		const manyIds = Array.from({ length: 30 }, (_, i) => `a${i + 1}`);
		resolveLikedArtistSongsMock.mockResolvedValue({
			artists: [{ name: "A", songIds: manyIds }],
		});

		const { result } = renderHook(() => useCreatePlaylistDraft(), { wrapper });
		await waitFor(() => expect(result.current.isLoading).toBe(false));

		act(() => {
			result.current.addSong("m1");
			result.current.addArtist("A");
		});

		// Default maxSongs 15: 1 manual commitment + 14 artist slots.
		await waitFor(() => {
			const call = previewPlaylistDraftMock.mock.lastCall?.[0] as {
				data: { pinnedSongIds: string[] };
			};
			expect(call.data.pinnedSongIds).toHaveLength(15);
			expect(call.data.pinnedSongIds.at(-1)).toBe("m1");
		});
	});

	it("removeArtist drops the chip; restoreArtist re-inserts at its prior position", async () => {
		resolveLikedArtistSongsMock.mockResolvedValue({ artists: [] });

		const { result } = renderHook(() => useCreatePlaylistDraft(), { wrapper });
		await waitFor(() => expect(result.current.isLoading).toBe(false));

		act(() => {
			result.current.addArtist("A");
			result.current.addArtist("B");
			result.current.addArtist("C");
		});
		act(() => {
			result.current.removeArtist("B");
		});
		expect(result.current.artistSelections.map((a) => a.name)).toEqual([
			"A",
			"C",
		]);

		act(() => {
			result.current.restoreArtist({ name: "B", enabled: true }, 1);
		});
		expect(result.current.artistSelections.map((a) => a.name)).toEqual([
			"A",
			"B",
			"C",
		]);
	});
});

describe("useCreatePlaylistDraft — artist resolution readiness", () => {
	beforeEach(() => {
		previewPlaylistDraftMock.mockReset();
		previewPlaylistDraftMock.mockResolvedValue(EMPTY_RESULT);
		resolveLikedArtistSongsMock.mockReset();
		queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
	});

	it("isResolvingArtists and isArtistResolutionError are both false with no artist selections", async () => {
		const { result } = renderHook(() => useCreatePlaylistDraft(), { wrapper });
		await waitFor(() => expect(result.current.isLoading).toBe(false));

		expect(result.current.isResolvingArtists).toBe(false);
		expect(result.current.isArtistResolutionError).toBe(false);
		expect(resolveLikedArtistSongsMock).not.toHaveBeenCalled();
	});

	it("isResolvingArtists is true while the resolution query is in flight after addArtist", async () => {
		// A promise that never settles keeps the query in its fetching state so
		// the readiness flag can be observed before resolution lands — mirrors
		// the real "add an artist then click Create quickly" race.
		resolveLikedArtistSongsMock.mockReturnValue(new Promise(() => {}));

		const { result } = renderHook(() => useCreatePlaylistDraft(), { wrapper });
		await waitFor(() => expect(result.current.isLoading).toBe(false));

		act(() => {
			result.current.addArtist("Radiohead");
		});

		await waitFor(() => expect(result.current.isResolvingArtists).toBe(true));
		expect(result.current.isArtistResolutionError).toBe(false);
	});

	it("isArtistResolutionError is true when the resolution query rejects, and retryArtistResolution refetches it", async () => {
		resolveLikedArtistSongsMock.mockRejectedValueOnce(new Error("boom"));
		resolveLikedArtistSongsMock.mockResolvedValue({
			artists: [{ name: "Radiohead", songIds: ["r1"] }],
		});

		const { result } = renderHook(() => useCreatePlaylistDraft(), { wrapper });
		await waitFor(() => expect(result.current.isLoading).toBe(false));

		act(() => {
			result.current.addArtist("Radiohead");
		});

		await waitFor(() =>
			expect(result.current.isArtistResolutionError).toBe(true),
		);
		expect(result.current.isResolvingArtists).toBe(false);

		act(() => {
			result.current.retryArtistResolution();
		});

		await waitFor(() =>
			expect(result.current.isArtistResolutionError).toBe(false),
		);
		expect(resolveLikedArtistSongsMock).toHaveBeenCalledTimes(2);
	});
});
