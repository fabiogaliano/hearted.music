import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	renderHook,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeyboardShortcutProvider } from "@/lib/keyboard/KeyboardShortcutProvider";
import { ThemeHueProvider } from "@/lib/theme/ThemeHueProvider";
import type { LikedSong } from "../types";

const mockUseLikedSongsCollection = vi.fn();
const mockUseSelectedLikedSongBySlug = vi.fn();
const mockUseSongExpansion = vi.fn();
const mockUseSongSuggestionPrefetch = vi.fn((_options: unknown) => vi.fn());
const mockUseInfiniteScroll = vi.fn((_options: unknown) => ({
	sentinelRef: { current: null },
}));

vi.mock("../hooks/useLikedSongsCollection", () => ({
	useLikedSongsCollection: (options: unknown) =>
		mockUseLikedSongsCollection(options),
}));

vi.mock("../hooks/useSelectedLikedSongBySlug", () => ({
	useSelectedLikedSongBySlug: (options: unknown) =>
		mockUseSelectedLikedSongBySlug(options),
}));

vi.mock("../hooks/useSongExpansion", () => ({
	useSongExpansion: (songs: unknown, options: unknown) =>
		mockUseSongExpansion(songs, options),
}));

vi.mock("../hooks/useSongSuggestionPrefetch", () => ({
	useSongSuggestionPrefetch: (options: unknown) =>
		mockUseSongSuggestionPrefetch(options),
}));

vi.mock("@/lib/hooks/useInfiniteScroll", () => ({
	useInfiniteScroll: (options: unknown) => mockUseInfiniteScroll(options),
}));

// Stats are irrelevant to focus/pagination behavior here and the real query
// would hit a server function with no server behind it in this test env.
vi.mock("../queries", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../queries")>();
	return {
		...actual,
		likedSongsStatsQueryOptions: () => ({
			queryKey: ["liked-songs", "stats", "test"] as const,
			queryFn: () => Promise.resolve(undefined),
			enabled: false,
		}),
	};
});

import {
	computeVisibleSongs,
	useLikedSongsList,
} from "../hooks/useLikedSongsList";

function createSong(
	id: string,
	displayState: LikedSong["displayState"] = "analyzed",
): LikedSong {
	return {
		liked_at: "2026-03-30T00:00:00Z",
		matching_status: null,
		displayState,
		analysis: null,
		track: {
			id,
			spotify_track_id: `spotify-${id}`,
			name: "Ribs",
			artist: "Lorde",
			artist_id: "artist-1",
			artist_image_url: null,
			album: "Pure Heroine",
			image_url: null,
			genres: [],
			audio_features: null,
		},
	};
}

function collectionResult(songs: readonly LikedSong[]) {
	return {
		isLoading: false,
		displayedSongs: songs,
		displayedSongIndexById: new Map(
			songs.map((song, index) => [song.track.id, index]),
		),
		fetchNextPage: vi.fn(),
		hasNextPage: false,
		isFetchingNextPage: false,
	};
}

function expansionResult(
	overrides: Partial<ReturnType<typeof baseExpansionResult>> = {},
) {
	return { ...baseExpansionResult(), ...overrides };
}

function baseExpansionResult() {
	return {
		selectedSong: null as LikedSong | null,
		selectedSongId: null as string | null,
		isExpanded: false,
		containerRef: { current: null },
		hasNext: false,
		hasPrevious: false,
		handleExpand: vi.fn(),
		openSong: vi.fn(),
		handleNext: vi.fn(),
		handlePrevious: vi.fn(),
		handleClose: vi.fn(),
		closingToSongId: null as string | null,
	};
}

function Wrapper({ children }: { children: ReactNode }) {
	const queryClient = useMemo(
		() =>
			new QueryClient({
				defaultOptions: { queries: { retry: false } },
			}),
		[],
	);
	return (
		<QueryClientProvider client={queryClient}>
			<ThemeHueProvider>
				<KeyboardShortcutProvider>{children}</KeyboardShortcutProvider>
			</ThemeHueProvider>
		</QueryClientProvider>
	);
}

function baseOptions(overrides: Record<string, unknown> = {}) {
	return {
		accountId: "account-1",
		filter: "all" as const,
		activeFilter: "all" as const,
		search: "",
		// Non-null and stable across rerenders — gates the one-shot initial URL
		// focus sync inside the hook, mirroring a real deep-link slug.
		selectedSlug: "test-song",
		isWalkthrough: false,
		walkthroughSong: null,
		companionSongs: undefined,
		isEnrichmentRunning: false,
		selectionMode: false,
		showSelectionUI: false,
		selectionBarHeight: 0,
		enterSelectionMode: vi.fn(),
		toggleSongSelection: vi.fn(),
		clearSelectionMode: vi.fn(),
		...overrides,
	};
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	mockUseInfiniteScroll.mockReturnValue({ sentinelRef: { current: null } });
	mockUseSongSuggestionPrefetch.mockReturnValue(vi.fn());
});

