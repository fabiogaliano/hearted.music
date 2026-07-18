/**
 * Tests for SuggestionRow.
 *
 * Covers: render song name/artist, aria-label on add button,
 * onClick fires onAdd with the correct song id, keyboard activation,
 * dismiss button parity (aria-label, onDismiss firing), Spotify in-row
 * playback affordance (present only with both a `playback` coordinator and a
 * spotifyId; activating calls the coordinator).
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
		render(<SuggestionRow song={SONG} onAdd={vi.fn()} onDismiss={vi.fn()} />);
		expect(screen.getByText("Hilarity Duff")).toBeInTheDocument();
		expect(screen.getByText("KAYTRANADA")).toBeInTheDocument();
	});

	it("add button has correct aria-label", () => {
		render(<SuggestionRow song={SONG} onAdd={vi.fn()} onDismiss={vi.fn()} />);
		const btn = screen.getByRole("button", {
			name: "Add Hilarity Duff to playlist",
		});
		expect(btn).toBeInTheDocument();
	});

	it("fires onAdd with the song id when the add button is clicked", async () => {
		const user = userEvent.setup();
		const onAdd = vi.fn();
		render(<SuggestionRow song={SONG} onAdd={onAdd} onDismiss={vi.fn()} />);

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
		render(<SuggestionRow song={SONG} onAdd={onAdd} onDismiss={vi.fn()} />);

		const btn = screen.getByRole("button", {
			name: "Add Hilarity Duff to playlist",
		});
		btn.focus();
		await user.keyboard("{Enter}");

		expect(onAdd).toHaveBeenCalledOnce();
	});

	it("renders album art when imageUrl is present", () => {
		const { container } = render(
			<SuggestionRow song={SONG} onAdd={vi.fn()} onDismiss={vi.fn()} />,
		);
		// Image is aria-hidden so we query the DOM directly
		const img = container.querySelector("img");
		expect(img).toHaveAttribute("src", SONG.imageUrl);
	});

	it("renders AlbumPlaceholder when imageUrl is null", () => {
		const { container } = render(
			<SuggestionRow
				song={{ ...SONG, imageUrl: null }}
				onAdd={vi.fn()}
				onDismiss={vi.fn()}
			/>,
		);
		expect(container.querySelector("img")).not.toBeInTheDocument();
	});

	it("dismiss button has correct aria-label", () => {
		render(<SuggestionRow song={SONG} onAdd={vi.fn()} onDismiss={vi.fn()} />);
		const btn = screen.getByRole("button", {
			name: "Dismiss Hilarity Duff",
		});
		expect(btn).toBeInTheDocument();
	});

	it("fires onDismiss with the song id when the dismiss button is clicked", async () => {
		const user = userEvent.setup();
		const onDismiss = vi.fn();
		render(<SuggestionRow song={SONG} onAdd={vi.fn()} onDismiss={onDismiss} />);

		const btn = screen.getByRole("button", { name: "Dismiss Hilarity Duff" });
		await user.click(btn);

		expect(onDismiss).toHaveBeenCalledOnce();
		expect(onDismiss).toHaveBeenCalledWith("song-05");
	});

	it("dismiss button is keyboard-activatable via Enter", async () => {
		const user = userEvent.setup();
		const onDismiss = vi.fn();
		render(<SuggestionRow song={SONG} onAdd={vi.fn()} onDismiss={onDismiss} />);

		const btn = screen.getByRole("button", { name: "Dismiss Hilarity Duff" });
		btn.focus();
		await user.keyboard("{Enter}");

		expect(onDismiss).toHaveBeenCalledOnce();
	});

	it("dismiss does not fire onAdd, and add does not fire onDismiss", async () => {
		const user = userEvent.setup();
		const onAdd = vi.fn();
		const onDismiss = vi.fn();
		render(<SuggestionRow song={SONG} onAdd={onAdd} onDismiss={onDismiss} />);

		await user.click(
			screen.getByRole("button", { name: "Dismiss Hilarity Duff" }),
		);
		expect(onAdd).not.toHaveBeenCalled();

		await user.click(
			screen.getByRole("button", { name: "Add Hilarity Duff to playlist" }),
		);
		expect(onDismiss).toHaveBeenCalledOnce();
		expect(onAdd).toHaveBeenCalledOnce();
	});

	it("renders no play affordance without a playback coordinator", () => {
		render(<SuggestionRow song={SONG} onAdd={vi.fn()} onDismiss={vi.fn()} />);
		expect(
			screen.queryByRole("button", {
				name: "Play preview for Hilarity Duff",
			}),
		).not.toBeInTheDocument();
	});

	it("renders no play affordance when spotifyId is missing, even with a coordinator", () => {
		const playback = {
			activePlaybackId: null,
			activatePlayback: vi.fn(),
			deactivatePlayback: vi.fn(),
		};
		render(
			<SuggestionRow
				song={{ ...SONG, spotifyId: "" }}
				onAdd={vi.fn()}
				onDismiss={vi.fn()}
				playback={playback}
			/>,
		);
		expect(
			screen.queryByRole("button", {
				name: "Play preview for Hilarity Duff",
			}),
		).not.toBeInTheDocument();
	});

	it("renders a play affordance when spotifyId and a coordinator are both present", () => {
		const playback = {
			activePlaybackId: null,
			activatePlayback: vi.fn(),
			deactivatePlayback: vi.fn(),
		};
		render(
			<SuggestionRow
				song={SONG}
				onAdd={vi.fn()}
				onDismiss={vi.fn()}
				playback={playback}
			/>,
		);
		expect(
			screen.getByRole("button", { name: "Play preview for Hilarity Duff" }),
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
			<SuggestionRow
				song={SONG}
				onAdd={vi.fn()}
				onDismiss={vi.fn()}
				playback={playback}
			/>,
		);

		await user.click(
			screen.getByRole("button", { name: "Play preview for Hilarity Duff" }),
		);

		expect(playback.activatePlayback).toHaveBeenCalledWith(SONG.id);
	});
});
