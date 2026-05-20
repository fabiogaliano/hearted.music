import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/test/utils/render";
import { PlaylistTrackList } from "../PlaylistTrackList";

const mockGetPlaylistTracksPage = vi.fn();

vi.mock("@/lib/server/playlists.functions", () => ({
	getPlaylistTracksPage: (...args: unknown[]) =>
		mockGetPlaylistTracksPage(...args),
	getPlaylistManagementData: vi.fn(),
}));

interface CapturedInfiniteScrollCall {
	onLoadMore: () => void;
	hasMore: boolean;
}

const infiniteScrollCalls: CapturedInfiniteScrollCall[] = [];

vi.mock("@/lib/hooks/useInfiniteScroll", () => ({
	useInfiniteScroll: (opts: CapturedInfiniteScrollCall) => {
		infiniteScrollCalls.push(opts);
		return { sentinelRef: () => {} };
	},
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

function trackPage(
	tracks: Array<{ position: number; songId: string; name: string }>,
	nextCursor: number | null,
) {
	return {
		tracks: tracks.map((t) => ({
			position: t.position,
			songId: t.songId,
			name: t.name,
			artists: ["Artist"],
			albumName: null,
			imageUrl: null,
		})),
		nextCursor,
	};
}

describe("PlaylistTrackList", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		infiniteScrollCalls.length = 0;
	});

	afterEach(() => {
		cleanup();
	});

	it("shows the select-a-playlist message when playlistId is null", () => {
		renderList(null);

		expect(
			screen.getByText("Select a playlist to see tracks."),
		).toBeInTheDocument();
		expect(mockGetPlaylistTracksPage).not.toHaveBeenCalled();
	});

	it("shows the loading message while a non-null playlist query is pending", () => {
		mockGetPlaylistTracksPage.mockReturnValue(new Promise(() => {}));

		renderList("uuid-1");

		expect(screen.getByText("Loading tracks…")).toBeInTheDocument();
		expect(mockGetPlaylistTracksPage).toHaveBeenCalledTimes(1);
	});

	it("shows the error message when the query rejects", async () => {
		mockGetPlaylistTracksPage.mockRejectedValue(
			new Error("Failed to load playlist tracks"),
		);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		renderList("uuid-1");

		expect(
			await screen.findByText("Couldn’t load tracks. Try again."),
		).toBeInTheDocument();

		errorSpy.mockRestore();
	});

	it("shows the empty message when the first page resolves with no tracks", async () => {
		mockGetPlaylistTracksPage.mockResolvedValue(trackPage([], null));

		renderList("uuid-1");

		expect(
			await screen.findByText("No track data available for this playlist yet."),
		).toBeInTheDocument();
	});

	it("renders the first page of tracks when the query resolves", async () => {
		mockGetPlaylistTracksPage.mockResolvedValue(
			trackPage(
				[
					{ position: 0, songId: "song-1", name: "First Song" },
					{ position: 1, songId: "song-2", name: "Second Song" },
				],
				null,
			),
		);

		renderList("uuid-1");

		expect(await screen.findByText("First Song")).toBeInTheDocument();
		expect(screen.getByText("Second Song")).toBeInTheDocument();
		expect(
			screen.queryByText("No track data available for this playlist yet."),
		).not.toBeInTheDocument();
	});

	it("fetches the next page when the sentinel triggers onLoadMore", async () => {
		mockGetPlaylistTracksPage
			.mockResolvedValueOnce(
				trackPage([{ position: 0, songId: "song-1", name: "First Song" }], 1),
			)
			.mockResolvedValueOnce(
				trackPage(
					[{ position: 1, songId: "song-2", name: "Second Song" }],
					null,
				),
			);

		renderList("uuid-1");

		await screen.findByText("First Song");

		// Trigger the most recent onLoadMore (sentinel intersection).
		const lastCall = infiniteScrollCalls[infiniteScrollCalls.length - 1];
		expect(lastCall.hasMore).toBe(true);
		await act(async () => {
			lastCall.onLoadMore();
		});

		expect(await screen.findByText("Second Song")).toBeInTheDocument();
		expect(mockGetPlaylistTracksPage).toHaveBeenCalledTimes(2);
		const secondCallArgs = mockGetPlaylistTracksPage.mock.calls[1][0];
		expect(secondCallArgs.data.cursor).toBe(1);
	});

	it("renders 'Loading more…' while the next page is fetching", async () => {
		let resolveSecondPage: ((value: unknown) => void) | undefined;
		mockGetPlaylistTracksPage
			.mockResolvedValueOnce(
				trackPage([{ position: 0, songId: "song-1", name: "First Song" }], 1),
			)
			.mockReturnValueOnce(
				new Promise((resolve) => {
					resolveSecondPage = resolve;
				}),
			);

		renderList("uuid-1");
		await screen.findByText("First Song");

		const lastCall = infiniteScrollCalls[infiniteScrollCalls.length - 1];
		await act(async () => {
			lastCall.onLoadMore();
		});

		expect(await screen.findByText("Loading more…")).toBeInTheDocument();

		await act(async () => {
			resolveSecondPage?.(
				trackPage(
					[{ position: 1, songId: "song-2", name: "Second Song" }],
					null,
				),
			);
		});
	});
});
