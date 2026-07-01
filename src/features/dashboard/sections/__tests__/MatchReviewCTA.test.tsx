import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MatchReviewCTA } from "@/features/dashboard/sections/MatchReviewCTA";
import type { MatchPreview } from "@/features/dashboard/types";
import { render, screen } from "@/test/utils/render";

// Capture the Link's target so we can assert the CTA points at the correct
// /match orientation without standing up a full router.
const linkCalls: Array<{ to: unknown; search: unknown }> = [];
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		search,
		children,
	}: {
		to: unknown;
		search: unknown;
		children: ReactNode;
	}) => {
		linkCalls.push({ to, search });
		return <a href={typeof to === "string" ? to : "#"}>{children}</a>;
	},
}));

const previews: MatchPreview[] = [
	{ id: 1, image: "https://example.test/a.jpg", name: "A", artist: "X" },
];

describe("MatchReviewCTA — orientation awareness (A2)", () => {
	beforeEach(() => {
		linkCalls.length = 0;
	});

	it("renders nothing when there is nothing to review", () => {
		render(
			<MatchReviewCTA reviewCount={0} matchPreviews={[]} orientation="song" />,
		);
		// The CTA returns null before rendering its Link, so no target is captured
		// and no copy is emitted.
		expect(linkCalls).toHaveLength(0);
		expect(screen.queryByText(/to match/)).toBeNull();
	});

	it("links to bare /match and reads in songs for song orientation", () => {
		render(
			<MatchReviewCTA
				reviewCount={3}
				matchPreviews={previews}
				orientation="song"
			/>,
		);
		expect(screen.getByText("3 songs to match")).toBeDefined();
		expect(linkCalls).toHaveLength(1);
		expect(linkCalls[0]).toEqual({ to: "/match", search: {} });
	});

	it("links to ?mode=playlist and reads in playlists for playlist orientation", () => {
		render(
			<MatchReviewCTA
				reviewCount={2}
				matchPreviews={previews}
				orientation="playlist"
			/>,
		);
		expect(screen.getByText("2 playlists to match")).toBeDefined();
		expect(linkCalls[0]).toEqual({
			to: "/match",
			search: { mode: "playlist" },
		});
	});

	it("uses the singular noun for a single item", () => {
		render(
			<MatchReviewCTA
				reviewCount={1}
				matchPreviews={previews}
				orientation="playlist"
			/>,
		);
		expect(screen.getByText("1 playlist to match")).toBeDefined();
	});
});
