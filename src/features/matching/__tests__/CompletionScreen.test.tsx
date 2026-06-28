import { describe, expect, it, vi } from "vitest";
import type { CompletionStats, ReviewedItem } from "@/features/matching/types";
import { render, screen } from "@/test/utils/render";
import { CompletionScreen } from "../sections/CompletionScreen";

const BASE_STATS: CompletionStats = {
	totalItems: 10,
	itemsMatched: 3,
	totalAdditions: 5,
	dismissedCount: 2,
	skippedCount: 4,
};

const ITEMS: ReviewedItem[] = [
	{ id: "s1", albumArtUrl: null, name: "Song One", artist: "Artist A" },
	{ id: "s2", albumArtUrl: null, name: "Song Two", artist: "Artist B" },
];

describe("CompletionScreen", () => {
	it("renders the completion heading", () => {
		render(<CompletionScreen stats={BASE_STATS} items={[]} onExit={vi.fn()} />);
		expect(screen.getByText("You're caught up")).toBeDefined();
	});

	it("renders 'Matched this round' recap label (H5)", () => {
		render(
			<CompletionScreen stats={BASE_STATS} items={ITEMS} onExit={vi.fn()} />,
		);
		expect(screen.getByText("Matched this round")).toBeDefined();
	});

	it("does not render the recap section when items list is empty", () => {
		render(<CompletionScreen stats={BASE_STATS} items={[]} onExit={vi.fn()} />);
		expect(screen.queryByText("Matched this round")).toBeNull();
	});

	it("renders addition count and copy", () => {
		render(<CompletionScreen stats={BASE_STATS} items={[]} onExit={vi.fn()} />);
		// totalAdditions = 5
		expect(screen.getByText("5")).toBeDefined();
		expect(screen.getByText("new additions to your playlists")).toBeDefined();
	});

	it("uses singular addition copy when totalAdditions is 1", () => {
		render(
			<CompletionScreen
				stats={{ ...BASE_STATS, totalAdditions: 1 }}
				items={[]}
				onExit={vi.fn()}
			/>,
		);
		expect(screen.getByText("new addition to your playlists")).toBeDefined();
	});

	it("renders dismissed count", () => {
		render(<CompletionScreen stats={BASE_STATS} items={[]} onExit={vi.fn()} />);
		expect(screen.getByText(/dismissed/i)).toBeDefined();
	});

	it("renders skipped count", () => {
		render(<CompletionScreen stats={BASE_STATS} items={[]} onExit={vi.fn()} />);
		expect(screen.getByText(/skipped/i)).toBeDefined();
	});

	it("renders reviewed item names in the recap", () => {
		render(
			<CompletionScreen stats={BASE_STATS} items={ITEMS} onExit={vi.fn()} />,
		);
		expect(screen.getByText("Song One")).toBeDefined();
		expect(screen.getByText("Song Two")).toBeDefined();
	});

	it("calls onExit when Back to Home is clicked", async () => {
		const onExit = vi.fn();
		const { user } = render(
			<CompletionScreen stats={BASE_STATS} items={[]} onExit={onExit} />,
		);
		await user.click(screen.getByRole("button", { name: /Back to Home/i }));
		expect(onExit).toHaveBeenCalledOnce();
	});

	it("renders a placeholder instead of a broken image when artwork is null", () => {
		const { container } = render(
			<CompletionScreen
				stats={BASE_STATS}
				items={[
					{
						id: "s1",
						albumArtUrl: null,
						name: "No Art Song",
						artist: "Artist A",
					},
				]}
				onExit={vi.fn()}
			/>,
		);
		// A null-artwork item renders no <img> tag (which would show a broken icon)
		// and instead surfaces an aria-labelled placeholder…
		expect(container.querySelector("img")).toBeNull();
		expect(
			screen.getByRole("img", { name: "No Art Song — Artist A" }),
		).toBeDefined();
		// …while the item name is still shown via the recap caption.
		expect(screen.getByText("No Art Song")).toBeDefined();
	});

	it("renders the album art image when artwork is present", () => {
		const { container } = render(
			<CompletionScreen
				stats={BASE_STATS}
				items={[
					{
						id: "s1",
						albumArtUrl: "https://img.example/cover.jpg",
						name: "Has Art",
						artist: "Artist A",
					},
				]}
				onExit={vi.fn()}
			/>,
		);
		const img = container.querySelector("img");
		expect(img?.getAttribute("src")).toBe("https://img.example/cover.jpg");
	});

	it("does not render dismissed stat when dismissedCount is 0", () => {
		render(
			<CompletionScreen
				stats={{ ...BASE_STATS, dismissedCount: 0 }}
				items={[]}
				onExit={vi.fn()}
			/>,
		);
		expect(screen.queryByText(/dismissed/i)).toBeNull();
	});
});
