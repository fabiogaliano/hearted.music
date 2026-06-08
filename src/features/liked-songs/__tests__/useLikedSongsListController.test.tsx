import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { useMemo, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeyboardShortcutProvider } from "@/lib/keyboard/KeyboardShortcutProvider";
import { ThemeHueProvider } from "@/lib/theme/ThemeHueProvider";
import { useLikedSongsListController } from "../hooks/useLikedSongsListController";
import type { LikedSong } from "../types";

function createSong(id: string): LikedSong {
	return {
		liked_at: "2026-03-30T00:00:00Z",
		matching_status: null,
		displayState: "analyzed",
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

function ControllerHarness() {
	const song = useMemo(() => createSong("song-1"), []);
	const [navItems, setNavItems] = useState<readonly LikedSong[]>([]);
	const displayedSongs = useMemo(() => [song], [song]);
	const displayedSongIndexById = useMemo(
		() => new Map(displayedSongs.map((item, index) => [item.track.id, index])),
		[displayedSongs],
	);
	const navIndexBySongId = useMemo(
		() => new Map(navItems.map((item, index) => [item.track.id, index])),
		[navItems],
	);

	const { focusedIndex, getItemProps } = useLikedSongsListController({
		displayedSongs,
		displayedSongIndexById,
		navItems,
		navIndexBySongId,
		selectedSongId: null,
		selectedSongIdFromUrl: song.track.id,
		shouldSyncInitialUrlSelection: true,
		isExpanded: false,
		selectionMode: false,
		showSelectionUI: false,
		selectionBarHeight: 0,
		enterSelectionMode: vi.fn(),
		toggleSongSelection: vi.fn(),
		clearSelectionMode: vi.fn(),
		handleExpand: vi.fn(),
		handleNext: vi.fn(),
		handlePrevious: vi.fn(),
		prefetchAdjacentSuggestions: vi.fn(),
		handleLoadMore: vi.fn(),
		hasMore: false,
	});

	return (
		<div>
			<div data-testid="focused-index">{focusedIndex}</div>
			<button type="button" onClick={() => setNavItems([song])}>
				load selected song
			</button>
			{navItems.map((item, index) => {
				const itemProps = getItemProps(item, index);
				return (
					<button
						key={item.track.id}
						type="button"
						ref={itemProps.ref}
						tabIndex={itemProps.tabIndex}
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

function PreloadedControllerHarness() {
	const song = useMemo(() => createSong("song-1"), []);
	const navItems = useMemo<readonly LikedSong[]>(() => [song], [song]);
	const displayedSongs = navItems;
	const displayedSongIndexById = useMemo(
		() => new Map(displayedSongs.map((item, index) => [item.track.id, index])),
		[displayedSongs],
	);
	const navIndexBySongId = useMemo(
		() => new Map(navItems.map((item, index) => [item.track.id, index])),
		[navItems],
	);

	const { focusedIndex } = useLikedSongsListController({
		displayedSongs,
		displayedSongIndexById,
		navItems,
		navIndexBySongId,
		selectedSongId: null,
		selectedSongIdFromUrl: song.track.id,
		shouldSyncInitialUrlSelection: true,
		isExpanded: false,
		selectionMode: false,
		showSelectionUI: false,
		selectionBarHeight: 0,
		enterSelectionMode: vi.fn(),
		toggleSongSelection: vi.fn(),
		clearSelectionMode: vi.fn(),
		handleExpand: vi.fn(),
		handleNext: vi.fn(),
		handlePrevious: vi.fn(),
		prefetchAdjacentSuggestions: vi.fn(),
		handleLoadMore: vi.fn(),
		hasMore: false,
	});

	return <div data-testid="focused-index">{focusedIndex}</div>;
}

function OneShotUrlSyncHarness() {
	const firstSong = useMemo(() => createSong("song-1"), []);
	const secondSong = useMemo(() => createSong("song-2"), []);
	const navItems = useMemo<readonly LikedSong[]>(
		() => [firstSong, secondSong],
		[firstSong, secondSong],
	);
	const displayedSongs = navItems;
	const displayedSongIndexById = useMemo(
		() => new Map(displayedSongs.map((item, index) => [item.track.id, index])),
		[displayedSongs],
	);
	const navIndexBySongId = useMemo(
		() => new Map(navItems.map((item, index) => [item.track.id, index])),
		[navItems],
	);
	const [selectedSongIdFromUrl, setSelectedSongIdFromUrl] = useState(
		firstSong.track.id,
	);
	const [shouldSyncInitialUrlSelection, setShouldSyncInitialUrlSelection] =
		useState(true);

	const { focusedIndex } = useLikedSongsListController({
		displayedSongs,
		displayedSongIndexById,
		navItems,
		navIndexBySongId,
		selectedSongId: null,
		selectedSongIdFromUrl,
		shouldSyncInitialUrlSelection,
		isExpanded: false,
		selectionMode: false,
		showSelectionUI: false,
		selectionBarHeight: 0,
		enterSelectionMode: vi.fn(),
		toggleSongSelection: vi.fn(),
		clearSelectionMode: vi.fn(),
		handleExpand: vi.fn(),
		handleNext: vi.fn(),
		handlePrevious: vi.fn(),
		prefetchAdjacentSuggestions: vi.fn(),
		handleLoadMore: vi.fn(),
		hasMore: false,
	});

	return (
		<div>
			<div data-testid="focused-index">{focusedIndex}</div>
			<button
				type="button"
				onClick={() => {
					setShouldSyncInitialUrlSelection(false);
					setSelectedSongIdFromUrl(secondSong.track.id);
				}}
			>
				change url selection
			</button>
		</div>
	);
}

function ExpandedInteractionHarness() {
	const firstSong = useMemo(() => createSong("song-1"), []);
	const secondSong = useMemo(() => createSong("song-2"), []);
	const navItems = useMemo<readonly LikedSong[]>(
		() => [firstSong, secondSong],
		[firstSong, secondSong],
	);
	const displayedSongs = navItems;
	const displayedSongIndexById = useMemo(
		() => new Map(displayedSongs.map((item, index) => [item.track.id, index])),
		[displayedSongs],
	);
	const navIndexBySongId = useMemo(
		() => new Map(navItems.map((item, index) => [item.track.id, index])),
		[navItems],
	);

	const { focusedIndex, getItemProps, handleNextSong } =
		useLikedSongsListController({
			displayedSongs,
			displayedSongIndexById,
			navItems,
			navIndexBySongId,
			selectedSongId: firstSong.track.id,
			selectedSongIdFromUrl: firstSong.track.id,
			shouldSyncInitialUrlSelection: false,
			isExpanded: true,
			selectionMode: false,
			showSelectionUI: false,
			selectionBarHeight: 0,
			enterSelectionMode: vi.fn(),
			toggleSongSelection: vi.fn(),
			clearSelectionMode: vi.fn(),
			handleExpand: vi.fn(),
			handleNext: vi.fn(),
			handlePrevious: vi.fn(),
			prefetchAdjacentSuggestions: vi.fn(),
			handleLoadMore: vi.fn(),
			hasMore: false,
		});

	return (
		<div>
			<div data-testid="focused-index">{focusedIndex}</div>
			<button type="button" onClick={handleNextSong}>
				next song
			</button>
			{navItems.map((item, index) => {
				const itemProps = getItemProps(item, index);
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

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("useLikedSongsListController", () => {
	it("retries URL focus sync when the selected song enters navigation items later", async () => {
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: vi.fn(),
		});

		render(
			<ThemeHueProvider>
				<KeyboardShortcutProvider>
					<ControllerHarness />
				</KeyboardShortcutProvider>
			</ThemeHueProvider>,
		);

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

		render(
			<ThemeHueProvider>
				<KeyboardShortcutProvider>
					<PreloadedControllerHarness />
				</KeyboardShortcutProvider>
			</ThemeHueProvider>,
		);

		// The bootstrap path lands the selected song in navItems before first
		// paint, so the URL-sync effect resolves an index instead of bailing.
		await waitFor(() => {
			expect(screen.getByTestId("focused-index")).toHaveTextContent("0");
		});
	});

	it("does not keep re-syncing cursor from later URL selection changes", async () => {
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: vi.fn(),
		});

		render(
			<ThemeHueProvider>
				<KeyboardShortcutProvider>
					<OneShotUrlSyncHarness />
				</KeyboardShortcutProvider>
			</ThemeHueProvider>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("focused-index")).toHaveTextContent("0");
		});

		fireEvent.click(
			screen.getByRole("button", { name: "change url selection" }),
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

		render(
			<ThemeHueProvider>
				<KeyboardShortcutProvider>
					<ExpandedInteractionHarness />
				</KeyboardShortcutProvider>
			</ThemeHueProvider>,
		);

		fireEvent.pointerDown(screen.getByTestId("song-1"));
		fireEvent.click(screen.getByRole("button", { name: "next song" }));

		await waitFor(() => {
			expect(screen.getByTestId("focused-index")).toHaveTextContent("1");
		});
		expect(scrollIntoView).not.toHaveBeenCalled();
	});
});
