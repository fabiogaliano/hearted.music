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
} from "@/test/mocks";
import { render, screen, waitFor } from "@/test/utils/render";
import { FlagPlaylistsStep } from "../components/FlagPlaylistsStep";

const mockSavePlaylistTargets = vi.fn();
const mockUseShortcut = vi.fn();

vi.mock("../hooks/useOnboardingNavigation", () =>
	setupOnboardingNavigationMock(),
);
vi.mock("../hooks/useFlagPlaylistsScroll", () =>
	setupFlagPlaylistsScrollMock(),
);
vi.mock("@/lib/keyboard/useListNavigation", () => setupListNavigationMock());
vi.mock("@/lib/keyboard/useShortcut", () => ({
	useShortcut: (args: unknown) => mockUseShortcut(args),
}));

vi.mock("@/lib/server/onboarding.functions", () => ({
	savePlaylistTargets: (args: unknown) => mockSavePlaylistTargets(args),
}));

// Stub the dialog: keeps these tests focused on FlagPlaylistsStep's selection
// + trigger behavior. The dialog's own save path is covered separately.
vi.mock("../components/OnboardingDescriptionDialog", () => ({
	OnboardingDescriptionDialog: ({
		playlist,
		onClose,
	}: {
		playlist: { id: string; name: string };
		onClose: () => void;
	}) => (
		<div data-testid="onboarding-description-dialog">
			<span data-testid="dialog-playlist-id">{playlist.id}</span>
			<span data-testid="dialog-playlist-name">{playlist.name}</span>
			<button type="button" onClick={onClose} data-testid="dialog-close">
				close
			</button>
		</div>
	),
}));

vi.mock("@tanstack/react-router", () => ({
	useLocation: () => ({
		state: {
			syncStats: { songs: 100, playlists: 5, playlistSongs: 20, artists: 50 },
		},
	}),
}));

const DESCRIPTION_DIALOG_SEEN_KEY =
	"hearted:has-seen-onboarding-description-dialog";

