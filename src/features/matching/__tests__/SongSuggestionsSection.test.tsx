import { describe, expect, it, vi } from "vitest";
import type {
	SongForMatching,
	SongSuggestionRow,
} from "@/features/matching/types";
import { render, screen } from "@/test/utils/render";
import { SongSuggestionsSection } from "../components/SongSuggestionsSection";

function makeSong(overrides?: Partial<SongForMatching>): SongForMatching {
	return {
		id: "song-1",
		spotifyId: "sp-1",
		name: "Echoes",
		artist: "Pink Floyd",
		album: "Meddle",
		albumArtUrl: null,
		genres: [],
		audioFeatures: null,
		analysis: null,
		...overrides,
	};
}

function makeRow(
	song?: Partial<SongForMatching>,
	fitScore = 0.82,
): SongSuggestionRow {
	return { song: makeSong(song), fitScore };
}

const SUGGESTIONS: SongSuggestionRow[] = [
	makeRow({ id: "song-1", name: "Echoes", artist: "Pink Floyd" }, 0.82),
	makeRow(
		{ id: "song-2", name: "Comfortably Numb", artist: "Pink Floyd" },
		0.75,
	),
];

const DEFAULT_PROPS = {
	itemKey: "pl-1",
	suggestions: SUGGESTIONS,
	addedTo: [] as string[],
	onAdd: vi.fn(),
	onDismiss: vi.fn(),
	onNext: vi.fn(),
};

