import { describe, expect, it, vi } from "vitest";
import { renderWithRouter, screen } from "@/test/utils/render";
import { MatchingEmptyState } from "../components/MatchingEmptyState";

describe("MatchingEmptyState", () => {
	describe("filtered reason — song mode (H9)", () => {
		it("describes hidden count with 'song' noun for a single item", async () => {
			await renderWithRouter(
				<MatchingEmptyState reason="filtered" hiddenCount={1} mode="song" />,
			);
			expect(screen.getByText(/1 song has matches/)).toBeDefined();
		});

		it("describes hidden count with 'songs' plural noun", async () => {
			await renderWithRouter(
				<MatchingEmptyState reason="filtered" hiddenCount={3} mode="song" />,
			);
			expect(screen.getByText(/3 songs have matches/)).toBeDefined();
		});
	});

	describe("filtered reason — playlist mode (H9)", () => {
		it("describes hidden count with 'playlist' noun for a single item", async () => {
			await renderWithRouter(
				<MatchingEmptyState
					reason="filtered"
					hiddenCount={1}
					mode="playlist"
				/>,
			);
			expect(screen.getByText(/1 playlist has matches/)).toBeDefined();
		});

		it("describes hidden count with 'playlists' plural noun", async () => {
			await renderWithRouter(
				<MatchingEmptyState
					reason="filtered"
					hiddenCount={4}
					mode="playlist"
				/>,
			);
			expect(screen.getByText(/4 playlists have matches/)).toBeDefined();
		});

		it("defaults to playlist mode when mode prop is omitted", async () => {
			await renderWithRouter(
				<MatchingEmptyState reason="filtered" hiddenCount={2} />,
			);
			expect(screen.getByText(/2 playlists have matches/)).toBeDefined();
		});

		it("links to the matching strictness section of settings, tagged as coming from /match", async () => {
			await renderWithRouter(
				<MatchingEmptyState reason="filtered" hiddenCount={2} />,
			);
			expect(screen.getByRole("link", { name: /strictness/i })).toHaveAttribute(
				"href",
				"/settings?from=match#settings-section-matching",
			);
		});
	});

	describe("orientation toggle (A2)", () => {
		it("omits the toggle when onModeChange is not provided", async () => {
			await renderWithRouter(<MatchingEmptyState reason="caught-up" />);
			expect(screen.queryByRole("group", { name: "View mode" })).toBeNull();
		});

		it("renders the toggle so a caught-up user can switch orientation", async () => {
			const onModeChange = vi.fn();
			const { user } = await renderWithRouter(
				<MatchingEmptyState
					reason="caught-up"
					mode="song"
					onModeChange={onModeChange}
				/>,
			);
			expect(screen.getByRole("group", { name: "View mode" })).toBeDefined();
			await user.click(screen.getByRole("button", { name: "Playlist" }));
			expect(onModeChange).toHaveBeenCalledExactlyOnceWith("playlist");
		});
	});
});
