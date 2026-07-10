/**
 * Tests for PreviewList.
 *
 * Covers: header count/duration formatting, empty and loading states,
 * aria-live region presence, onRemoveSong called with correct id,
 * sonner toast fired with Undo action, Undo invokes onRestoreSong, playback
 * coordinator threading (rows get a play affordance, removing an
 * actively-previewing row deactivates it first so orphaned audio state can't
 * linger past the row's removal).
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import type { SongVM } from "@/lib/domains/playlists/types";
import { PreviewList } from "../preview/PreviewList";

// sonner is mocked in setup.tsx as { toast: { error, success, info } }
// For this component we need the default callable toast(msg, opts). Extend mock:
vi.mock("sonner", () => ({
	toast: vi.fn(),
}));

const makeSong = (id: string, name: string): SongVM => ({
	id,
	spotifyId: `spotify-${id}`,
	name,
	artist: "Test Artist",
	album: "Test Album",
	imageUrl: null,
	genres: ["indie"],
	durationMs: 198000,
	matchScore: 0.8,
});

const SONGS: SongVM[] = [
	makeSong("s1", "Song Alpha"),
	makeSong("s2", "Song Beta"),
	makeSong("s3", "Song Gamma"),
];

describe("PreviewList", () => {
	it("shows loading state when isLoading and no songs", () => {
		render(
			<PreviewList
				songs={[]}
				isLoading={true}
				onRemoveSong={vi.fn()}
				onRestoreSong={vi.fn()}
			/>,
		);
		expect(screen.getByText(/one moment/i)).toBeInTheDocument();
	});

	it("shows empty state when no songs and not loading", () => {
		render(
			<PreviewList
				songs={[]}
				isLoading={false}
				onRemoveSong={vi.fn()}
				onRestoreSong={vi.fn()}
			/>,
		);
		expect(screen.getByText(/no songs matched/i)).toBeInTheDocument();
	});

	it("renders the correct song count in the header", () => {
		render(
			<PreviewList
				songs={SONGS}
				isLoading={false}
				onRemoveSong={vi.fn()}
				onRestoreSong={vi.fn()}
			/>,
		);
		expect(screen.getByText("3 songs")).toBeInTheDocument();
	});

	it("renders duration hint in the header", () => {
		render(
			<PreviewList
				songs={SONGS}
				isLoading={false}
				onRemoveSong={vi.fn()}
				onRestoreSong={vi.fn()}
			/>,
		);
		// 3 × 3.3 = ~10 min
		expect(screen.getByText(/about \d+ minutes/i)).toBeInTheDocument();
	});

	it("uses singular 'song' for a single-item list", () => {
		render(
			<PreviewList
				songs={[SONGS[0]]}
				isLoading={false}
				onRemoveSong={vi.fn()}
				onRestoreSong={vi.fn()}
			/>,
		);
		expect(screen.getByText("1 song")).toBeInTheDocument();
	});

	it("has an aria-live polite region", () => {
		render(
			<PreviewList
				songs={SONGS}
				isLoading={false}
				onRemoveSong={vi.fn()}
				onRestoreSong={vi.fn()}
			/>,
		);
		const live = document.querySelector("[aria-live='polite']");
		expect(live).toBeInTheDocument();
	});

	it("calls onRemoveSong with the song id when Remove is clicked", async () => {
		const user = userEvent.setup();
		const onRemoveSong = vi.fn();
		render(
			<PreviewList
				songs={SONGS}
				isLoading={false}
				onRemoveSong={onRemoveSong}
				onRestoreSong={vi.fn()}
			/>,
		);

		const removeBtn = screen.getByRole("button", { name: "Remove Song Alpha" });
		await user.click(removeBtn);

		expect(onRemoveSong).toHaveBeenCalledOnce();
		expect(onRemoveSong).toHaveBeenCalledWith("s1");
	});

	it("fires a sonner toast on remove", async () => {
		const user = userEvent.setup();
		const onRemoveSong = vi.fn();
		render(
			<PreviewList
				songs={SONGS}
				isLoading={false}
				onRemoveSong={onRemoveSong}
				onRestoreSong={vi.fn()}
			/>,
		);

		const removeBtn = screen.getByRole("button", { name: "Remove Song Alpha" });
		await user.click(removeBtn);

		expect(toast).toHaveBeenCalledWith(
			"Removed Song Alpha",
			expect.objectContaining({
				action: expect.objectContaining({ label: "Undo" }),
			}),
		);
	});

	it("calls onRestoreSong when Undo is invoked via the toast action", async () => {
		const user = userEvent.setup();
		const onRemoveSong = vi.fn();
		const onRestoreSong = vi.fn();

		vi.mocked(toast).mockImplementation((_msg, opts) => {
			// Narrow action: sonner types it as Action | ReactNode, but we only pass
			// an Action object here, so we verify before invoking onClick.
			const action = opts?.action;
			if (action && typeof action === "object" && "onClick" in action) {
				action.onClick(
					new MouseEvent(
						"click",
					) as unknown as React.MouseEvent<HTMLButtonElement>,
				);
			}
			return "toast-id";
		});

		render(
			<PreviewList
				songs={SONGS}
				isLoading={false}
				onRemoveSong={onRemoveSong}
				onRestoreSong={onRestoreSong}
			/>,
		);

		const removeBtn = screen.getByRole("button", { name: "Remove Song Alpha" });
		await user.click(removeBtn);

		expect(onRestoreSong).toHaveBeenCalledWith("s1");
	});

	it("renders a play affordance on rows when a playback coordinator is supplied", () => {
		const playback = {
			activePlaybackId: null,
			activatePlayback: vi.fn(),
			deactivatePlayback: vi.fn(),
		};
		render(
			<PreviewList
				songs={SONGS}
				isLoading={false}
				onRemoveSong={vi.fn()}
				onRestoreSong={vi.fn()}
				playback={playback}
			/>,
		);
		expect(
			screen.getByRole("button", { name: "Play preview for Song Alpha" }),
		).toBeInTheDocument();
	});

	it("deactivates playback before removing a row that's currently previewing", async () => {
		const user = userEvent.setup();
		const onRemoveSong = vi.fn();
		const playback = {
			activePlaybackId: "s1",
			activatePlayback: vi.fn(),
			deactivatePlayback: vi.fn(),
		};
		render(
			<PreviewList
				songs={SONGS}
				isLoading={false}
				onRemoveSong={onRemoveSong}
				onRestoreSong={vi.fn()}
				playback={playback}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Remove Song Alpha" }));

		expect(playback.deactivatePlayback).toHaveBeenCalledOnce();
		expect(onRemoveSong).toHaveBeenCalledWith("s1");
	});

	it("does not deactivate playback when removing a row that isn't the active one", async () => {
		const user = userEvent.setup();
		const playback = {
			activePlaybackId: "s2",
			activatePlayback: vi.fn(),
			deactivatePlayback: vi.fn(),
		};
		render(
			<PreviewList
				songs={SONGS}
				isLoading={false}
				onRemoveSong={vi.fn()}
				onRestoreSong={vi.fn()}
				playback={playback}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Remove Song Alpha" }));

		expect(playback.deactivatePlayback).not.toHaveBeenCalled();
	});
});
