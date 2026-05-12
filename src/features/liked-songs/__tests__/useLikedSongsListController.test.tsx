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
});
