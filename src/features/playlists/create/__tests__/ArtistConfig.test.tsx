/**
 * Tests for ArtistConfig: chip sorting (active first, like-count desc),
 * body-click toggle, ✕ remove (outright, no undo), search mode
 * (flat results, add-on-toggle), the browse/search combobox's keyboard
 * navigation and bounded browse rendering,
 * the "+N more" overflow dialog with search-within filtering and resilient
 * focus containment, and the resolution-error affordance
 * (chips would otherwise be stuck at a pending "…" with no explanation).
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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
	options: {
		isResolutionError?: boolean;
		aggregate?: Array<{ name: string; count: number }>;
	} = {},
) {
	const aggregate = options.aggregate ?? AGGREGATE;
	searchLikedArtistsMock.mockImplementation(
		({ data }: { data: { query: string } }) => {
			const q = data.query.trim().toLowerCase();
			return Promise.resolve({
				artists:
					q === ""
						? aggregate
						: aggregate.filter((a) => a.name.toLowerCase().includes(q)),
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

function StatefulArtistPanel({ initial }: { initial: ArtistSelectionVM[] }) {
	const [selections, setSelections] = useState(initial);
	return (
		<ArtistConfig
			selections={selections}
			onAddArtist={vi.fn()}
			onToggleArtist={vi.fn()}
			onRemoveArtist={(name) =>
				setSelections((current) => current.filter((s) => s.name !== name))
			}
			isResolutionError={false}
			onRetryResolution={vi.fn()}
		/>
	);
}

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

		// Search lives behind a compact trigger; open it before typing.
		await user.click(
			screen.getByRole("button", { name: /selected|Find a liked artist/ }),
		);
		await user.type(
			screen.getByRole("combobox", { name: "Search your liked artists" }),
			"men",
		);

		const addOption = await screen.findByRole("option", {
			name: "Add Men I Trust",
		});
		await user.click(addOption);
		expect(onAddArtist).toHaveBeenCalledWith("Men I Trust");
	});

	it("an already-added search result shows its current state instead of Add", async () => {
		const user = userEvent.setup();
		const onToggleArtist = vi.fn();
		renderPanel([sel("Clairo", false)], { onToggleArtist });

		// Search lives behind a compact trigger; open it before typing.
		await user.click(
			screen.getByRole("button", { name: /selected|Find a liked artist/ }),
		);
		await user.type(
			screen.getByRole("combobox", { name: "Search your liked artists" }),
			"clairo",
		);

		const enableOption = await screen.findByRole("option", {
			name: "Enable Clairo",
		});
		await user.click(enableOption);
		expect(onToggleArtist).toHaveBeenCalledWith("Clairo");
	});

	describe("browse list keyboard interaction (combobox pattern)", () => {
		it("ArrowDown moves the active option and Enter selects it", async () => {
			const user = userEvent.setup();
			const onAddArtist = vi.fn();
			renderPanel([], { onAddArtist });

			await user.click(
				screen.getByRole("button", { name: /selected|Find a liked artist/ }),
			);
			const combobox = await screen.findByRole("combobox", {
				name: "Search your liked artists",
			});
			// Browse mode (empty query) lists the like-count aggregate in its
			// given order: KAYTRANADA (26), Clairo (19), Men I Trust (12).
			await screen.findByRole("option", { name: "Add KAYTRANADA" });

			await user.click(combobox);
			await user.keyboard("{ArrowDown}{Enter}");

			// Regression: without ArrowDown moving the active option, Enter would
			// select the first result (KAYTRANADA) instead of the second (Clairo).
			expect(onAddArtist).toHaveBeenCalledWith("Clairo");
			expect(onAddArtist).not.toHaveBeenCalledWith("KAYTRANADA");
		});

		it("caps browse rendering at 50 options instead of mounting the full aggregate", async () => {
			const user = userEvent.setup();
			const aggregate = Array.from({ length: 75 }, (_, index) => ({
				name: `Artist ${index + 1}`,
				count: 75 - index,
			}));
			renderPanel([], {}, { aggregate });

			await user.click(
				screen.getByRole("button", { name: /selected|Find a liked artist/ }),
			);
			const listbox = await screen.findByRole("listbox", {
				name: "Liked artists",
			});
			expect(within(listbox).getAllByRole("option")).toHaveLength(50);
		});

		it("Tab from the search input skips past the option list", async () => {
			const user = userEvent.setup();
			renderPanel([]);

			await user.click(
				screen.getByRole("button", { name: /selected|Find a liked artist/ }),
			);
			const combobox = await screen.findByRole("combobox", {
				name: "Search your liked artists",
			});
			await screen.findAllByRole("option");

			await user.click(combobox);
			await user.tab();

			expect(
				screen.getByRole("button", { name: "Close artist search" }),
			).toHaveFocus();
		});
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

	it("traps Tab/Shift+Tab within the overflow dialog and restores focus to the trigger on close", async () => {
		const user = userEvent.setup();
		const many = Array.from({ length: 11 }, (_, i) => sel(`Artist ${i + 1}`));
		renderPanel(many);

		const moreButton = screen.getByRole("button", { name: "+3 more" });
		await user.click(moreButton);

		const dialog = screen.getByRole("dialog", { name: "Selected artists" });
		const closeButton = within(dialog).getByRole("button", { name: "Close" });
		const dialogButtons = within(dialog).getAllByRole("button");
		const lastFocusable = dialogButtons[dialogButtons.length - 1];

		// Initial focus lands on the dialog container itself.
		expect(dialog).toHaveFocus();

		// Regression: without an explicit trap, Shift+Tab from the initial focus
		// would walk backward past the dialog into the backdrop/obscured page.
		await user.tab({ shift: true });
		expect(lastFocusable).toHaveFocus();

		// Regression: without wrapping, forward Tab from the last element would
		// escape to whatever follows the portal in the document.
		await user.tab();
		expect(closeButton).toHaveFocus();

		await user.click(closeButton);
		expect(moreButton).toHaveFocus();
	});

	it("keeps focus inside the overflow dialog when the focused artist is removed", async () => {
		const user = userEvent.setup();
		const many = Array.from({ length: 11 }, (_, i) => sel(`Artist ${i + 1}`));
		searchLikedArtistsMock.mockResolvedValue({ artists: AGGREGATE });
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={queryClient}>
				<StatefulArtistPanel initial={many} />
			</QueryClientProvider>,
		);

		await user.click(screen.getByRole("button", { name: "+3 more" }));
		const dialog = screen.getByRole("dialog", { name: "Selected artists" });
		await user.click(
			within(dialog).getByRole("button", { name: "Remove Artist 1" }),
		);

		await waitFor(() =>
			expect(dialog).toContainElement(document.activeElement as HTMLElement),
		);
		await user.tab();
		expect(dialog).toContainElement(document.activeElement as HTMLElement);
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
