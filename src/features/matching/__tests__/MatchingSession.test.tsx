import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Playlist, SongForMatching } from "@/features/matching/types";
import { render, screen } from "@/test/utils/render";
import { MatchingSession } from "../sections/MatchingSession";

// MatchingSession uses ResizeObserver via useLayoutEffect to sync wrapper height.
// vi.fn() cannot be used with `new`, so a class mock is required.
class ResizeObserverMock {
	observe = vi.fn();
	unobserve = vi.fn();
	disconnect = vi.fn();
	constructor(_callback: ResizeObserverCallback) {}
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
			<MatchingSession
				mode="playlist"
				addedTo={[]}
				onAdd={() => {}}
				onDismiss={() => {}}
				onNext={() => {}}
			/>,
		);
	});

	it("does not render song or playlist sections in playlist mode", () => {
		render(
			<MatchingSession
				mode="playlist"
				addedTo={[]}
				onAdd={() => {}}
				onDismiss={() => {}}
				onNext={() => {}}
			/>,
		);
		// Placeholders render null — no song or playlist text expected
		expect(screen.queryByText("Test Song")).toBeNull();
		expect(screen.queryByText("Test Playlist")).toBeNull();
	});
});
