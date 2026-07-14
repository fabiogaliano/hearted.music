/**
 * Tests for the ideas screen's "or add more" affordance on the artist and genre
 * cards: it commits the seed AND flags the matching focus (focusArtistSearch /
 * focusGenreSearch) so the studio lands with that search focused — the studio,
 * not the tiny card, is where a list of artists (or a genre blend) is managed.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { TasteProfileVM } from "../ideaTypes";

vi.mock("@/lib/server/playlists.functions", () => ({
	getTasteProfile: vi.fn(),
	searchLikedArtists: vi.fn(),
	resolveLikedArtistSongs: vi.fn(),
}));
vi.mock("@/lib/server/billing.functions", () => ({
	getIntentEligibility: vi.fn(),
}));

import { IdeasBoard } from "../ideas/IdeasBoard";
import { intentEligibilityQueryOptions } from "../intentEligibility";
import { tasteProfileQueryOptions } from "../tasteProfile";

const PROFILE: TasteProfileVM = {
	totalLikedCount: 120,
	likedWindows: [],
	// count >= 20 keeps the genre idea above buildPlaylistIdeas' floor.
	topGenres: [{ name: "indie", count: 72 }],
	// count >= 8 keeps the artist idea above buildPlaylistIdeas' floor.
	topArtists: [{ name: "Clairo", count: 19 }],
	decades: [],
};

function renderIdeasBoard(onSeed = vi.fn()) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	// The route loader pre-warms both caches; tests seed them directly the same
	// way the stories do, so no server fn ever runs.
	queryClient.setQueryData(tasteProfileQueryOptions().queryKey, PROFILE);
	queryClient.setQueryData(intentEligibilityQueryOptions().queryKey, {
		allowed: false,
		criteria: [],
	});
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
	render(<IdeasBoard onSeed={onSeed} onUnlock={vi.fn()} onBack={vi.fn()} />, {
		wrapper,
	});
	return onSeed;
}

describe("IdeasBoard — artist card + affordance", () => {
	it("commits the artist seed with focusArtistSearch when the add-more action is clicked", async () => {
		const user = userEvent.setup();
		const onSeed = renderIdeasBoard();

		await user.click(
			screen.getByRole("button", {
				name: /add other artists/i,
			}),
		);

		expect(onSeed).toHaveBeenCalledTimes(1);
		const [idea, intentText] = onSeed.mock.calls[0] ?? [];
		expect(idea).toMatchObject({
			anchorArtist: "Clairo",
			focusArtistSearch: true,
		});
		expect(intentText).toBe("");
	});

	it("the plain commit arrow does not set focusArtistSearch", async () => {
		const user = userEvent.setup();
		const onSeed = renderIdeasBoard();

		await user.click(
			screen.getByRole("button", { name: /^Start from Around Clairo$/i }),
		);

		const [idea] = onSeed.mock.calls[0] ?? [];
		expect(idea).toMatchObject({ anchorArtist: "Clairo" });
		expect(idea.focusArtistSearch).toBeUndefined();
	});

	it("commits the genre seed with focusGenreSearch when its add-more action is clicked", async () => {
		const user = userEvent.setup();
		const onSeed = renderIdeasBoard();

		await user.click(
			screen.getByRole("button", {
				name: /add more genres/i,
			}),
		);

		expect(onSeed).toHaveBeenCalledTimes(1);
		const [idea] = onSeed.mock.calls[0] ?? [];
		expect(idea).toMatchObject({
			genrePills: ["indie"],
			focusGenreSearch: true,
		});
		expect(idea.focusArtistSearch).toBeUndefined();
	});
});
