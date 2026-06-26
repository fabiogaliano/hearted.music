import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type {
	Playlist,
	PlaylistForMatching,
	SongForMatching,
} from "@/features/matching/types";
import { render, screen } from "@/test/utils/render";
import { MatchingSession } from "../sections/MatchingSession";

// MatchingSession uses ResizeObserver via useLayoutEffect to sync wrapper height.
// A class mock is required because vi.fn() cannot be used with `new`.
class ResizeObserverMock {
	observe = vi.fn();
	unobserve = vi.fn();
	disconnect = vi.fn();
}

beforeAll(() => {
	vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

const SONG: SongForMatching = {
	id: "song-1",
	spotifyId: "sp-1",
	name: "Test Song",
	artist: "Test Artist",
	album: "Test Album",
	albumArtUrl: null,
	genres: [],
	audioFeatures: null,
	analysis: null,
};

const PLAYLISTS: Playlist[] = [
	{
		id: "pl-1",
		spotifyId: "sp-pl-1",
		name: "Test Playlist",
		reason: "Good vibes",
		matchScore: 0.9,
		imageUrl: null,
		songCount: 10,
	},
];

const PLAYLIST_REVIEW_ITEM: PlaylistForMatching = {
	id: "pl-review-1",
	spotifyId: "sp-review-1",
	name: "Review Playlist",
	description: "A playlist to review",
	imageUrl: null,
	trackCount: 20,
};

function makeQueryClient() {
	return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("MatchingSession", () => {
	it("renders without crashing in song mode", () => {
		render(
			<QueryClientProvider client={makeQueryClient()}>
				<MatchingSession
					mode="song"
					currentSong={SONG}
					playlists={PLAYLISTS}
					addedTo={[]}
					onAdd={() => {}}
					onDismiss={() => {}}
					onNext={() => {}}
				/>
			</QueryClientProvider>,
		);
	});

	it("renders song section and matches section in song mode", () => {
		render(
			<QueryClientProvider client={makeQueryClient()}>
				<MatchingSession
					mode="song"
					currentSong={SONG}
					playlists={PLAYLISTS}
					addedTo={[]}
					onAdd={() => {}}
					onDismiss={() => {}}
					onNext={() => {}}
				/>
			</QueryClientProvider>,
		);
		expect(screen.getByText("Test Song")).toBeDefined();
		expect(screen.getByText("Test Playlist")).toBeDefined();
	});

	it("renders without crashing in playlist mode", () => {
		render(
			<QueryClientProvider client={makeQueryClient()}>
				<MatchingSession
					mode="playlist"
					reviewItem={PLAYLIST_REVIEW_ITEM}
					addedTo={[]}
					onAdd={() => {}}
					onDismiss={() => {}}
					onNext={() => {}}
				/>
			</QueryClientProvider>,
		);
	});

	it("renders playlist review item name in playlist mode", () => {
		render(
			<QueryClientProvider client={makeQueryClient()}>
				<MatchingSession
					mode="playlist"
					reviewItem={PLAYLIST_REVIEW_ITEM}
					addedTo={[]}
					onAdd={() => {}}
					onDismiss={() => {}}
					onNext={() => {}}
				/>
			</QueryClientProvider>,
		);
		expect(screen.getByText("Review Playlist")).toBeDefined();
	});

	it("does not render song content in playlist mode", () => {
		render(
			<QueryClientProvider client={makeQueryClient()}>
				<MatchingSession
					mode="playlist"
					reviewItem={PLAYLIST_REVIEW_ITEM}
					addedTo={[]}
					onAdd={() => {}}
					onDismiss={() => {}}
					onNext={() => {}}
				/>
			</QueryClientProvider>,
		);
		// Song section content must not appear in playlist mode
		expect(screen.queryByText("Test Song")).toBeNull();
	});
});
