/**
 * Tests for the seed stage's artist card "+" affordance: it commits the seed
 * (artist #1 pinned) AND flags focusArtistSearch so the studio lands with the
 * artist search focused — the studio, not the tiny card, is where a list of
 * artists is managed.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { TasteProfileVM } from "../seedTypes";

vi.mock("@/lib/server/playlists.functions", () => ({
	getTasteProfile: vi.fn(),
	searchLikedArtists: vi.fn(),
	resolveLikedArtistSongs: vi.fn(),
}));
vi.mock("@/lib/server/billing.functions", () => ({
	getIntentEligibility: vi.fn(),
}));

import { intentEligibilityQueryOptions } from "../intentEligibility";
import { SeedStage } from "../seed/SeedStage";
import { tasteProfileQueryOptions } from "../tasteProfile";

const PROFILE: TasteProfileVM = {
	totalLikedCount: 120,
	likedWindows: [],
	topGenres: [],
	// count >= 8 keeps the artist template above buildSeedTemplates' floor.
	topArtists: [{ name: "Clairo", count: 19 }],
	decades: [],
};

function renderSeedStage(onSeed = vi.fn()) {
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
	render(<SeedStage onSeed={onSeed} onUnlock={vi.fn()} />, { wrapper });
	return onSeed;
}

describe("SeedStage — artist card + affordance", () => {
	it("commits the artist seed with focusArtistSearch when + is clicked", async () => {
		const user = userEvent.setup();
		const onSeed = renderSeedStage();

		await user.click(
			screen.getByRole("button", {
				name: /add another artist/i,
			}),
		);

		expect(onSeed).toHaveBeenCalledTimes(1);
		const [preset, intentText] = onSeed.mock.calls[0] ?? [];
		expect(preset).toMatchObject({
			pinArtist: "Clairo",
			focusArtistSearch: true,
		});
		expect(intentText).toBe("");
	});

	it("the plain commit arrow does not set focusArtistSearch", async () => {
		const user = userEvent.setup();
		const onSeed = renderSeedStage();

		await user.click(
			screen.getByRole("button", { name: /^Start from Around Clairo$/i }),
		);

		const [preset] = onSeed.mock.calls[0] ?? [];
		expect(preset).toMatchObject({ pinArtist: "Clairo" });
		expect(preset.focusArtistSearch).toBeUndefined();
	});
});
