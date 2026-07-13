/**
 * Tests for PreviewSongRow.
 *
 * Covers: render with/without album art, aria-label on remove button,
 * onClick fires onRemove with the correct song id, the pin toggle (rendered
 * only with onTogglePin; fill/label reflect isPinned; click fires the toggle),
 * Spotify in-row playback affordance (present only with both a `playback`
 * coordinator and a spotifyId; activating calls the coordinator).
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

	it("renders no pin toggle when onTogglePin is omitted", () => {
		render(<PreviewSongRow song={SONG} onRemove={vi.fn()} />);
		expect(
			screen.queryByRole("button", { name: /^(Pin|Unpin) / }),
		).not.toBeInTheDocument();
	});

	it("shows a 'Pin' toggle when unpinned and fires onTogglePin with the song id", async () => {
		const user = userEvent.setup();
		const onTogglePin = vi.fn();
		render(
			<PreviewSongRow
				song={SONG}
				onRemove={vi.fn()}
				onTogglePin={onTogglePin}
			/>,
		);

		const btn = screen.getByRole("button", { name: "Pin Last Nite" });
		expect(btn).toHaveAttribute("aria-pressed", "false");
		await user.click(btn);
		expect(onTogglePin).toHaveBeenCalledWith("song-01");
	});

	it("shows an 'Unpin' toggle with aria-pressed when pinned", () => {
		render(
			<PreviewSongRow
				song={SONG}
				onRemove={vi.fn()}
				isPinned
				onTogglePin={vi.fn()}
			/>,
		);
		expect(
			screen.getByRole("button", { name: "Unpin Last Nite" }),
		).toHaveAttribute("aria-pressed", "true");
	});

	it("renders no play affordance without a playback coordinator", () => {
		render(<PreviewSongRow song={SONG} onRemove={vi.fn()} />);
		expect(
			screen.queryByRole("button", { name: "Play preview for Last Nite" }),
		).not.toBeInTheDocument();
	});

	it("renders no play affordance when spotifyId is missing, even with a coordinator", () => {
		const playback = {
			activePlaybackId: null,
			activatePlayback: vi.fn(),
			deactivatePlayback: vi.fn(),
		};
		render(
			<PreviewSongRow
				song={{ ...SONG, spotifyId: "" }}
				onRemove={vi.fn()}
				playback={playback}
			/>,
		);
		expect(
			screen.queryByRole("button", { name: "Play preview for Last Nite" }),
		).not.toBeInTheDocument();
	});

	it("renders a play affordance when spotifyId and a coordinator are both present", () => {
		const playback = {
			activePlaybackId: null,
			activatePlayback: vi.fn(),
			deactivatePlayback: vi.fn(),
		};
		render(
			<PreviewSongRow song={SONG} onRemove={vi.fn()} playback={playback} />,
		);
		expect(
			screen.getByRole("button", { name: "Play preview for Last Nite" }),
		).toBeInTheDocument();
	});

	it("activating the cover calls the coordinator's activatePlayback with this row's id", async () => {
		const user = userEvent.setup();
		const playback = {
			activePlaybackId: null,
			activatePlayback: vi.fn(),
			deactivatePlayback: vi.fn(),
		};
		render(
			<PreviewSongRow song={SONG} onRemove={vi.fn()} playback={playback} />,
		);

		await user.click(
			screen.getByRole("button", { name: "Play preview for Last Nite" }),
		);

		expect(playback.activatePlayback).toHaveBeenCalledWith(SONG.id);
	});
});
