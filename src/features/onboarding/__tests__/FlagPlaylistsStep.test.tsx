/**
 * Tests for FlagPlaylistsStep - playlist target selection.
 *
 * Focus: Selection logic, save behavior, skip functionality.
 * Skipped: Keyboard navigation (complex hook mocking), scroll behavior (visual).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ONBOARDING_PLAYLISTS,
	PLAYLISTS,
	toOnboardingPlaylist,
} from "@/test/fixtures";
import {
	mockGoToStep,
	setupFlagPlaylistsScrollMock,
	setupListNavigationMock,
	setupOnboardingNavigationMock,
	setupShortcutMock,
} from "@/test/mocks";
import { render, screen, waitFor } from "@/test/utils/render";
import { FlagPlaylistsStep } from "../components/FlagPlaylistsStep";

const mockSavePlaylistTargets = vi.fn();

vi.mock("../hooks/useOnboardingNavigation", () =>
	setupOnboardingNavigationMock(),
);
vi.mock("../hooks/useFlagPlaylistsScroll", () =>
	setupFlagPlaylistsScrollMock(),
);
vi.mock("@/lib/keyboard/useListNavigation", () => setupListNavigationMock());
vi.mock("@/lib/keyboard/useShortcut", () => setupShortcutMock());

vi.mock("@/lib/server/onboarding.functions", () => ({
	savePlaylistTargets: (args: unknown) => mockSavePlaylistTargets(args),
}));

vi.mock("@tanstack/react-router", () => ({
	useLocation: () => ({ state: { syncStats: { songs: 100, playlists: 5 } } }),
}));

const testPlaylists = [
	ONBOARDING_PLAYLISTS.lofiCityPop,
	ONBOARDING_PLAYLISTS.oldRock,
	ONBOARDING_PLAYLISTS.focus,
];

describe("FlagPlaylistsStep", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSavePlaylistTargets.mockResolvedValue(undefined);
		mockGoToStep.mockResolvedValue(undefined);
	});

	it("renders playlist grid with correct names", () => {
		render(<FlagPlaylistsStep playlists={testPlaylists} />);

		expect(
			document.querySelector(
				`[data-playlist-id="${ONBOARDING_PLAYLISTS.lofiCityPop.id}"]`,
			),
		).toHaveAttribute("title", ONBOARDING_PLAYLISTS.lofiCityPop.name);
		expect(
			document.querySelector(
				`[data-playlist-id="${ONBOARDING_PLAYLISTS.oldRock.id}"]`,
			),
		).toHaveAttribute("title", ONBOARDING_PLAYLISTS.oldRock.name);
		expect(
			document.querySelector(
				`[data-playlist-id="${ONBOARDING_PLAYLISTS.focus.id}"]`,
			),
		).toHaveAttribute("title", ONBOARDING_PLAYLISTS.focus.name);
	});

	it("toggles selection on click", async () => {
		const { user } = render(<FlagPlaylistsStep playlists={testPlaylists} />);

		const playlistButton = document.querySelector(
			`[data-playlist-id="${ONBOARDING_PLAYLISTS.lofiCityPop.id}"]`,
		) as HTMLElement;

		expect(playlistButton).toHaveAttribute("aria-pressed", "false");

		await user.click(playlistButton);
		expect(playlistButton).toHaveAttribute("aria-pressed", "true");

		await user.click(playlistButton);
		expect(playlistButton).toHaveAttribute("aria-pressed", "false");
	});

	it("calls save with selected playlist IDs on continue", async () => {
		const { user } = render(<FlagPlaylistsStep playlists={testPlaylists} />);

		const lofiButton = document.querySelector(
			`[data-playlist-id="${ONBOARDING_PLAYLISTS.lofiCityPop.id}"]`,
		) as HTMLElement;
		const focusButton = document.querySelector(
			`[data-playlist-id="${ONBOARDING_PLAYLISTS.focus.id}"]`,
		) as HTMLElement;

		await user.click(lofiButton);
		await user.click(focusButton);

		const continueButton = screen
			.getByText("Continue with 2 playlists")
			.closest("button");
		expect(continueButton).toBeTruthy();
		await user.click(continueButton!);

		await waitFor(() => {
			expect(mockSavePlaylistTargets).toHaveBeenCalledWith({
				data: {
					playlistIds: expect.arrayContaining([
						ONBOARDING_PLAYLISTS.lofiCityPop.id,
						ONBOARDING_PLAYLISTS.focus.id,
					]),
				},
			});
		});

		await waitFor(() => {
			expect(mockGoToStep).toHaveBeenCalledWith("pick-demo-song", {
				syncStats: { songs: 100, playlists: 5 },
			});
		});
	});

	it("initializes selection from isTarget flag", () => {
		const playlistsWithTargets = [
			toOnboardingPlaylist(PLAYLISTS.lofiCityPop, { isTarget: true }),
			toOnboardingPlaylist(PLAYLISTS.oldRock, { isTarget: false }),
			toOnboardingPlaylist(PLAYLISTS.years2009to2013), // already true in fixture
		];

		render(<FlagPlaylistsStep playlists={playlistsWithTargets} />);

		const lofiBtn = document.querySelector(
			`[data-playlist-id="${PLAYLISTS.lofiCityPop.id}"]`,
		);
		const rockBtn = document.querySelector(
			`[data-playlist-id="${PLAYLISTS.oldRock.id}"]`,
		);
		const yearsBtn = document.querySelector(
			`[data-playlist-id="${PLAYLISTS.years2009to2013.id}"]`,
		);

		expect(lofiBtn).toHaveAttribute("aria-pressed", "true");
		expect(yearsBtn).toHaveAttribute("aria-pressed", "true");
		expect(rockBtn).toHaveAttribute("aria-pressed", "false");
	});

	it("skip saves empty array and navigates", async () => {
		const { user } = render(<FlagPlaylistsStep playlists={testPlaylists} />);

		const skipButtons = screen.getAllByRole("button", {
			name: /Skip for now/i,
		});
		const enabledSkipButton = skipButtons.find(
			(btn) => !btn.hasAttribute("disabled"),
		);
		expect(enabledSkipButton).toBeDefined();

		await user.click(enabledSkipButton!);

		await waitFor(() => {
			expect(mockSavePlaylistTargets).toHaveBeenCalledWith({
				data: { playlistIds: [] },
			});
		});

		await waitFor(() => {
			expect(mockGoToStep).toHaveBeenCalledWith("pick-demo-song", {
				syncStats: { songs: 100, playlists: 5 },
			});
		});
	});
});
