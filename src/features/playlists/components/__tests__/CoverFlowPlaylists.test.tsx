import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KeyboardShortcutProvider } from "@/lib/keyboard/KeyboardShortcutProvider";
import { CoverFlowPlaylists } from "../CoverFlowPlaylists";
import type { PlaylistSummary } from "../types";

function summary(id: string, isTarget: boolean): PlaylistSummary {
	return {
		id,
		name: `Playlist ${id}`,
		isTarget,
		songCount: 10,
		imageUrl: null,
		intent: null,
		genres: [],
		matchFilters: { version: 1 },
	};
}

const PLAYLISTS: PlaylistSummary[] = [
	summary("m1", true),
	summary("m2", true),
	summary("lib", false),
];

/**
 * A real memory router rather than a mocked `Link` — the masthead's create card
 * is an anchor, and stubbing @tanstack/* out is the kind of over-mocking that
 * makes a test pass while the real tree can't mount.
 */
async function mount(props: {
	detailOpen?: boolean;
	onOpen: (id: string) => void;
}) {
	const rootRoute = createRootRoute();
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => (
			<KeyboardShortcutProvider>
				<CoverFlowPlaylists
					playlists={PLAYLISTS}
					onOpen={props.onOpen}
					detailOpen={props.detailOpen}
				/>
			</KeyboardShortcutProvider>
		),
	});
	const createRouteStub = createRoute({
		getParentRoute: () => rootRoute,
		path: "/playlists/new",
		component: () => null,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute, createRouteStub]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	await router.load();
	return render(<RouterProvider router={router as never} />);
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("CoverFlowPlaylists keyboard gating", () => {
	it("opens the centered candidate on Enter from the bare list", async () => {
		const onOpen = vi.fn();
		await mount({ onOpen });

		fireEvent.keyDown(window, { key: "Enter" });

		expect(onOpen).toHaveBeenCalledWith("m1");
	});

	it("moves the cover flow with l before opening", async () => {
		const onOpen = vi.fn();
		await mount({ onOpen });

		fireEvent.keyDown(window, { key: "l" });
		fireEvent.keyDown(window, { key: "Enter" });

		expect(onOpen).toHaveBeenCalledWith("m2");
	});

	it("ignores keyboard nav while the detail panel is open", async () => {
		const onOpen = vi.fn();
		await mount({ onOpen, detailOpen: true });

		fireEvent.keyDown(window, { key: "l" });
		fireEvent.keyDown(window, { key: "Enter" });

		expect(onOpen).not.toHaveBeenCalled();
	});

	// Regression pin for the search relocation: nav used to be gated off by a
	// non-empty query, because a query swapped the shelf out for a flat results
	// rail. The shelf stays mounted now, and a visible shelf that silently stops
	// answering its own keys is a bug, not a safeguard.
	it("keeps cover-flow nav live while the library search holds a query", async () => {
		const onOpen = vi.fn();
		await mount({ onOpen });

		fireEvent.change(screen.getByLabelText("Search library"), {
			target: { value: "Playlist" },
		});
		fireEvent.keyDown(window, { key: "Enter" });

		expect(onOpen).toHaveBeenCalledWith("m1");
	});
});

describe("CoverFlowPlaylists library search", () => {
	// The scope is the whole point of moving the field onto the library band: it
	// filters that rail, not the page. Filtering `playlists` instead of `library`
	// would drop matching playlists into the library rail, where their rows offer
	// the wrong action.
	it("filters the library rail and never lists a matching playlist in it", async () => {
		await mount({ onOpen: vi.fn() });

		fireEvent.change(screen.getByLabelText("Search library"), {
			target: { value: "Playlist" },
		});

		const libraryPanel = screen.getByText("Library").closest("section");
		expect(libraryPanel).not.toBeNull();
		const library = within(libraryPanel as HTMLElement);
		expect(library.getByRole("button", { name: "Playlist lib" })).toBeDefined();
		expect(library.queryByRole("button", { name: "Playlist m1" })).toBeNull();
		// …and the shelf it used to replace is still on screen holding that same
		// playlist, which is the reason the library rail doesn't need to.
		expect(
			screen.getAllByRole("button", { name: "Playlist m1" }).length,
		).toBeGreaterThan(0);
	});

	it("says the query came up empty, not that the library is", async () => {
		await mount({ onOpen: vi.fn() });

		fireEvent.change(screen.getByLabelText("Search library"), {
			target: { value: "nothing here" },
		});

		expect(screen.getByText(/No playlists match/)).toBeInTheDocument();
	});
});
