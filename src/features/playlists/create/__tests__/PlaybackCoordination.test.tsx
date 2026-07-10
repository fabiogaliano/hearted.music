/**
 * Screen-level playback coordination test.
 *
 * CreatePlaylistScreen creates a single useSingleActivePlayback instance and
 * passes it to both PreviewList and SuggestionsTray (see CreatePlaylistScreen.tsx)
 * so only one in-row Spotify preview plays at a time across the whole screen.
 * Mounting the full screen would drag in the router, extension gate, and
 * server-fn-backed draft hook; this harness reproduces just the wiring under
 * test — one shared coordinator threaded to both lists exactly as the screen
 * does — without the unrelated dependencies.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useSingleActivePlayback } from "@/features/playback/useSingleActivePlayback";
import type { SongVM } from "@/lib/domains/playlists/types";
import { PreviewList } from "../preview/PreviewList";
import { SuggestionsTray } from "../suggestions/SuggestionsTray";

const PREVIEW_SONG: SongVM = {
	id: "preview-1",
	spotifyId: "spotify-preview-1",
	name: "Preview Song",
	artist: "Preview Artist",
	album: "Preview Album",
	imageUrl: null,
	genres: ["indie"],
	durationMs: 200000,
	matchScore: 0.8,
};

const SUGGESTION_SONG: SongVM = {
	id: "suggestion-1",
	spotifyId: "spotify-suggestion-1",
	name: "Suggestion Song",
	artist: "Suggestion Artist",
	album: "Suggestion Album",
	imageUrl: null,
	genres: ["electronic"],
	durationMs: 210000,
	matchScore: 0.7,
};

/** Mirrors how CreatePlaylistScreen wires a single coordinator to both lists. */
function TwoListHarness() {
	const playback = useSingleActivePlayback();
	return (
		<>
			<PreviewList
				songs={[PREVIEW_SONG]}
				isLoading={false}
				onRemoveSong={vi.fn()}
				onRestoreSong={vi.fn()}
				playback={playback}
			/>
			<SuggestionsTray
				suggestions={[SUGGESTION_SONG]}
				onAddSong={vi.fn()}
				onDismissSong={vi.fn()}
				onRefresh={vi.fn()}
				playback={playback}
			/>
		</>
	);
}

describe("shared playback coordination across preview + suggestions", () => {
	it("activating a suggestions-tray row deactivates the preview list's active row", async () => {
		const user = userEvent.setup();
		render(<TwoListHarness />);

		await user.click(
			screen.getByRole("button", { name: "Play preview for Preview Song" }),
		);
		// Preview row is now the active playback: its close button is visible.
		expect(screen.getByLabelText("Close preview")).toBeInTheDocument();

		await user.click(
			screen.getByRole("button", { name: "Play preview for Suggestion Song" }),
		);

		// Only one close button should exist — the suggestion row's — since
		// activating it flipped the previously-active preview row back off.
		const closeButtons = screen.getAllByLabelText("Close preview");
		expect(closeButtons).toHaveLength(1);
		// The preview row's play affordance is back, proving it deactivated.
		expect(
			screen.getByRole("button", { name: "Play preview for Preview Song" }),
		).toBeInTheDocument();
	});
});