// jsdom doesn't surface localStorage as a global in this test's process —
// stub a minimal in-memory implementation so the trigger logic can read/write.
function createInMemoryStorage(): Storage {
	const store = new Map<string, string>();
	return {
		get length() {
			return store.size;
		},
		clear: () => store.clear(),
		getItem: (key) => (store.has(key) ? (store.get(key) ?? null) : null),
		key: (index) => Array.from(store.keys())[index] ?? null,
		removeItem: (key) => {
			store.delete(key);
		},
		setItem: (key, value) => {
			store.set(key, String(value));
		},
	};
}

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
		vi.stubGlobal("localStorage", createInMemoryStorage());
		// Most tests assume the user has already seen the description dialog
		// so it doesn't interfere with selection assertions. Tests that exercise
		// the trigger explicitly clear this flag.
		localStorage.setItem(DESCRIPTION_DIALOG_SEEN_KEY, "1");
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

		const continueButton = screen.getByRole("button", {
			name: /continue with\s+2\s+playlists/i,
		});
		expect(continueButton).toBeTruthy();
		if (!continueButton) throw new Error("button not found");
		await user.click(continueButton);

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
				syncStats: { songs: 100, playlists: 5, playlistSongs: 20, artists: 50 },
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

	describe("description dialog trigger", () => {
		it("opens dialog on first ever selection, bound to that playlist", async () => {
			localStorage.removeItem(DESCRIPTION_DIALOG_SEEN_KEY);
			const { user } = render(<FlagPlaylistsStep playlists={testPlaylists} />);

			expect(screen.queryByTestId("onboarding-description-dialog")).toBeNull();

			const focusButton = document.querySelector(
				`[data-playlist-id="${ONBOARDING_PLAYLISTS.focus.id}"]`,
			) as HTMLElement;
			await user.click(focusButton);

			expect(
				screen.getByTestId("onboarding-description-dialog"),
			).toBeInTheDocument();
			expect(screen.getByTestId("dialog-playlist-id")).toHaveTextContent(
				ONBOARDING_PLAYLISTS.focus.id,
			);
		});

		it("does not open dialog when localStorage flag is set", async () => {
			// beforeEach already sets the flag.
			const { user } = render(<FlagPlaylistsStep playlists={testPlaylists} />);
			const lofiButton = document.querySelector(
				`[data-playlist-id="${ONBOARDING_PLAYLISTS.lofiCityPop.id}"]`,
			) as HTMLElement;
			await user.click(lofiButton);
			expect(screen.queryByTestId("onboarding-description-dialog")).toBeNull();
		});

		it("dismiss alone does not set the lifetime flag", async () => {
			localStorage.removeItem(DESCRIPTION_DIALOG_SEEN_KEY);
			const { user } = render(<FlagPlaylistsStep playlists={testPlaylists} />);
			const lofiButton = document.querySelector(
				`[data-playlist-id="${ONBOARDING_PLAYLISTS.lofiCityPop.id}"]`,
			) as HTMLElement;

			await user.click(lofiButton);
			await user.click(screen.getByTestId("dialog-close"));

			// Dismiss must not poison future triggers within the same step.
			expect(localStorage.getItem(DESCRIPTION_DIALOG_SEEN_KEY)).toBeNull();
		});

		it("re-fires on a later 0→1 transition within the same session", async () => {
			localStorage.removeItem(DESCRIPTION_DIALOG_SEEN_KEY);
			const { user } = render(<FlagPlaylistsStep playlists={testPlaylists} />);
			const lofiButton = document.querySelector(
				`[data-playlist-id="${ONBOARDING_PLAYLISTS.lofiCityPop.id}"]`,
			) as HTMLElement;
			const focusButton = document.querySelector(
				`[data-playlist-id="${ONBOARDING_PLAYLISTS.focus.id}"]`,
			) as HTMLElement;

			await user.click(lofiButton);
			expect(
				screen.getByTestId("onboarding-description-dialog"),
			).toBeInTheDocument();
			await user.click(screen.getByTestId("dialog-close"));

			// Deselect → size 0. Then select another → 0→1, must re-fire.
			await user.click(lofiButton);
			await user.click(focusButton);
			expect(
				screen.getByTestId("onboarding-description-dialog"),
			).toBeInTheDocument();
			expect(screen.getByTestId("dialog-playlist-id")).toHaveTextContent(
				ONBOARDING_PLAYLISTS.focus.id,
			);
		});

		it("does not open on subsequent (non-first) selections in the same session", async () => {
			localStorage.removeItem(DESCRIPTION_DIALOG_SEEN_KEY);
			const { user } = render(<FlagPlaylistsStep playlists={testPlaylists} />);
			const lofiButton = document.querySelector(
				`[data-playlist-id="${ONBOARDING_PLAYLISTS.lofiCityPop.id}"]`,
			) as HTMLElement;
			const focusButton = document.querySelector(
				`[data-playlist-id="${ONBOARDING_PLAYLISTS.focus.id}"]`,
			) as HTMLElement;

			await user.click(lofiButton);
			// Dialog is up — dismiss it.
			await user.click(screen.getByTestId("dialog-close"));

			// Adding a SECOND selection on top of the existing one (1→2) is not a
			// 0→1 transition, so the dialog must not reopen.
			await user.click(focusButton);
			expect(screen.queryByTestId("onboarding-description-dialog")).toBeNull();
		});

		it("disables the onboarding Enter shortcut while the dialog is open", async () => {
			localStorage.removeItem(DESCRIPTION_DIALOG_SEEN_KEY);
			const { user } = render(<FlagPlaylistsStep playlists={testPlaylists} />);
			const lofiButton = document.querySelector(
				`[data-playlist-id="${ONBOARDING_PLAYLISTS.lofiCityPop.id}"]`,
			) as HTMLElement;

			await user.click(lofiButton);

			expect(mockUseShortcut).toHaveBeenCalledWith(
				expect.objectContaining({
					key: "enter",
					enabled: false,
				}),
			);
		});

		it("sets the lifetime flag on Continue", async () => {
			localStorage.removeItem(DESCRIPTION_DIALOG_SEEN_KEY);
			const { user } = render(<FlagPlaylistsStep playlists={testPlaylists} />);
			const lofiButton = document.querySelector(
				`[data-playlist-id="${ONBOARDING_PLAYLISTS.lofiCityPop.id}"]`,
			) as HTMLElement;
			await user.click(lofiButton);
			await user.click(screen.getByTestId("dialog-close"));

			const continueButton = screen.getByRole("button", {
				name: /continue with\s+1\s+playlists/i,
			});
			await user.click(continueButton);

			await waitFor(() => {
				expect(localStorage.getItem(DESCRIPTION_DIALOG_SEEN_KEY)).toBe("1");
			});
		});

		it("sets the lifetime flag on Skip", async () => {
			localStorage.removeItem(DESCRIPTION_DIALOG_SEEN_KEY);
			const { user } = render(<FlagPlaylistsStep playlists={testPlaylists} />);

			const skipButtons = screen.getAllByRole("button", {
				name: /Skip for now/i,
			});
			const enabledSkip = skipButtons.find(
				(btn) => !btn.hasAttribute("disabled"),
			);
			if (!enabledSkip) throw new Error("skip button not found");
			await user.click(enabledSkip);

			await waitFor(() => {
				expect(localStorage.getItem(DESCRIPTION_DIALOG_SEEN_KEY)).toBe("1");
			});
		});
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
		if (!enabledSkipButton) throw new Error("skip button not found");
		await user.click(enabledSkipButton);

		await waitFor(() => {
			expect(mockSavePlaylistTargets).toHaveBeenCalledWith({
				data: { playlistIds: [] },
			});
		});

		await waitFor(() => {
			expect(mockGoToStep).toHaveBeenCalledWith("pick-demo-song", {
				syncStats: { songs: 100, playlists: 5, playlistSongs: 20, artists: 50 },
			});
		});
	});
});