describe("computeVisibleSongs", () => {
	const locked = createSong("locked-1", "locked");
	const analyzed = createSong("analyzed-1", "analyzed");

	it("returns every displayed song when not restricted to locked-only", () => {
		expect(computeVisibleSongs([locked, analyzed], false)).toEqual([
			locked,
			analyzed,
		]);
	});

	it("filters to locked rows only when restricted", () => {
		expect(computeVisibleSongs([locked, analyzed], true)).toEqual([locked]);
	});

	it("returns an empty list when locked-only and nothing is locked", () => {
		expect(computeVisibleSongs([analyzed], true)).toEqual([]);
	});
});

describe("useLikedSongsList — pagination / visibility", () => {
	it("loads another page when selection mode has no locked songs yet", async () => {
		const fetchNextPage = vi.fn();
		const displayedSongs = [createSong("analyzed-1", "analyzed")];
		mockUseLikedSongsCollection.mockReturnValue({
			...collectionResult(displayedSongs),
			fetchNextPage,
			hasNextPage: true,
		});
		mockUseSelectedLikedSongBySlug.mockReturnValue({
			selectedSongFromUrl: null,
			selectedSongIdFromUrl: null,
			isSelectedSlugResolved: true,
		});
		mockUseSongExpansion.mockReturnValue(expansionResult());

		renderHook(
			() =>
				useLikedSongsList(
					baseOptions({ selectionMode: true, showSelectionUI: true }),
				),
			{ wrapper: Wrapper },
		);

		await waitFor(() => {
			expect(fetchNextPage).toHaveBeenCalledTimes(1);
		});
	});

	it("does not auto-load again once locked songs are visible", () => {
		const fetchNextPage = vi.fn();
		const displayedSongs = [
			createSong("locked-1", "locked"),
			createSong("analyzed-1", "analyzed"),
		];
		mockUseLikedSongsCollection.mockReturnValue({
			...collectionResult(displayedSongs),
			fetchNextPage,
			hasNextPage: true,
		});
		mockUseSelectedLikedSongBySlug.mockReturnValue({
			selectedSongFromUrl: null,
			selectedSongIdFromUrl: null,
			isSelectedSlugResolved: true,
		});
		mockUseSongExpansion.mockReturnValue(expansionResult());

		renderHook(
			() =>
				useLikedSongsList(
					baseOptions({ selectionMode: true, showSelectionUI: true }),
				),
			{ wrapper: Wrapper },
		);

		expect(fetchNextPage).not.toHaveBeenCalled();
	});
});

