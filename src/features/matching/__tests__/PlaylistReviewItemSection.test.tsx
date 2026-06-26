import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { PlaylistForMatching } from "@/features/matching/types";
import { render, screen } from "@/test/utils/render";
import { PlaylistReviewItemSection } from "../components/PlaylistReviewItemSection";

const REVIEW_ITEM: PlaylistForMatching = {
	id: "pl-1",
	spotifyId: "sp-pl-1",
	name: "Chill Vibes",
	description: "Lo-fi beats",
	imageUrl: null,
	trackCount: 15,
};

const REVIEW_ITEM_NO_DESC: PlaylistForMatching = {
	id: "pl-2",
	spotifyId: "sp-pl-2",
	name: "Focus Mode",
	description: null,
	imageUrl: null,
	trackCount: null,
};

function makeQueryClient() {
	return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("PlaylistReviewItemSection", () => {
	it("renders the playlist name", () => {
		render(
			<QueryClientProvider client={makeQueryClient()}>
				<PlaylistReviewItemSection
					itemKey="pl-1"
					reviewItem={REVIEW_ITEM}
					canLoadTracks={false}
				/>
			</QueryClientProvider>,
		);
		expect(screen.getByText("Chill Vibes")).toBeDefined();
	});

	it("renders the description as subtitle when present", () => {
		render(
			<QueryClientProvider client={makeQueryClient()}>
				<PlaylistReviewItemSection
					itemKey="pl-1"
					reviewItem={REVIEW_ITEM}
					canLoadTracks={false}
				/>
			</QueryClientProvider>,
		);
		expect(screen.getByText("Lo-fi beats")).toBeDefined();
	});

	it("falls back to 'Playlist' subtitle when description is null", () => {
		render(
			<QueryClientProvider client={makeQueryClient()}>
				<PlaylistReviewItemSection
					itemKey="pl-2"
					reviewItem={REVIEW_ITEM_NO_DESC}
					canLoadTracks={false}
				/>
			</QueryClientProvider>,
		);
		expect(screen.getByText("Playlist")).toBeDefined();
	});

	it("renders with suppressTransition=true without crashing", () => {
		render(
			<QueryClientProvider client={makeQueryClient()}>
				<PlaylistReviewItemSection
					itemKey="pl-1"
					reviewItem={REVIEW_ITEM}
					canLoadTracks={false}
					suppressTransition
				/>
			</QueryClientProvider>,
		);
		expect(screen.getByText("Chill Vibes")).toBeDefined();
	});

	it("exposes a focusable trigger region when canLoadTracks is true", () => {
		render(
			<QueryClientProvider client={makeQueryClient()}>
				<PlaylistReviewItemSection
					itemKey="pl-1"
					reviewItem={REVIEW_ITEM}
					canLoadTracks
				/>
			</QueryClientProvider>,
		);
		// usePlaylistTrackPreview sets tabIndex=0 on the trigger when canLoadTracks.
		// The region must be keyboard-reachable so focus-driven preview works (a11y).
		const trigger = document.querySelector('[tabindex="0"]');
		expect(trigger).not.toBeNull();
	});

	it("does not expose a focusable trigger when canLoadTracks is false", () => {
		render(
			<QueryClientProvider client={makeQueryClient()}>
				<PlaylistReviewItemSection
					itemKey="pl-1"
					reviewItem={REVIEW_ITEM}
					canLoadTracks={false}
				/>
			</QueryClientProvider>,
		);
		// No tabIndex=0 is set when preview is disabled (demo/walkthrough mode).
		const trigger = document.querySelector('[tabindex="0"]');
		expect(trigger).toBeNull();
	});
});