describe("SongSuggestionsSection", () => {
	it("renders the section heading", () => {
		render(<SongSuggestionsSection {...DEFAULT_PROPS} />);
		expect(screen.getByText("Song Suggestions")).toBeDefined();
	});

	it("renders song name and artist for each suggestion", () => {
		render(<SongSuggestionsSection {...DEFAULT_PROPS} />);
		expect(screen.getByText("Echoes")).toBeDefined();
		// Both suggestions share the same artist; getAllByText asserts both rows appear.
		expect(screen.getAllByText("Pink Floyd")).toHaveLength(2);
		expect(screen.getByText("Comfortably Numb")).toBeDefined();
	});

	it("renders match percent from fitScore", () => {
		render(<SongSuggestionsSection {...DEFAULT_PROPS} />);
		// fitScore 0.82 → 82%, 0.75 → 75%
		expect(screen.getByText("82%")).toBeDefined();
		expect(screen.getByText("75%")).toBeDefined();
	});

	it("renders Add buttons for unadded suggestions", () => {
		render(<SongSuggestionsSection {...DEFAULT_PROPS} />);
		const addButtons = screen.getAllByRole("button", { name: "Add" });
		expect(addButtons).toHaveLength(2);
	});

	it("calls onAdd with the suggestion song id when Add is clicked", async () => {
		const onAdd = vi.fn();
		const { user } = render(
			<SongSuggestionsSection {...DEFAULT_PROPS} onAdd={onAdd} />,
		);
		const addButtons = screen.getAllByRole("button", { name: "Add" });
		await user.click(addButtons[0]);
		expect(onAdd).toHaveBeenCalledWith("song-1");
	});

	it("shows 'Added' text and hides Add button for songs in addedTo", () => {
		render(<SongSuggestionsSection {...DEFAULT_PROPS} addedTo={["song-1"]} />);
		// song-1 is added: shows "Added" text
		expect(screen.getByText("Added")).toBeDefined();
		// song-2 is not added: still has Add button
		const addButtons = screen.getAllByRole("button", { name: "Add" });
		expect(addButtons).toHaveLength(1);
	});

	it("disables Add buttons when navigationDisabled is true", () => {
		render(<SongSuggestionsSection {...DEFAULT_PROPS} navigationDisabled />);
		const addButtons = screen.getAllByRole("button", { name: "Add" });
		for (const btn of addButtons) {
			expect((btn as HTMLButtonElement).disabled).toBe(true);
		}
	});

	it("disables navigation controls when navigationDisabled is true", () => {
		render(
			<SongSuggestionsSection
				{...DEFAULT_PROPS}
				navigationDisabled
				onPrevious={vi.fn()}
			/>,
		);
		const dismissBtn = screen.getByRole("button", { name: /Dismiss/i });
		const prevBtn = screen.getByRole("button", { name: /Previous/i });
		const nextBtn = screen.getByRole("button", { name: /Skip Playlist/i });
		expect((dismissBtn as HTMLButtonElement).disabled).toBe(true);
		expect((prevBtn as HTMLButtonElement).disabled).toBe(true);
		expect((nextBtn as HTMLButtonElement).disabled).toBe(true);
	});

	it("renders Dismiss button that calls onDismiss", async () => {
		const onDismiss = vi.fn();
		const { user } = render(
			<SongSuggestionsSection {...DEFAULT_PROPS} onDismiss={onDismiss} />,
		);
		await user.click(screen.getByRole("button", { name: /Dismiss/i }));
		expect(onDismiss).toHaveBeenCalledOnce();
	});

	it("renders Skip Playlist button that calls onNext", async () => {
		const onNext = vi.fn();
		const { user } = render(
			<SongSuggestionsSection {...DEFAULT_PROPS} onNext={onNext} />,
		);
		await user.click(screen.getByRole("button", { name: /Skip Playlist/i }));
		expect(onNext).toHaveBeenCalledOnce();
	});

	it("shows 'Finish matching' on the last item instead of 'Skip Playlist'", () => {
		render(<SongSuggestionsSection {...DEFAULT_PROPS} isLastItem />);
		expect(screen.getByText("Finish matching")).toBeDefined();
		expect(screen.queryByText("Skip Playlist")).toBeNull();
	});

	it("renders Previous button when onPrevious is provided", async () => {
		const onPrevious = vi.fn();
		const { user } = render(
			<SongSuggestionsSection {...DEFAULT_PROPS} onPrevious={onPrevious} />,
		);
		const prevBtn = screen.getByRole("button", { name: /Previous/i });
		await user.click(prevBtn);
		expect(onPrevious).toHaveBeenCalledOnce();
	});

	it("does not render Previous button when onPrevious is absent", () => {
		render(<SongSuggestionsSection {...DEFAULT_PROPS} />);
		expect(screen.queryByRole("button", { name: /Previous/i })).toBeNull();
	});

	it("renders without crashing when suggestions list is empty", () => {
		render(<SongSuggestionsSection {...DEFAULT_PROPS} suggestions={[]} />);
		expect(screen.getByText("Song Suggestions")).toBeDefined();
	});

	it("renders all suggestions in a long list", () => {
		const many = Array.from({ length: 10 }, (_, i) =>
			makeRow(
				{ id: `song-${i}`, name: `Song ${i}`, artist: `Artist ${i}` },
				0.5 + i * 0.04,
			),
		);
		render(<SongSuggestionsSection {...DEFAULT_PROPS} suggestions={many} />);
		for (let i = 0; i < 10; i++) {
			expect(screen.getByText(`Song ${i}`)).toBeDefined();
		}
	});

	it("renders without crashing with suppressTransition", () => {
		render(<SongSuggestionsSection {...DEFAULT_PROPS} suppressTransition />);
		expect(screen.getByText("Song Suggestions")).toBeDefined();
	});

	it("play preview button has an accessible aria-label for each song", () => {
		const suggestions = [
			makeRow({ id: "song-1", name: "Echoes", spotifyId: "sp-1" }),
		];
		render(
			<SongSuggestionsSection {...DEFAULT_PROPS} suggestions={suggestions} />,
		);
		// The play button aria-label includes the song name for screen reader users.
		expect(
			screen.getByRole("button", { name: /Play preview for Echoes/i }),
		).toBeDefined();
	});

	it("play preview button appears before Add button in DOM order", () => {
		const suggestions = [
			makeRow({ id: "song-1", name: "Echoes", spotifyId: "sp-1" }),
		];
		render(
			<SongSuggestionsSection {...DEFAULT_PROPS} suggestions={suggestions} />,
		);
		const buttons = screen.getAllByRole("button");
		const playIdx = buttons.findIndex((b) =>
			b.getAttribute("aria-label")?.startsWith("Play preview"),
		);
		const addIdx = buttons.findIndex((b) => b.textContent?.trim() === "Add");
		// Play button must precede Add in tab order for keyboard navigation requirement.
		expect(playIdx).toBeLessThan(addIdx);
	});

	it("does not show play button for songs without a spotifyId", () => {
		const suggestions = [
			makeRow({ id: "song-1", name: "Echoes", spotifyId: "" }),
		];
		render(
			<SongSuggestionsSection {...DEFAULT_PROPS} suggestions={suggestions} />,
		);
		expect(screen.queryByRole("button", { name: /Play preview/i })).toBeNull();
	});

	it("added rows remain visible after being added", () => {
		render(
			<SongSuggestionsSection
				{...DEFAULT_PROPS}
				addedTo={["song-1", "song-2"]}
			/>,
		);
		// Both songs are still in the list (visible), just marked Added.
		expect(screen.getByText("Echoes")).toBeDefined();
		expect(screen.getByText("Comfortably Numb")).toBeDefined();
		const addedLabels = screen.getAllByText("Added");
		expect(addedLabels).toHaveLength(2);
	});
});
