import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test/utils/render";
import { MatchingEmptyState } from "../components/MatchingEmptyState";

// Link from TanStack Router requires a router context; replace with a simple
// anchor so these pure-copy tests run without a full router setup.
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

		it("defaults to song mode when mode prop is omitted", () => {
			render(<MatchingEmptyState reason="filtered" hiddenCount={2} />);
			expect(screen.getByText(/2 songs have matches/)).toBeDefined();
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
	});

	describe("static reason copy", () => {
		it("renders no-context state without crashing", () => {
			render(<MatchingEmptyState reason="no-context" />);
			expect(screen.getByText(/Set a matching intent/)).toBeDefined();
		});

		it("renders caught-up state without crashing", () => {
			render(<MatchingEmptyState reason="caught-up" />);
			expect(screen.getByText(/You're caught up/)).toBeDefined();
		});

		it("renders none-yet state without crashing", () => {
			render(<MatchingEmptyState reason="none-yet" />);
			expect(screen.getByText(/No matches/)).toBeDefined();
		});

		it("renders all-decided state (legacy alias) without crashing", () => {
			render(<MatchingEmptyState reason="all-decided" />);
			expect(screen.getByText(/You're caught up/)).toBeDefined();
		});

		it("renders no-matches state without crashing", () => {
			render(<MatchingEmptyState reason="no-matches" />);
			expect(screen.getByText(/No matches right now/)).toBeDefined();
		});
	});

	describe("filtered reason — overline and headline", () => {
		it("renders the overline and link for filtered state", () => {
			render(
				<MatchingEmptyState reason="filtered" hiddenCount={2} mode="song" />,
			);
			expect(screen.getByText("quiet in here")).toBeDefined();
			expect(screen.getByText("Adjust strictness")).toBeDefined();
		});
	});

	describe("mode prop does not affect non-filtered reasons", () => {
		it("renders caught-up correctly in playlist mode", () => {
			render(<MatchingEmptyState reason="caught-up" mode="playlist" />);
			expect(screen.getByText(/You're caught up/)).toBeDefined();
		});

		it("renders none-yet correctly in playlist mode", () => {
			render(<MatchingEmptyState reason="none-yet" mode="playlist" />);
			expect(screen.getByText(/No matches/)).toBeDefined();
		});
	});

	describe("building states — shown while jobs are active", () => {
		it("renders 'building' state with finding-matches copy", () => {
			render(<MatchingEmptyState reason="building" />);
			expect(screen.getByText("finding matches")).toBeDefined();
			expect(screen.getByText(/Finding your/)).toBeDefined();
		});

		it("renders 'building-more' state with more-coming copy", () => {
			render(<MatchingEmptyState reason="building-more" />);
			expect(screen.getByText("more coming")).toBeDefined();
			expect(screen.getByText(/More matches are/)).toBeDefined();
		});

		it("does not show terminal empty-state copy while building", () => {
			render(<MatchingEmptyState reason="building" />);
			// These terminal strings must not appear in the building state so the
			// user never sees a false "nothing found" message while jobs run.
			expect(screen.queryByText(/No matches just yet/)).toBeNull();
			expect(screen.queryByText(/You're caught up/)).toBeNull();
		});

		it("does not show terminal empty-state copy in building-more state", () => {
			render(<MatchingEmptyState reason="building-more" />);
			expect(screen.queryByText(/No matches just yet/)).toBeNull();
			expect(screen.queryByText(/You're caught up/)).toBeNull();
		});
	});
});
