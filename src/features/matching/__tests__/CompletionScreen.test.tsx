import { describe, expect, it, vi } from "vitest";
import type { CompletionStats } from "@/features/matching/types";
import { render, screen } from "@/test/utils/render";
import { CompletionScreen } from "../sections/CompletionScreen";

const BASE_STATS: CompletionStats = {
	totalItems: 10,
	itemsMatched: 3,
	totalAdditions: 5,
	dismissedCount: 2,
	skippedCount: 4,
};

describe("CompletionScreen", () => {
	it.each([
		{ totalAdditions: 1, noun: /\baddition\b/i },
		{ totalAdditions: 5, noun: /\badditions\b/i },
	])("pluralizes the addition noun for $totalAdditions", ({
		totalAdditions,
		noun,
	}) => {
		render(
			<CompletionScreen
				stats={{ ...BASE_STATS, totalAdditions }}
				items={[]}
				onExit={vi.fn()}
			/>,
		);
		expect(screen.getByText(new RegExp(`^${totalAdditions}$`))).toBeDefined();
		expect(screen.getByText(noun)).toBeDefined();
	});

	it("renders the dismissed count", () => {
		render(<CompletionScreen stats={BASE_STATS} items={[]} onExit={vi.fn()} />);
		expect(screen.getByText(/dismissed/i).parentElement?.textContent).toMatch(
			/^2\s+dismissed$/i,
		);
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

	it("calls onExit when Back to Home is clicked", async () => {
		const onExit = vi.fn();
		const { user } = render(
			<CompletionScreen stats={BASE_STATS} items={[]} onExit={onExit} />,
		);
		await user.click(screen.getByRole("button", { name: /back to home/i }));
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
		// and instead surfaces an aria-labelled placeholder.
		expect(container.querySelector("img")).toBeNull();
		expect(
			screen.getByRole("img", { name: /no art song.*artist a/i }),
		).toBeDefined();
	});

	it("renders the album art image when artwork is present", () => {
		render(
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
		expect(
			screen.getByRole("img", { name: /has art/i }).getAttribute("src"),
		).toBe("https://img.example/cover.jpg");
	});
});