describe("useLikedSongsList — focus + activation", () => {
	function ListHarness({
		songs,
		selectedSongIdFromUrl,
	}: {
		songs: readonly LikedSong[];
		selectedSongIdFromUrl: string | null;
	}) {
		mockUseLikedSongsCollection.mockReturnValue(collectionResult(songs));
		mockUseSelectedLikedSongBySlug.mockReturnValue({
			selectedSongFromUrl: null,
			selectedSongIdFromUrl,
			isSelectedSlugResolved: true,
		});
		mockUseSongExpansion.mockReturnValue(expansionResult());

		const { state, actions } = useLikedSongsList(baseOptions());

		return (
			<div>
				<div data-testid="focused-index">{state.focusedIndex}</div>
				{state.visibleSongs.map((item, index) => {
					const itemProps = actions.getItemProps(item, index);
					return (
						<button
							key={item.track.id}
							type="button"
							ref={itemProps.ref}
							tabIndex={itemProps.tabIndex}
							data-testid={`song-${index}`}
							data-focused={itemProps["data-focused"]}
							onPointerDown={itemProps.onPointerDown}
							onFocus={itemProps.onFocus}
							onBlur={itemProps.onBlur}
						>
							{item.track.name}
						</button>
					);
				})}
			</div>
		);
	}

	function DeferredSongHarness() {
		const song = useMemo(() => createSong("song-1"), []);
		const [songs, setSongs] = useState<readonly LikedSong[]>([]);

		return (
			<div>
				<ListHarness songs={songs} selectedSongIdFromUrl={song.track.id} />
				<button type="button" onClick={() => setSongs([song])}>
					load selected song
				</button>
			</div>
		);
	}

	it("retries URL focus sync when the selected song enters navigation items later", async () => {
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: vi.fn(),
		});

		render(<DeferredSongHarness />, { wrapper: Wrapper });

		expect(screen.getByTestId("focused-index")).toHaveTextContent("-1");

		fireEvent.click(screen.getByRole("button", { name: "load selected song" }));

		await waitFor(() => {
			expect(screen.getByTestId("focused-index")).toHaveTextContent("0");
		});
	});

	it("syncs URL focus on mount when the selected song is already in the list", async () => {
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: vi.fn(),
		});

		const song = createSong("song-1");
		render(
			<ListHarness songs={[song]} selectedSongIdFromUrl={song.track.id} />,
			{ wrapper: Wrapper },
		);

		await waitFor(() => {
			expect(screen.getByTestId("focused-index")).toHaveTextContent("0");
		});
	});

	it("does not auto-scroll pointer or panel navigation while expanded", async () => {
		const scrollIntoView = vi.fn();
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: scrollIntoView,
		});

		const firstSong = createSong("song-1");
		const secondSong = createSong("song-2");
		const handleNext = vi.fn();

		function ExpandedHarness() {
			mockUseLikedSongsCollection.mockReturnValue(
				collectionResult([firstSong, secondSong]),
			);
			mockUseSelectedLikedSongBySlug.mockReturnValue({
				selectedSongFromUrl: null,
				selectedSongIdFromUrl: firstSong.track.id,
				isSelectedSlugResolved: true,
			});
			mockUseSongExpansion.mockReturnValue(
				expansionResult({
					selectedSongId: firstSong.track.id,
					isExpanded: true,
					handleNext,
				}),
			);

			// Already expanded with a selection in place — no initial URL focus
			// sync should run (that path is for a fresh deep link, not this state).
			const { state, actions } = useLikedSongsList(
				baseOptions({ selectedSlug: null }),
			);

			return (
				<div>
					<div data-testid="focused-index">{state.focusedIndex}</div>
					<button type="button" onClick={actions.handleNextSong}>
						next song
					</button>
					{state.visibleSongs.map((item, index) => {
						const itemProps = actions.getItemProps(item, index);
						return (
							<button
								key={item.track.id}
								type="button"
								ref={itemProps.ref}
								tabIndex={itemProps.tabIndex}
								data-testid={`song-${index}`}
								onPointerDown={itemProps.onPointerDown}
								onFocus={itemProps.onFocus}
								onBlur={itemProps.onBlur}
							>
								{item.track.name}
							</button>
						);
					})}
				</div>
			);
		}

		render(<ExpandedHarness />, { wrapper: Wrapper });

		fireEvent.pointerDown(screen.getByTestId("song-1"));
		fireEvent.click(screen.getByRole("button", { name: "next song" }));

		await waitFor(() => {
			expect(screen.getByTestId("focused-index")).toHaveTextContent("1");
		});
		expect(scrollIntoView).not.toHaveBeenCalled();
		expect(handleNext).toHaveBeenCalledTimes(1);
	});

	it("toggles selection on click for a locked song when selection UI is active", () => {
		const locked = createSong("locked-1", "locked");
		const toggleSongSelection = vi.fn();
		const enterSelectionMode = vi.fn();

		function SelectionHarness() {
			mockUseLikedSongsCollection.mockReturnValue(collectionResult([locked]));
			mockUseSelectedLikedSongBySlug.mockReturnValue({
				selectedSongFromUrl: null,
				selectedSongIdFromUrl: null,
				isSelectedSlugResolved: true,
			});
			mockUseSongExpansion.mockReturnValue(expansionResult());

			const { state, actions } = useLikedSongsList(
				baseOptions({
					showSelectionUI: true,
					toggleSongSelection,
					enterSelectionMode,
				}),
			);

			return (
				<div>
					{state.visibleSongs.map((item, index) => {
						const itemProps = actions.getItemProps(item, index);
						return (
							<button
								key={item.track.id}
								type="button"
								ref={itemProps.ref}
								data-testid={`song-${index}`}
								onClick={(event) =>
									actions.handleCardClick(item.track.id, event.currentTarget)
								}
							>
								{item.track.name}
							</button>
						);
					})}
				</div>
			);
		}

		render(<SelectionHarness />, { wrapper: Wrapper });

		fireEvent.click(screen.getByTestId("song-0"));

		expect(enterSelectionMode).toHaveBeenCalledTimes(1);
		expect(toggleSongSelection).toHaveBeenCalledWith(locked.track.id);
	});
});
