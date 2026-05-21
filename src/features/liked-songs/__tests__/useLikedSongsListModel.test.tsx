import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LikedSong } from "../types";

const mockUseInfiniteScroll = vi.fn((args: unknown) => {
	void args;
	return { sentinelRef: { current: null } };
});
const mockUseSongSuggestionPrefetch = vi.fn((args: unknown) => {
	void args;
	return vi.fn();
});

vi.mock("@/lib/hooks/useInfiniteScroll", () => ({
	useInfiniteScroll: (args: unknown) => mockUseInfiniteScroll(args),
}));

vi.mock("../hooks/useSongSuggestionPrefetch", () => ({
	useSongSuggestionPrefetch: (args: unknown) =>
		mockUseSongSuggestionPrefetch(args),
}));

import { useLikedSongsListModel } from "../hooks/useLikedSongsListModel";

function createSong(
	id: string,
	displayState: LikedSong["displayState"],
): LikedSong {
	return {
		liked_at: "2026-03-30T00:00:00Z",
		matching_status: null,
		displayState,
		analysis: null,
		track: {
			id,
			spotify_track_id: `spotify-${id}`,
			name: "Song",
			artist: "Artist",
			artist_id: null,
			artist_image_url: null,
			album: null,
			image_url: null,
			genres: [],
			audio_features: null,
		},
	};
}

describe("useLikedSongsListModel", () => {
	it("loads another page when selection mode has no locked songs yet", async () => {
		const fetchNextPage = vi.fn();
		const displayedSongs = [createSong("analyzed-1", "analyzed")];

		renderHook(() =>
			useLikedSongsListModel({
				displayedSongs,
				displayedSongIndexById: new Map(
					displayedSongs.map((song, index) => [song.track.id, index]),
				),
				fetchNextPage,
				hasNextPage: true,
				isFetchingNextPage: false,
				isWalkthrough: false,
				walkthroughSongId: null,
				selectionMode: true,
				showSelectionUI: true,
				activeFilter: "all",
			}),
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

		renderHook(() =>
			useLikedSongsListModel({
				displayedSongs,
				displayedSongIndexById: new Map(
					displayedSongs.map((song, index) => [song.track.id, index]),
				),
				fetchNextPage,
				hasNextPage: true,
				isFetchingNextPage: false,
				isWalkthrough: false,
				walkthroughSongId: null,
				selectionMode: true,
				showSelectionUI: true,
				activeFilter: "all",
			}),
		);

		expect(fetchNextPage).not.toHaveBeenCalled();
	});
});
