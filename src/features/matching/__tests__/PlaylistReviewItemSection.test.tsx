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

	it("renders the description as the intent deck when present", () => {
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

	it("renders the track count as the label above the name", () => {
		render(
			<QueryClientProvider client={makeQueryClient()}>
				<PlaylistReviewItemSection
					itemKey="pl-1"
					reviewItem={REVIEW_ITEM}
					canLoadTracks={false}
				/>
			</QueryClientProvider>,
		);
		expect(screen.getByText("15 songs")).toBeDefined();
	});

	// The old design put a "Playlist" filler in the label slot when the description
	// was absent; the intent is now a deck below the name, so an absent description
	// simply renders no deck (no empty-label placeholder).
	it("omits the intent deck when description is null", () => {
		render(
			<QueryClientProvider client={makeQueryClient()}>
				<PlaylistReviewItemSection
					itemKey="pl-2"
					reviewItem={REVIEW_ITEM_NO_DESC}
					canLoadTracks={false}
				/>
			</QueryClientProvider>,
		);
		expect(screen.getByText("Focus Mode")).toBeDefined();
		expect(screen.queryByText("Playlist")).toBeNull();
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

	it("exposes the track count as a preview-opening button when canLoadTracks is true", () => {
		render(
			<QueryClientProvider client={makeQueryClient()}>
				<PlaylistReviewItemSection
					itemKey="pl-1"
					reviewItem={REVIEW_ITEM}
					canLoadTracks
				/>
			</QueryClientProvider>,
		);
		// Playlist mode's keyboard/touch entry point is the "N songs" count rendered
		// as a real button (a disclosure for the track-list dialog), not a focusable
		// div — so it's reachable and announced without relying on hover.
		const handle = screen.getByRole("button", { name: /15 songs/i });
		expect(handle.getAttribute("aria-haspopup")).toBe("dialog");
		expect(handle.getAttribute("aria-expanded")).toBe("false");
	});

	it("renders the count as static text with no trigger when canLoadTracks is false", () => {
		render(
			<QueryClientProvider client={makeQueryClient()}>
				<PlaylistReviewItemSection
					itemKey="pl-1"
					reviewItem={REVIEW_ITEM}
					canLoadTracks={false}
				/>
			</QueryClientProvider>,
		);
		// Demo/walkthrough mode has no preview, so the count is plain text — no
		// button, no focusable region.
		expect(screen.queryByRole("button")).toBeNull();
		expect(document.querySelector('[tabindex="0"]')).toBeNull();
	});
});
