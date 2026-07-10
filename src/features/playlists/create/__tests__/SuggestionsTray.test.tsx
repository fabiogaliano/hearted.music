/**
 * Tests for SuggestionsTray.
 *
 * Covers: renders suggestions, empty state, calls onAddSong with correct id,
 * calls onDismissSong with correct id, refresh button triggers onRefresh,
 * playback coordinator threading (rows get a play affordance, add/dismiss on
 * an actively-previewing row deactivates it first so orphaned audio state
 * can't linger past the row's removal).
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
		render(
			<SuggestionsTray
				suggestions={[]}
				onAddSong={vi.fn()}
				onDismissSong={vi.fn()}
				onRefresh={vi.fn()}
			/>,
		);
		expect(screen.getByText(/no suggestions yet/i)).toBeInTheDocument();
	});

	it("renders all suggestion rows", () => {
		render(
			<SuggestionsTray
				suggestions={SUGGESTIONS}
				onAddSong={vi.fn()}
				onDismissSong={vi.fn()}
				onRefresh={vi.fn()}
			/>,
		);
		expect(screen.getByText("Sunday")).toBeInTheDocument();
		expect(screen.getByText("Jaded")).toBeInTheDocument();
		expect(screen.getByText("Fair")).toBeInTheDocument();
	});

	it("renders the suggestion count in the header", () => {
		render(
			<SuggestionsTray
				suggestions={SUGGESTIONS}
				onAddSong={vi.fn()}
				onDismissSong={vi.fn()}
				onRefresh={vi.fn()}
			/>,
		);
		expect(screen.getByText(/3 suggestions/i)).toBeInTheDocument();
	});

	it("calls onAddSong with the correct id when an add button is clicked", async () => {
		const user = userEvent.setup();
		const onAddSong = vi.fn();
		render(
			<SuggestionsTray
				suggestions={SUGGESTIONS}
				onAddSong={onAddSong}
				onDismissSong={vi.fn()}
				onRefresh={vi.fn()}
			/>,
		);

		const btn = screen.getByRole("button", { name: "Add Sunday to playlist" });
		await user.click(btn);

		expect(onAddSong).toHaveBeenCalledOnce();
		expect(onAddSong).toHaveBeenCalledWith("sg1");
	});

	it("calls onDismissSong with the correct id when a dismiss button is clicked", async () => {
		const user = userEvent.setup();
		const onDismissSong = vi.fn();
		render(
			<SuggestionsTray
				suggestions={SUGGESTIONS}
				onAddSong={vi.fn()}
				onDismissSong={onDismissSong}
				onRefresh={vi.fn()}
			/>,
		);

		const btn = screen.getByRole("button", { name: "Dismiss Sunday" });
		await user.click(btn);

		expect(onDismissSong).toHaveBeenCalledOnce();
		expect(onDismissSong).toHaveBeenCalledWith("sg1");
	});

	it("caps visible suggestions at 10", () => {
		const manySongs = Array.from({ length: 15 }, (_, i) =>
			makeSong(`s${i}`, `Song ${i}`),
		);
		render(
			<SuggestionsTray
				suggestions={manySongs}
				onAddSong={vi.fn()}
				onDismissSong={vi.fn()}
				onRefresh={vi.fn()}
			/>,
		);
		// Only 10 add buttons should be rendered
		const buttons = screen.getAllByRole("button", {
			name: /add .+ to playlist/i,
		});
		expect(buttons).toHaveLength(10);
	});

	it("renders a refresh affordance in the header", () => {
		render(
			<SuggestionsTray
				suggestions={SUGGESTIONS}
				onAddSong={vi.fn()}
				onDismissSong={vi.fn()}
				onRefresh={vi.fn()}
			/>,
		);
		expect(
			screen.getByRole("button", { name: /refresh/i }),
		).toBeInTheDocument();
	});

	it("calls onRefresh when the refresh button is clicked", async () => {
		const user = userEvent.setup();
		const onRefresh = vi.fn();
		render(
			<SuggestionsTray
				suggestions={SUGGESTIONS}
				onAddSong={vi.fn()}
				onDismissSong={vi.fn()}
				onRefresh={onRefresh}
			/>,
		);

		await user.click(screen.getByRole("button", { name: /refresh/i }));

		expect(onRefresh).toHaveBeenCalledOnce();
	});

	it("renders a play affordance on rows when a playback coordinator is supplied", () => {
		const playback = {
			activePlaybackId: null,
			activatePlayback: vi.fn(),
			deactivatePlayback: vi.fn(),
		};
		render(
			<SuggestionsTray
				suggestions={SUGGESTIONS}
				onAddSong={vi.fn()}
				onDismissSong={vi.fn()}
				onRefresh={vi.fn()}
				playback={playback}
			/>,
		);
		expect(
			screen.getByRole("button", { name: "Play preview for Sunday" }),
		).toBeInTheDocument();
	});

	it("deactivates playback before adding a row that's currently previewing", async () => {
		const user = userEvent.setup();
		const onAddSong = vi.fn();
		const playback = {
			activePlaybackId: "sg1",
			activatePlayback: vi.fn(),
			deactivatePlayback: vi.fn(),
		};
		render(
			<SuggestionsTray
				suggestions={SUGGESTIONS}
				onAddSong={onAddSong}
				onDismissSong={vi.fn()}
				onRefresh={vi.fn()}
				playback={playback}
			/>,
		);

		await user.click(
			screen.getByRole("button", { name: "Add Sunday to playlist" }),
		);

		expect(playback.deactivatePlayback).toHaveBeenCalledOnce();
		expect(onAddSong).toHaveBeenCalledWith("sg1");
	});

	it("deactivates playback before dismissing a row that's currently previewing", async () => {
		const user = userEvent.setup();
		const onDismissSong = vi.fn();
		const playback = {
			activePlaybackId: "sg1",
			activatePlayback: vi.fn(),
			deactivatePlayback: vi.fn(),
		};
		render(
			<SuggestionsTray
				suggestions={SUGGESTIONS}
				onAddSong={vi.fn()}
				onDismissSong={onDismissSong}
				onRefresh={vi.fn()}
				playback={playback}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Dismiss Sunday" }));

		expect(playback.deactivatePlayback).toHaveBeenCalledOnce();
		expect(onDismissSong).toHaveBeenCalledWith("sg1");
	});

	it("does not deactivate playback when acting on a row that isn't the active one", async () => {
		const user = userEvent.setup();
		const playback = {
			activePlaybackId: "sg2",
			activatePlayback: vi.fn(),
			deactivatePlayback: vi.fn(),
		};
		render(
			<SuggestionsTray
				suggestions={SUGGESTIONS}
				onAddSong={vi.fn()}
				onDismissSong={vi.fn()}
				onRefresh={vi.fn()}
				playback={playback}
			/>,
		);

		await user.click(
			screen.getByRole("button", { name: "Add Sunday to playlist" }),
		);

		expect(playback.deactivatePlayback).not.toHaveBeenCalled();
	});
});
