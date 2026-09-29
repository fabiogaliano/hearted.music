import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test/utils/render";
import { MatchingEmptyState } from "../components/MatchingEmptyState";

// Link from TanStack Router requires a router context; replace with a simple
// anchor so these tests run without a full router setup.
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
}));

describe("MatchingEmptyState", () => {
	describe("filtered reason — song mode (H9)", () => {
		it("describes hidden count with 'song' noun for a single item", () => {
			render(
				<MatchingEmptyState reason="filtered" hiddenCount={1} mode="song" />,
			);
			expect(screen.getByText(/1 song has matches/)).toBeDefined();
		});

		it("describes hidden count with 'songs' plural noun", () => {
			render(
				<MatchingEmptyState reason="filtered" hiddenCount={3} mode="song" />,
			);
			expect(screen.getByText(/3 songs have matches/)).toBeDefined();
		});
	});

	describe("filtered reason — playlist mode (H9)", () => {
		it("describes hidden count with 'playlist' noun for a single item", () => {
			render(
				<MatchingEmptyState
					reason="filtered"
					hiddenCount={1}
					mode="playlist"
				/>,
			);
			expect(screen.getByText(/1 playlist has matches/)).toBeDefined();
		});

		it("describes hidden count with 'playlists' plural noun", () => {
			render(
				<MatchingEmptyState
					reason="filtered"
					hiddenCount={4}
					mode="playlist"
				/>,
			);
			expect(screen.getByText(/4 playlists have matches/)).toBeDefined();
		});

		it("defaults to playlist mode when mode prop is omitted", () => {
			render(<MatchingEmptyState reason="filtered" hiddenCount={2} />);
			expect(screen.getByText(/2 playlists have matches/)).toBeDefined();
		});
	});

	describe("orientation toggle (A2)", () => {
		it("omits the toggle when onModeChange is not provided", () => {
			render(<MatchingEmptyState reason="caught-up" />);
			expect(screen.queryByRole("group", { name: "View mode" })).toBeNull();
		});

		it("renders the toggle so a caught-up user can switch orientation", async () => {
			const onModeChange = vi.fn();
			const { user } = render(
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
