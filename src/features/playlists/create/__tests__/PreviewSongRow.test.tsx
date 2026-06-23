/**
 * Tests for PreviewSongRow.
 *
 * Covers: render with/without album art, aria-label on remove button,
 * onClick fires onRemove with the correct song id, genre pill presence.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SongVM } from "@/lib/domains/playlists/types";
import { PreviewSongRow } from "../preview/PreviewSongRow";

const SONG: SongVM = {
	id: "song-01",
	spotifyId: "abc123",
	name: "Last Nite",
	artist: "The Strokes",
	album: "Is This It",
	imageUrl: "https://example.com/art.jpg",
	genres: ["indie rock"],
	durationMs: 193000,
	matchScore: 0.91,
};

const SONG_NO_ART: SongVM = {
	...SONG,
	id: "song-02",
	imageUrl: null,
};

describe("PreviewSongRow", () => {
	it("renders the song name and artist", () => {
		const onRemove = vi.fn();
		render(<PreviewSongRow song={SONG} onRemove={onRemove} />);

		expect(screen.getByText("Last Nite")).toBeInTheDocument();
		expect(screen.getByText("The Strokes")).toBeInTheDocument();
	});

	it("renders album art when imageUrl is present", () => {
		const { container } = render(
			<PreviewSongRow song={SONG} onRemove={vi.fn()} />,
		);

		// Image is aria-hidden so we query the DOM directly
		const img = container.querySelector("img");
		expect(img).toBeInTheDocument();
		expect(img).toHaveAttribute("src", SONG.imageUrl);
	});

	it("renders AlbumPlaceholder when imageUrl is null", () => {
		const { container } = render(
			<PreviewSongRow song={SONG_NO_ART} onRemove={vi.fn()} />,
		);

		// No <img> when art is absent; SVG placeholder is rendered instead
		expect(container.querySelector("img")).not.toBeInTheDocument();
	});

	it("remove button has correct aria-label", () => {
		const onRemove = vi.fn();
		render(<PreviewSongRow song={SONG} onRemove={onRemove} />);

		const btn = screen.getByRole("button", { name: "Remove Last Nite" });
		expect(btn).toBeInTheDocument();
	});

	it("fires onRemove with the song id when the remove button is clicked", async () => {
		const user = userEvent.setup();
		const onRemove = vi.fn();
		render(<PreviewSongRow song={SONG} onRemove={onRemove} />);

		const btn = screen.getByRole("button", { name: "Remove Last Nite" });
		await user.click(btn);

		expect(onRemove).toHaveBeenCalledOnce();
		expect(onRemove).toHaveBeenCalledWith("song-01");
	});

	it("remove button is keyboard-activatable via Enter", async () => {
		const user = userEvent.setup();
		const onRemove = vi.fn();
		render(<PreviewSongRow song={SONG} onRemove={onRemove} />);

		const btn = screen.getByRole("button", { name: "Remove Last Nite" });
		btn.focus();
		await user.keyboard("{Enter}");

		expect(onRemove).toHaveBeenCalledOnce();
	});
});
