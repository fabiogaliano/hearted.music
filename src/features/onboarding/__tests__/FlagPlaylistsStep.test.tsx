/**
 * Tests for FlagPlaylistsStep - playlist destination selection.
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
	mockTheme,
	setupFlagPlaylistsScrollMock,
	setupListNavigationMock,
	setupOnboardingNavigationMock,
	setupShortcutMock,
} from "@/test/mocks";
import { render, screen, waitFor } from "@/test/utils/render";
import { FlagPlaylistsStep } from "../components/FlagPlaylistsStep";

const mockSavePlaylistDestinations = vi.fn();

vi.mock("../hooks/useOnboardingNavigation", () =>
	setupOnboardingNavigationMock(),
);
vi.mock("../hooks/useFlagPlaylistsScroll", () =>
	setupFlagPlaylistsScrollMock(),
);
vi.mock("@/lib/keyboard/useListNavigation", () => setupListNavigationMock());
vi.mock("@/lib/keyboard/useShortcut", () => setupShortcutMock());

vi.mock("@/lib/server/onboarding.server", () => ({
	savePlaylistDestinations: (args: unknown) =>
		mockSavePlaylistDestinations(args),
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
		mockSavePlaylistDestinations.mockResolvedValue(undefined);
		mockGoToStep.mockResolvedValue(undefined);
	});

	it("renders playlist grid with correct names", () => {
		render(<FlagPlaylistsStep theme={mockTheme} playlists={testPlaylists} />);

		expect(
			screen.getByRole("button", { name: /lo-fi tokyo City Pop/i }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /old rock - coding zone/i }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /focus - v2/i }),
		).toBeInTheDocument();
	});

	it("toggles selection on click", async () => {
		const { user } = render(
			<FlagPlaylistsStep theme={mockTheme} playlists={testPlaylists} />,
		);

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
		const { user } = render(
			<FlagPlaylistsStep theme={mockTheme} playlists={testPlaylists} />,
		);

		const lofiButton = document.querySelector(
			`[data-playlist-id="${ONBOARDING_PLAYLISTS.lofiCityPop.id}"]`,
		) as HTMLElement;
		const focusButton = document.querySelector(
			`[data-playlist-id="${ONBOARDING_PLAYLISTS.focus.id}"]`,
		) as HTMLElement;

		await user.click(lofiButton);
		await user.click(focusButton);

		const continueButtons = screen.getAllByRole("button", {
			name: /Continue with/i,
		});
		await user.click(continueButtons[0]);

		await waitFor(() => {
			expect(mockSavePlaylistDestinations).toHaveBeenCalledWith({
				data: {
					playlistIds: expect.arrayContaining([
						ONBOARDING_PLAYLISTS.lofiCityPop.id,
						ONBOARDING_PLAYLISTS.focus.id,
					]),
				},
			});
		});

		await waitFor(() => {
			expect(mockGoToStep).toHaveBeenCalledWith("ready", {
				syncStats: { songs: 100, playlists: 5 },
			});
		});
	});

	it("initializes selection from isDestination flag", () => {
		const playlistsWithDestinations = [
			toOnboardingPlaylist(PLAYLISTS.lofiCityPop, { isDestination: true }),
			toOnboardingPlaylist(PLAYLISTS.oldRock, { isDestination: false }),
			toOnboardingPlaylist(PLAYLISTS.years2009to2013), // already true in fixture
		];

		render(
			<FlagPlaylistsStep
				theme={mockTheme}
				playlists={playlistsWithDestinations}
			/>,
		);

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
		const { user } = render(
			<FlagPlaylistsStep theme={mockTheme} playlists={testPlaylists} />,
		);

		const skipButtons = screen.getAllByRole("button", {
			name: /Skip for now/i,
		});
		const enabledSkipButton = skipButtons.find(
			(btn) => !btn.hasAttribute("disabled"),
		);
		expect(enabledSkipButton).toBeDefined();

		await user.click(enabledSkipButton!);

		await waitFor(() => {
			expect(mockSavePlaylistDestinations).toHaveBeenCalledWith({
				data: { playlistIds: [] },
			});
		});

		await waitFor(() => {
			expect(mockGoToStep).toHaveBeenCalledWith("ready", {
				syncStats: { songs: 100, playlists: 5 },
			});
		});
	});
});
