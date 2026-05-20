import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/test/utils/render";
import { PlaylistTrackList } from "../PlaylistTrackList";

const mockGetPlaylistTrackPreview = vi.fn();

vi.mock("@/lib/server/playlists.functions", () => ({
	getPlaylistTrackPreview: (...args: unknown[]) =>
		mockGetPlaylistTrackPreview(...args),
	getPlaylistManagementData: vi.fn(),
}));

function renderList(playlistId: string | null) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<PlaylistTrackList playlistId={playlistId} isExpanded={true} />
		</QueryClientProvider>,
	);
}

describe("PlaylistTrackList", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it("shows the select-a-playlist message when playlistId is null", () => {
		renderList(null);

		expect(
			screen.getByText("Select a playlist to see tracks."),
		).toBeInTheDocument();
		expect(mockGetPlaylistTrackPreview).not.toHaveBeenCalled();
	});

	it("shows the loading message while a non-null playlist query is pending", () => {
		// Never-resolving promise keeps the query stuck in the loading state.
		mockGetPlaylistTrackPreview.mockReturnValue(new Promise(() => {}));

		renderList("uuid-1");

		expect(screen.getByText("Loading tracks…")).toBeInTheDocument();
		expect(mockGetPlaylistTrackPreview).toHaveBeenCalledTimes(1);
	});

	it("shows the error message when the query rejects", async () => {
		mockGetPlaylistTrackPreview.mockRejectedValue(
			new Error("Failed to load playlist tracks"),
		);
		// React Query logs failed queries to console.error; suppress for noise.
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		renderList("uuid-1");

		expect(
			await screen.findByText("Couldn’t load tracks. Try again."),
		).toBeInTheDocument();

		errorSpy.mockRestore();
	});

	it("shows the empty message when the query resolves to an empty array", async () => {
		mockGetPlaylistTrackPreview.mockResolvedValue([]);

		renderList("uuid-1");

		expect(
			await screen.findByText("No track data available for this playlist yet."),
		).toBeInTheDocument();
	});

	it("renders track rows when the query resolves with tracks", async () => {
		mockGetPlaylistTrackPreview.mockResolvedValue([
			{
				position: 0,
				songId: "song-1",
				name: "First Song",
				artists: ["Artist A"],
				albumName: "Album A",
				imageUrl: null,
			},
			{
				position: 1,
				songId: "song-2",
				name: "Second Song",
				artists: ["Artist B"],
				albumName: null,
				imageUrl: null,
			},
		]);

		renderList("uuid-1");

		expect(await screen.findByText("First Song")).toBeInTheDocument();
		expect(screen.getByText("Second Song")).toBeInTheDocument();
		expect(
			screen.queryByText("No track data available for this playlist yet."),
		).not.toBeInTheDocument();
	});
});
