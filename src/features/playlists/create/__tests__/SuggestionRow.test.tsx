/**
 * Tests for SuggestionRow.
 *
 * Covers: render song name/artist, aria-label on add button,
 * onClick fires onAdd with the correct song id, keyboard activation.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SongVM } from "@/lib/domains/playlists/types";
import { SuggestionRow } from "../suggestions/SuggestionRow";

const SONG: SongVM = {
	id: "song-05",
	spotifyId: "xyz789",
	name: "Hilarity Duff",
	artist: "KAYTRANADA",
	album: "Hilarity Duff EP",
	imageUrl: "https://example.com/kaytranada.jpg",
	genres: ["house", "electronic"],
	durationMs: 237000,
	matchScore: 0.76,
};

describe("SuggestionRow", () => {
	it("renders the song name and artist", () => {
		render(<SuggestionRow song={SONG} onAdd={vi.fn()} />);
		expect(screen.getByText("Hilarity Duff")).toBeInTheDocument();
		expect(screen.getByText("KAYTRANADA")).toBeInTheDocument();
	});

	it("add button has correct aria-label", () => {
		render(<SuggestionRow song={SONG} onAdd={vi.fn()} />);
		const btn = screen.getByRole("button", {
			name: "Add Hilarity Duff to playlist",
		});
		expect(btn).toBeInTheDocument();
	});

	it("fires onAdd with the song id when the add button is clicked", async () => {
		const user = userEvent.setup();
		const onAdd = vi.fn();
		render(<SuggestionRow song={SONG} onAdd={onAdd} />);

		const btn = screen.getByRole("button", {
			name: "Add Hilarity Duff to playlist",
		});
		await user.click(btn);

		expect(onAdd).toHaveBeenCalledOnce();
		expect(onAdd).toHaveBeenCalledWith("song-05");
	});

	it("add button is keyboard-activatable via Enter", async () => {
		const user = userEvent.setup();
		const onAdd = vi.fn();
		render(<SuggestionRow song={SONG} onAdd={onAdd} />);

		const btn = screen.getByRole("button", {
			name: "Add Hilarity Duff to playlist",
		});
		btn.focus();
		await user.keyboard("{Enter}");

		expect(onAdd).toHaveBeenCalledOnce();
	});

	it("renders album art when imageUrl is present", () => {
		const { container } = render(<SuggestionRow song={SONG} onAdd={vi.fn()} />);
		// Image is aria-hidden so we query the DOM directly
		const img = container.querySelector("img");
		expect(img).toHaveAttribute("src", SONG.imageUrl);
	});

	it("renders AlbumPlaceholder when imageUrl is null", () => {
		const { container } = render(
			<SuggestionRow song={{ ...SONG, imageUrl: null }} onAdd={vi.fn()} />,
		);
		expect(container.querySelector("img")).not.toBeInTheDocument();
	});
});
