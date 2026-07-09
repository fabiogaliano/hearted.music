/**
 * Tests for SuggestionsTray.
 *
 * Covers: renders suggestions, empty state, calls onAddSong with correct id.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SongVM } from "@/lib/domains/playlists/types";
import { SuggestionsTray } from "../suggestions/SuggestionsTray";

const makeSong = (id: string, name: string): SongVM => ({
	id,
	spotifyId: `spotify-${id}`,
	name,
	artist: "Test Artist",
	album: "Test Album",
	imageUrl: null,
	genres: ["electronic"],
	durationMs: 220000,
	matchScore: 0.7,
});

const SUGGESTIONS: SongVM[] = [
	makeSong("sg1", "Sunday"),
	makeSong("sg2", "Jaded"),
	makeSong("sg3", "Fair"),
];

describe("SuggestionsTray", () => {
	it("shows empty state when no suggestions", () => {
		render(<SuggestionsTray suggestions={[]} onAddSong={vi.fn()} />);
		expect(screen.getByText(/no suggestions yet/i)).toBeInTheDocument();
	});

	it("renders all suggestion rows", () => {
		render(<SuggestionsTray suggestions={SUGGESTIONS} onAddSong={vi.fn()} />);
		expect(screen.getByText("Sunday")).toBeInTheDocument();
		expect(screen.getByText("Jaded")).toBeInTheDocument();
		expect(screen.getByText("Fair")).toBeInTheDocument();
	});

	it("renders the suggestion count in the header", () => {
		render(<SuggestionsTray suggestions={SUGGESTIONS} onAddSong={vi.fn()} />);
		expect(screen.getByText(/3 suggestions/i)).toBeInTheDocument();
	});

	it("calls onAddSong with the correct id when an add button is clicked", async () => {
		const user = userEvent.setup();
		const onAddSong = vi.fn();
		render(<SuggestionsTray suggestions={SUGGESTIONS} onAddSong={onAddSong} />);

		const btn = screen.getByRole("button", { name: "Add Sunday to playlist" });
		await user.click(btn);

		expect(onAddSong).toHaveBeenCalledOnce();
		expect(onAddSong).toHaveBeenCalledWith("sg1");
	});

	it("caps visible suggestions at 10", () => {
		const manySongs = Array.from({ length: 15 }, (_, i) =>
			makeSong(`s${i}`, `Song ${i}`),
		);
		render(<SuggestionsTray suggestions={manySongs} onAddSong={vi.fn()} />);
		// Only 10 add buttons should be rendered
		const buttons = screen.getAllByRole("button", {
			name: /add .+ to playlist/i,
		});
		expect(buttons).toHaveLength(10);
	});
});
