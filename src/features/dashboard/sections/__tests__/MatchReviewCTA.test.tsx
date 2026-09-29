import { describe, expect, it } from "vitest";
import { MatchReviewCTA } from "@/features/dashboard/sections/MatchReviewCTA";
import type { MatchPreview } from "@/features/dashboard/types";
import { renderWithRouter, screen } from "@/test/utils/render";

const previews: MatchPreview[] = [
	{ id: 1, image: "https://example.test/a.jpg", name: "A", artist: "X" },
];

describe("MatchReviewCTA — orientation awareness (A2)", () => {
	it("renders nothing when there is nothing to review", async () => {
		await renderWithRouter(
			<MatchReviewCTA reviewCount={0} matchPreviews={[]} orientation="song" />,
		);
		expect(screen.queryByRole("link")).toBeNull();
	});

	it("links to ?mode=song and counts songs for song orientation", async () => {
		await renderWithRouter(
			<MatchReviewCTA
				reviewCount={3}
				matchPreviews={previews}
				orientation="song"
			/>,
		);
		expect(screen.getByRole("link", { name: /\b3 songs\b/i })).toHaveAttribute(
			"href",
			"/match?mode=song",
		);
	});

	it("links to bare /match and counts playlists for playlist orientation", async () => {
		await renderWithRouter(
			<MatchReviewCTA
				reviewCount={2}
				matchPreviews={previews}
				orientation="playlist"
			/>,
		);
		expect(
			screen.getByRole("link", { name: /\b2 playlists\b/i }),
		).toHaveAttribute("href", "/match");
	});

	it("uses the singular noun for a single item", async () => {
		await renderWithRouter(
			<MatchReviewCTA
				reviewCount={1}
				matchPreviews={previews}
				orientation="playlist"
			/>,
		);
		expect(
			screen.getByRole("link", { name: /\b1 playlist(?!s)\b/i }),
		).toBeInTheDocument();
	});
});
