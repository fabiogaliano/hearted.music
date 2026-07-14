import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Playlist } from "@/features/matching/types";
import { render, screen } from "@/test/utils/render";
import { MatchesSection } from "../components/MatchesSection";

function makeQueryClient() {
	return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithQuery(ui: ReactElement) {
	return render(
		<QueryClientProvider client={makeQueryClient()}>{ui}</QueryClientProvider>,
	);
}

function makePlaylist(overrides?: Partial<Playlist>): Playlist {
	return {
		id: "pl-1",
		spotifyId: "sp-pl-1",
		name: "Chill Vibes",
		reason: "Matches the song's mellow tone",
		matchScore: 0.82,
		imageUrl: null,
		songCount: 12,
		...overrides,
	};
}

const PLAYLISTS: Playlist[] = [
	makePlaylist({ id: "pl-1", name: "Chill Vibes" }),
	makePlaylist({ id: "pl-2", name: "Late Night Drive", matchScore: 0.75 }),
];

const DEFAULT_PROPS = {
	songKey: "song-1",
	playlists: PLAYLISTS,
	addedTo: [] as string[],
	onAdd: vi.fn(),
	onDismiss: vi.fn(),
	onNext: vi.fn(),
};

describe("MatchesSection", () => {
	it("renders the section heading", () => {
		renderWithQuery(<MatchesSection {...DEFAULT_PROPS} />);
		expect(screen.getByText("Best Matches")).toBeDefined();
	});

	it("renders playlist name for each match", () => {
		renderWithQuery(<MatchesSection {...DEFAULT_PROPS} />);
		expect(screen.getByText("Chill Vibes")).toBeDefined();
		expect(screen.getByText("Late Night Drive")).toBeDefined();
	});

	it("renders match percent from matchScore", () => {
		renderWithQuery(<MatchesSection {...DEFAULT_PROPS} />);
		expect(screen.getByText("82%")).toBeDefined();
		expect(screen.getByText("75%")).toBeDefined();
	});

	it("renders Add buttons for unadded playlists", () => {
		renderWithQuery(<MatchesSection {...DEFAULT_PROPS} />);
		const addButtons = screen.getAllByRole("button", { name: "Add" });
		expect(addButtons).toHaveLength(2);
	});

	it("calls onAdd with the playlist id when Add is clicked", async () => {
		const onAdd = vi.fn();
		const { user } = renderWithQuery(
			<MatchesSection {...DEFAULT_PROPS} onAdd={onAdd} />,
		);
		const addButtons = screen.getAllByRole("button", { name: "Add" });
		await user.click(addButtons[0]);
		expect(onAdd).toHaveBeenCalledWith("pl-1");
	});

	it("shows 'Added' text and hides Add button for playlists in addedTo", () => {
		renderWithQuery(<MatchesSection {...DEFAULT_PROPS} addedTo={["pl-1"]} />);
		expect(screen.getByText("Added")).toBeDefined();
		const addButtons = screen.getAllByRole("button", { name: "Add" });
		expect(addButtons).toHaveLength(1);
	});

	it("shows the demo badge when isDemo is true", () => {
		renderWithQuery(<MatchesSection {...DEFAULT_PROPS} isDemo />);
		expect(screen.getByText("Demo")).toBeDefined();
	});

	it("renders the empty state when there are no playlists", () => {
		renderWithQuery(<MatchesSection {...DEFAULT_PROPS} playlists={[]} />);
		expect(screen.getByText("All suggestions reviewed.")).toBeDefined();
	});

	it("renders Reject button that calls onDismiss", async () => {
		const onDismiss = vi.fn();
		const { user } = renderWithQuery(
			<MatchesSection {...DEFAULT_PROPS} onDismiss={onDismiss} />,
		);
		await user.click(screen.getByRole("button", { name: /Reject Matches/i }));
		expect(onDismiss).toHaveBeenCalledOnce();
	});

	it("uses singular 'Reject Match' copy when a single playlist is visible", () => {
		renderWithQuery(
			<MatchesSection {...DEFAULT_PROPS} playlists={[makePlaylist()]} />,
		);
		expect(
			screen.getByRole("button", { name: /Reject Match$/i }),
		).toBeDefined();
	});

	it("renders Skip Song button that calls onNext", async () => {
		const onNext = vi.fn();
		const { user } = renderWithQuery(
			<MatchesSection {...DEFAULT_PROPS} onNext={onNext} />,
		);
		await user.click(screen.getByRole("button", { name: /Skip Song/i }));
		expect(onNext).toHaveBeenCalledOnce();
	});

	it("shows 'Finish matching' on the last item instead of 'Skip Song'", () => {
		renderWithQuery(<MatchesSection {...DEFAULT_PROPS} isLastItem />);
		expect(screen.getByText("Finish matching")).toBeDefined();
		expect(screen.queryByText("Skip Song")).toBeNull();
	});

	it("renders Previous button when onPrevious is provided", async () => {
		const onPrevious = vi.fn();
		const { user } = renderWithQuery(
			<MatchesSection {...DEFAULT_PROPS} onPrevious={onPrevious} />,
		);
		const prevBtn = screen.getByRole("button", { name: /Previous/i });
		await user.click(prevBtn);
		expect(onPrevious).toHaveBeenCalledOnce();
	});

	it("does not render Previous button when onPrevious is absent", () => {
		renderWithQuery(<MatchesSection {...DEFAULT_PROPS} />);
		expect(screen.queryByRole("button", { name: /Previous/i })).toBeNull();
	});

	it("disables Add and navigation controls when navigationDisabled is true", () => {
		renderWithQuery(
			<MatchesSection
				{...DEFAULT_PROPS}
				navigationDisabled
				onPrevious={vi.fn()}
			/>,
		);
		const addButtons = screen.getAllByRole("button", { name: "Add" });
		for (const btn of addButtons) {
			expect((btn as HTMLButtonElement).disabled).toBe(true);
		}
		const dismissBtn = screen.getByRole("button", { name: /Reject Matches/i });
		const prevBtn = screen.getByRole("button", { name: /Previous/i });
		const nextBtn = screen.getByRole("button", { name: /Skip Song/i });
		expect((dismissBtn as HTMLButtonElement).disabled).toBe(true);
		expect((prevBtn as HTMLButtonElement).disabled).toBe(true);
		expect((nextBtn as HTMLButtonElement).disabled).toBe(true);
	});

	it("renders without crashing with suppressTransition", () => {
		renderWithQuery(<MatchesSection {...DEFAULT_PROPS} suppressTransition />);
		expect(screen.getByText("Best Matches")).toBeDefined();
	});

	it("renders the 'real matches ready' banner when realAvailable is true", () => {
		renderWithQuery(<MatchesSection {...DEFAULT_PROPS} realAvailable />);
		expect(screen.getByText("Real matches are ready")).toBeDefined();
	});

	it("calls onRefresh when the 'real matches ready' banner is clicked", async () => {
		const onRefresh = vi.fn();
		const { user } = renderWithQuery(
			<MatchesSection {...DEFAULT_PROPS} realAvailable onRefresh={onRefresh} />,
		);
		await user.click(screen.getByText("Real matches are ready"));
		expect(onRefresh).toHaveBeenCalledOnce();
	});

	it("does not render the 'real matches ready' banner by default", () => {
		renderWithQuery(<MatchesSection {...DEFAULT_PROPS} />);
		expect(screen.queryByText("Real matches are ready")).toBeNull();
	});

	it("renders a reconnect link instead of Add when reconnectNeeded is true", () => {
		renderWithQuery(<MatchesSection {...DEFAULT_PROPS} reconnectNeeded />);
		expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
	});

	it("opens the playlist track preview via the cover disclosure handle", async () => {
		const { container, user } = renderWithQuery(
			<MatchesSection {...DEFAULT_PROPS} />,
		);
		// The cover is the usePlaylistTrackPreview disclosure handle — clicking it
		// pins the preview card open (interaction: "disclosure").
		const handle = container.querySelector('[aria-haspopup="dialog"]');
		expect(handle).not.toBeNull();
		await user.click(handle as HTMLElement);
		expect(handle?.getAttribute("aria-expanded")).toBe("true");
	});

	it("renders all matches in a long list", () => {
		const many = Array.from({ length: 10 }, (_, i) =>
			makePlaylist({
				id: `pl-${i}`,
				name: `Playlist ${i}`,
				matchScore: 0.5 + i * 0.04,
			}),
		);
		renderWithQuery(<MatchesSection {...DEFAULT_PROPS} playlists={many} />);
		for (let i = 0; i < 10; i++) {
			expect(screen.getByText(`Playlist ${i}`)).toBeDefined();
		}
	});
});
