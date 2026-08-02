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
import type { SongVM } from "@/lib/domains/playlists/types";
import type { PlaylistDraftPreview } from "@/lib/server/playlist-draft.functions";

const previewPlaylistDraftMock = vi.fn();
const recordStudioActionsMock = vi.fn();

vi.mock("@/lib/server/playlist-draft.functions", () => ({
	previewPlaylistDraft: (...args: unknown[]) =>
		previewPlaylistDraftMock(...args),
	recordStudioActions: (...args: unknown[]) => recordStudioActionsMock(...args),
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

function makeSong(id: string): SongVM {
	return {
		id,
		spotifyId: `spotify-${id}`,
		name: `Song ${id}`,
		artist: "Artist",
		album: "Album",
		imageUrl: null,
		genres: [],
		durationMs: 180_000,
		matchScore: 0.8,
	};
}

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

describe("useCreatePlaylistDraft — preview transitions", () => {
	beforeEach(() => {
		previewPlaylistDraftMock.mockReset();
		resolveLikedArtistSongsMock.mockReset();
		queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
	});

	it("hides a removed song immediately while its replacement is still loading", async () => {
		let resolveNext!: (value: PlaylistDraftPreview) => void;
		const nextPreview = new Promise<PlaylistDraftPreview>((resolve) => {
			resolveNext = resolve;
		});
		previewPlaylistDraftMock
			.mockResolvedValueOnce({
				...EMPTY_RESULT,
				tracklist: [makeSong("1"), makeSong("2")],
			})
			.mockReturnValueOnce(nextPreview);

		const { result } = renderHook(() => useCreatePlaylistDraft(), { wrapper });
		await waitFor(() =>
			expect(result.current.tracklist.map((song) => song.id)).toEqual([
				"1",
				"2",
			]),
		);

		act(() => {
			result.current.removeSong("1");
		});

		expect(result.current.tracklist.map((song) => song.id)).toEqual(["2"]);
		await waitFor(() => expect(result.current.isPreviewRefreshing).toBe(true));

		act(() => {
			resolveNext({ ...EMPTY_RESULT, tracklist: [makeSong("2")] });
		});
		await waitFor(() => expect(result.current.isPreviewRefreshing).toBe(false));
	});

	it("hides a just-added suggestion immediately while the next cohort is still loading", async () => {
		let resolveNext!: (value: PlaylistDraftPreview) => void;
		const nextPreview = new Promise<PlaylistDraftPreview>((resolve) => {
			resolveNext = resolve;
		});
		previewPlaylistDraftMock
			.mockResolvedValueOnce({
				...EMPTY_RESULT,
				suggestions: [makeSong("s1"), makeSong("s2")],
			})
			.mockReturnValueOnce(nextPreview);

		const { result } = renderHook(() => useCreatePlaylistDraft(), { wrapper });
		await waitFor(() =>
			expect(result.current.suggestions.map((song) => song.id)).toEqual([
				"s1",
				"s2",
			]),
		);

		act(() => {
			result.current.addSong("s1");
		});

		// keepPreviousData still holds the OLD suggestions cohort (which still
		// contains s1) until the next preview resolves. Filtering only excluded
		// ids would leave the just-pinned s1 visible, letting a second click
		// fire another add — the fix also filters against the current
		// effective pins, so s1 drops out before the refetch even starts.
		expect(result.current.suggestions.map((song) => song.id)).toEqual(["s2"]);
		await waitFor(() => expect(result.current.isPreviewRefreshing).toBe(true));

		act(() => {
			resolveNext({ ...EMPTY_RESULT, suggestions: [makeSong("s2")] });
		});
		await waitFor(() => expect(result.current.isPreviewRefreshing).toBe(false));
	});

	it("keeps the previous preview marked stale while a changed query key loads", async () => {
		let resolveNext!: (value: PlaylistDraftPreview) => void;
		const nextPreview = new Promise<PlaylistDraftPreview>((resolve) => {
			resolveNext = resolve;
		});
		previewPlaylistDraftMock
			.mockResolvedValueOnce({ ...EMPTY_RESULT, totalEligible: 7 })
			.mockReturnValueOnce(nextPreview);

		const { result } = renderHook(() => useCreatePlaylistDraft(), { wrapper });
		await waitFor(() => expect(result.current.totalEligible).toBe(7));
		expect(result.current.isConfigStale).toBe(false);
		expect(result.current.isPreviewRefreshing).toBe(false);

		act(() => {
			result.current.addSong("song-1");
		});

		await waitFor(() => expect(result.current.isPreviewRefreshing).toBe(true));
		expect(result.current.totalEligible).toBe(7);
		expect(result.current.isConfigStale).toBe(true);

		act(() => {
			resolveNext({ ...EMPTY_RESULT, totalEligible: 11 });
		});

		await waitFor(() => expect(result.current.totalEligible).toBe(11));
		expect(result.current.isPreviewRefreshing).toBe(false);
		expect(result.current.isConfigStale).toBe(false);
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

	it("addArtist resolves the artist's liked song ids and pins the allocation", async () => {
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

	it("excluding an allocated song promotes the artist's next song instead of burning the slot", async () => {
		const manyIds = Array.from({ length: 20 }, (_, i) => `a${i + 1}`);
		resolveLikedArtistSongsMock.mockResolvedValue({
			artists: [{ name: "A", songIds: manyIds }],
		});

		const { result } = renderHook(() => useCreatePlaylistDraft(), { wrapper });
		await waitFor(() => expect(result.current.isLoading).toBe(false));

		act(() => {
			result.current.addArtist("A");
		});
		// Default maxSongs 15: allocation takes the first 15 of the pool.
		await waitFor(() =>
			expect(result.current.effectivePinnedSongIds).toEqual(
				manyIds.slice(0, 15),
			),
		);

		act(() => {
			result.current.removeSong("a1");
		});
		// The excluded id leaves the pool entirely, so a16 fills the slot a1 held
		// — the engine would drop a1 server-side, so keeping it would waste the slot.
		await waitFor(() =>
			expect(result.current.effectivePinnedSongIds).toEqual(
				manyIds.slice(1, 16),
			),
		);
	});

	it("removeArtist drops the chip from the selection", async () => {
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
	});

	it("togglePin pins a matched row, then releases the manual pin without excluding it", async () => {
		resolveLikedArtistSongsMock.mockResolvedValue({ artists: [] });

		const { result } = renderHook(() => useCreatePlaylistDraft(), { wrapper });
		await waitFor(() => expect(result.current.isLoading).toBe(false));

		act(() => {
			result.current.togglePin("song-1");
		});
		expect(result.current.selection.pinnedSongIds).toContain("song-1");

		// Releasing drops the pin only — no exclusion, so the song can re-enter
		// the tracklist on merit if the current config still selects it.
		act(() => {
			result.current.togglePin("song-1");
		});
		expect(result.current.selection.pinnedSongIds).not.toContain("song-1");
		expect(result.current.selection.excludedSongIds).not.toContain("song-1");
		expect(result.current.selection.releasedSongIds).toContain("song-1");

		// Re-pinning clears the release — the stances are mutually exclusive.
		act(() => {
			result.current.togglePin("song-1");
		});
		expect(result.current.selection.pinnedSongIds).toContain("song-1");
		expect(result.current.selection.releasedSongIds).not.toContain("song-1");
	});

	it("togglePin releases an artist-derived pick and suppresses re-allocation, without excluding it", async () => {
		resolveLikedArtistSongsMock.mockResolvedValue({
			artists: [{ name: "Radiohead", songIds: ["r1", "r2"] }],
		});

		const { result } = renderHook(() => useCreatePlaylistDraft(), { wrapper });
		await waitFor(() => expect(result.current.isLoading).toBe(false));

		act(() => {
			result.current.addArtist("Radiohead");
		});
		await waitFor(() =>
			expect(result.current.effectivePinnedSongIds).toEqual(["r1", "r2"]),
		);

		// The released id leaves the allocator's pool — it is NOT re-derived on
		// the next allocation pass — but stays eligible on merit (no exclusion).
		act(() => {
			result.current.togglePin("r1");
		});
		await waitFor(() =>
			expect(result.current.effectivePinnedSongIds).toEqual(["r2"]),
		);
		expect(result.current.selection.excludedSongIds).not.toContain("r1");
		expect(result.current.selection.releasedSongIds).toContain("r1");
	});

	it("releasing a manual pin whose artist is anchored does not resurrect it via allocation", async () => {
		resolveLikedArtistSongsMock.mockResolvedValue({
			artists: [{ name: "Radiohead", songIds: ["r1", "r2"] }],
		});

		const { result } = renderHook(() => useCreatePlaylistDraft(), { wrapper });
		await waitFor(() => expect(result.current.isLoading).toBe(false));

		// Manual pin first, then anchor the artist: the allocator must skip the
		// manual pin (it already comes off the top of the budget), so the union
		// carries each id exactly once — artist picks first, manual pins after.
		act(() => {
			result.current.addSong("r1");
			result.current.addArtist("Radiohead");
		});
		await waitFor(() =>
			expect(result.current.effectivePinnedSongIds).toEqual(["r2", "r1"]),
		);

		act(() => {
			result.current.togglePin("r1");
		});
		await waitFor(() =>
			expect(result.current.effectivePinnedSongIds).toEqual(["r2"]),
		);
		expect(result.current.selection.excludedSongIds).not.toContain("r1");
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
