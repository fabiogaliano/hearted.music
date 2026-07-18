/**
 * Tests for ArtistConfig: chip sorting (active first, like-count desc),
 * body-click toggle, ✕ remove (outright, no undo), search mode
 * (flat results, add-on-toggle), the "+N more" overflow dialog with
 * search-within filtering, and the resolution-error affordance (chips would
 * otherwise be stuck at a pending "…" with no explanation).
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ArtistSelectionVM } from "../useCreatePlaylistDraft";

// The overflow dialog registers an Escape shortcut; the provider isn't mounted
// in these tests, so stub the hook — close behavior is exercised via the ✕.
vi.mock("@/lib/keyboard/useShortcut", () => ({ useShortcut: vi.fn() }));

const searchLikedArtistsMock = vi.fn();
vi.mock("@/lib/server/playlists.functions", () => ({
	searchLikedArtists: (...args: unknown[]) => searchLikedArtistsMock(...args),
	resolveLikedArtistSongs: vi.fn(),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArtistConfig } from "../config/ArtistConfig";

const AGGREGATE = [
	{ name: "KAYTRANADA", count: 26 },
	{ name: "Clairo", count: 19 },
	{ name: "Men I Trust", count: 12 },
];

function renderPanel(
	selections: ArtistSelectionVM[],
	handlers: Partial<{
		onAddArtist: (name: string) => void;
		onToggleArtist: (name: string) => void;
		onRemoveArtist: (name: string) => void;
		onRetryResolution: () => void;
	}> = {},
	options: { isResolutionError?: boolean } = {},
) {
	searchLikedArtistsMock.mockImplementation(
		({ data }: { data: { query: string } }) => {
			const q = data.query.trim().toLowerCase();
			return Promise.resolve({
				artists:
					q === ""
						? AGGREGATE
						: AGGREGATE.filter((a) => a.name.toLowerCase().includes(q)),
			});
		},
	);
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<ArtistConfig
				selections={selections}
				onAddArtist={handlers.onAddArtist ?? vi.fn()}
				onToggleArtist={handlers.onToggleArtist ?? vi.fn()}
				onRemoveArtist={handlers.onRemoveArtist ?? vi.fn()}
				isResolutionError={options.isResolutionError ?? false}
				onRetryResolution={handlers.onRetryResolution ?? vi.fn()}
			/>
		</QueryClientProvider>,
	);
}

const sel = (
	name: string,
	enabled = true,
	songCount: number | null = 5,
): ArtistSelectionVM => ({ name, enabled, songCount });

describe("ArtistConfig", () => {
	it("sorts chips active-first, then by like-count desc within each group", async () => {
		renderPanel([
			sel("Men I Trust", false),
			sel("Clairo", true),
			sel("KAYTRANADA", true),
		]);

		// Sorting depends on the like-count aggregate landing.
		await waitFor(() => {
			const toggles = screen.getAllByRole("button", {
				name: /^(Enable|Disable) /,
			});
			expect(toggles.map((b) => b.getAttribute("aria-label"))).toEqual([
				"Disable KAYTRANADA", // active, 26 likes
				"Disable Clairo", // active, 19 likes
				"Enable Men I Trust", // inactive last
			]);
		});
	});

	it("chip body click toggles; ✕ removes outright", async () => {
		const user = userEvent.setup();
		const onToggleArtist = vi.fn();
		const onRemoveArtist = vi.fn();
		renderPanel([sel("Clairo"), sel("KAYTRANADA", false)], {
			onToggleArtist,
			onRemoveArtist,
		});

		await user.click(screen.getByRole("button", { name: "Disable Clairo" }));
		expect(onToggleArtist).toHaveBeenCalledWith("Clairo");

		await user.click(screen.getByRole("button", { name: "Remove KAYTRANADA" }));
		expect(onRemoveArtist).toHaveBeenCalledWith("KAYTRANADA");
	});

	it("search shows a flat result list; toggling an unselected result adds it", async () => {
		const user = userEvent.setup();
		const onAddArtist = vi.fn();
		renderPanel([sel("Clairo")], { onAddArtist });

		await user.type(
			screen.getByRole("textbox", { name: "Search your liked artists" }),
			"men",
		);

		const addButton = await screen.findByRole("button", {
			name: "Add Men I Trust",
		});
		await user.click(addButton);
		expect(onAddArtist).toHaveBeenCalledWith("Men I Trust");
	});

	it("an already-added search result shows its current state instead of Add", async () => {
		const user = userEvent.setup();
		const onToggleArtist = vi.fn();
		renderPanel([sel("Clairo", false)], { onToggleArtist });

		await user.type(
			screen.getByRole("textbox", { name: "Search your liked artists" }),
			"clairo",
		);

		const enableButton = await screen.findByRole("button", {
			name: "Enable Clairo",
		});
		await user.click(enableButton);
		expect(onToggleArtist).toHaveBeenCalledWith("Clairo");
	});

	it("caps inline chips and opens the overflow dialog with search-within", async () => {
		const user = userEvent.setup();
		const many = Array.from({ length: 11 }, (_, i) => sel(`Artist ${i + 1}`));
		renderPanel(many);

		const moreButton = screen.getByRole("button", { name: "+3 more" });
		await user.click(moreButton);

		const dialog = screen.getByRole("dialog", { name: "Selected artists" });
		// The full set is manageable inside the dialog.
		expect(
			within(dialog).getAllByRole("button", { name: /^Disable / }),
		).toHaveLength(11);

		await user.type(
			within(dialog).getByRole("textbox", {
				name: "Search within selected artists",
			}),
			"Artist 11",
		);
		expect(
			within(dialog).getAllByRole("button", { name: /^Disable / }),
		).toHaveLength(1);
	});

	describe("resolution error", () => {
		it("does not render the error notice or retry when isResolutionError is false", () => {
			renderPanel([sel("Clairo")], {}, { isResolutionError: false });
			expect(
				screen.queryByRole("button", { name: /retry/i }),
			).not.toBeInTheDocument();
		});

		it("surfaces a failure notice with a retry affordance when isResolutionError is true", () => {
			renderPanel([sel("Clairo", true, null)], {}, { isResolutionError: true });
			expect(
				screen.getByText(/couldn't load song counts/i),
			).toBeInTheDocument();
			expect(
				screen.getByRole("button", { name: /retry/i }),
			).toBeInTheDocument();
		});

		it("calls onRetryResolution when the retry button is clicked", async () => {
			const user = userEvent.setup();
			const onRetryResolution = vi.fn();
			renderPanel(
				[sel("Clairo", true, null)],
				{ onRetryResolution },
				{ isResolutionError: true },
			);
			await user.click(screen.getByRole("button", { name: /retry/i }));
			expect(onRetryResolution).toHaveBeenCalledTimes(1);
		});
	});
});
