import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import type { SavePlaylistMatchConfigResult } from "@/lib/server/playlists.functions";
import { SpotlightPanel } from "../SpotlightPanel";
import type { PlaylistSummary } from "../types";

function makePlaylist(over: Partial<PlaylistSummary>): PlaylistSummary {
	return {
		id: "A",
		name: "Playlist A",
		// isTarget true so the writing surface band is interactive (not inert).
		isTarget: true,
		songCount: 0,
		imageUrl: null,
		intent: "alpha intent",
		genres: [],
		matchFilters: { version: 1 },
		...over,
	};
}

/** A save whose promise we resolve by hand, so we control when reconciliation runs. */
function deferredOnSave() {
	let resolve!: (value: SavePlaylistMatchConfigResult) => void;
	const fn = vi.fn(
		(
			_id: string,
			_intent: string | null,
			_genres: string[],
			_filters: PlaylistMatchFiltersV1,
		): Promise<SavePlaylistMatchConfigResult> =>
			new Promise((res) => {
				resolve = res;
			}),
	);
	return { onSave: fn, resolve: () => resolve };
}

describe("SpotlightPanel — stale save does not reconcile into another playlist", () => {
	it("ignores a save that resolves after the user switched playlists", async () => {
		const { onSave, resolve } = deferredOnSave();

		const playlistA = makePlaylist({ id: "A", intent: "alpha intent" });
		const { rerender } = render(
			<SpotlightPanel
				playlist={playlistA}
				open
				onClose={vi.fn()}
				onSave={onSave}
			/>,
		);

		// Open the editor on playlist A, then save (the RPC stays pending).
		fireEvent.click(screen.getByText("Edit"));
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		expect(onSave).toHaveBeenCalledTimes(1);
		expect(onSave.mock.calls[0][0]).toBe("A");

		// User switches to playlist B before A's save resolves.
		const playlistB = makePlaylist({
			id: "B",
			name: "Playlist B",
			intent: "bravo intent",
		});
		rerender(
			<SpotlightPanel
				playlist={playlistB}
				open
				onClose={vi.fn()}
				onSave={onSave}
			/>,
		);
		expect(screen.getByText("bravo intent")).toBeInTheDocument();

		// A's save resolves with A's server-normalized config.
		await act(async () => {
			resolve()({
				matchIntent: "alpha SERVER",
				genrePills: [],
				matchFilters: { version: 1 },
			});
		});

		// B's panel must be untouched: A's normalized result must not reconcile here.
		expect(screen.getByText("bravo intent")).toBeInTheDocument();
		expect(screen.queryByText("alpha SERVER")).not.toBeInTheDocument();
	});

	it("still reconciles normally when the same playlist stays open", async () => {
		const { onSave, resolve } = deferredOnSave();

		const playlistA = makePlaylist({ id: "A", intent: "alpha intent" });
		render(
			<SpotlightPanel
				playlist={playlistA}
				open
				onClose={vi.fn()}
				onSave={onSave}
			/>,
		);

		fireEvent.click(screen.getByText("Edit"));
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await act(async () => {
			resolve()({
				matchIntent: "alpha SERVER",
				genrePills: [],
				matchFilters: { version: 1 },
			});
		});

		// Same playlist still open → the editor collapses and the server-normalized
		// intent is shown.
		expect(screen.getByText("alpha SERVER")).toBeInTheDocument();
	});
});
