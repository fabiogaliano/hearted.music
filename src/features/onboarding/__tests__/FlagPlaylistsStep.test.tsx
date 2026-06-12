/**
 * Tests for FlagPlaylistsStep - single playlist target selection.
 *
 * Focus: single-select, the dialog-driven advance/dismiss wiring, footer skip.
 * Skipped: keyboard navigation (complex hook mocking), scroll behavior (visual).
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

vi.mock("../hooks/useOnboardingNavigation", () =>
	setupOnboardingNavigationMock(),
);
vi.mock("../hooks/useFlagPlaylistsScroll", () =>
	setupFlagPlaylistsScrollMock(),
);
vi.mock("@/lib/keyboard/useListNavigation", () => setupListNavigationMock());

vi.mock("@/lib/server/onboarding.functions", () => ({
	savePlaylistTargets: (args: unknown) => mockSavePlaylistTargets(args),
}));

// Stub the dialog: keeps these tests focused on FlagPlaylistsStep's selection
// and the advance/dismiss wiring. The dialog's own save path is covered
// separately. Each callback is surfaced as a button so tests can drive it.
vi.mock("../components/OnboardingDescriptionDialog", () => ({
	OnboardingDescriptionDialog: ({
		playlist,
		onClose,
		onCommitAndContinue,
		onSkipStep,
	}: {
		playlist: { id: string; name: string };
		onClose: () => void;
		onCommitAndContinue: () => void;
		onSkipStep: () => void;
	}) => (
		<div data-testid="onboarding-description-dialog">
			<span data-testid="dialog-playlist-id">{playlist.id}</span>
			<span data-testid="dialog-playlist-name">{playlist.name}</span>
			<button type="button" onClick={onClose} data-testid="dialog-close">
				close
			</button>
			<button
				type="button"
				onClick={() => void onCommitAndContinue()}
				data-testid="dialog-commit"
			>
				commit
			</button>
			<button
				type="button"
				onClick={() => void onSkipStep()}
				data-testid="dialog-skip"
			>
				skip
			</button>
		</div>
	),
}));

vi.mock("@tanstack/react-router", () => ({
	useLocation: () => ({
		state: {},
	}),
}));

const testPlaylists = [
	ONBOARDING_PLAYLISTS.lofiCityPop,
	ONBOARDING_PLAYLISTS.oldRock,
	ONBOARDING_PLAYLISTS.focus,
];

function getCard(id: string): HTMLElement {
	const el = document.querySelector(`[data-playlist-id="${id}"]`);
	if (!(el instanceof HTMLElement)) throw new Error(`card ${id} not found`);
	return el;
}

describe("FlagPlaylistsStep", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSavePlaylistTargets.mockResolvedValue(undefined);
		mockGoToStep.mockResolvedValue({ status: "transitioned" });
	});

	it("selects a playlist on click and opens the dialog bound to it", async () => {
		const { user } = render(
			<FlagPlaylistsStep playlists={testPlaylists} accountId="acct-test" />,
		);

		const lofi = getCard(ONBOARDING_PLAYLISTS.lofiCityPop.id);
		expect(lofi).toHaveAttribute("aria-pressed", "false");
		expect(screen.queryByTestId("onboarding-description-dialog")).toBeNull();

		await user.click(lofi);

		expect(lofi).toHaveAttribute("aria-pressed", "true");
		expect(
			screen.getByTestId("onboarding-description-dialog"),
		).toBeInTheDocument();
		expect(screen.getByTestId("dialog-playlist-id")).toHaveTextContent(
			ONBOARDING_PLAYLISTS.lofiCityPop.id,
		);
	});

	it("is single-select: picking a second playlist moves the selection", async () => {
		const { user } = render(
			<FlagPlaylistsStep playlists={testPlaylists} accountId="acct-test" />,
		);

		const lofi = getCard(ONBOARDING_PLAYLISTS.lofiCityPop.id);
		const focus = getCard(ONBOARDING_PLAYLISTS.focus.id);

		await user.click(lofi);
		// Dismiss so the second card is reachable (the modal would otherwise block).
		await user.click(screen.getByTestId("dialog-close"));
		await user.click(focus);

		expect(focus).toHaveAttribute("aria-pressed", "true");
		expect(lofi).toHaveAttribute("aria-pressed", "false");
		expect(screen.getByTestId("dialog-playlist-id")).toHaveTextContent(
			ONBOARDING_PLAYLISTS.focus.id,
		);
	});

	it("does not auto-open the dialog on mount", () => {
		render(
			<FlagPlaylistsStep playlists={testPlaylists} accountId="acct-test" />,
		);
		expect(screen.queryByTestId("onboarding-description-dialog")).toBeNull();
	});

	it("seeds the selection from an existing target without opening the dialog", () => {
		const playlistsWithTarget = [
			toOnboardingPlaylist(PLAYLISTS.lofiCityPop, { isTarget: false }),
			toOnboardingPlaylist(PLAYLISTS.years2009to2013, { isTarget: true }),
		];

		render(
			<FlagPlaylistsStep
				playlists={playlistsWithTarget}
				accountId="acct-test"
			/>,
		);

		expect(getCard(PLAYLISTS.years2009to2013.id)).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(getCard(PLAYLISTS.lofiCityPop.id)).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		expect(screen.queryByTestId("onboarding-description-dialog")).toBeNull();
	});

	it("dismissing the dialog deselects and commits nothing", async () => {
		const { user } = render(
			<FlagPlaylistsStep playlists={testPlaylists} accountId="acct-test" />,
		);

		const lofi = getCard(ONBOARDING_PLAYLISTS.lofiCityPop.id);
		await user.click(lofi);
		expect(lofi).toHaveAttribute("aria-pressed", "true");

		await user.click(screen.getByTestId("dialog-close"));

		expect(screen.queryByTestId("onboarding-description-dialog")).toBeNull();
		expect(lofi).toHaveAttribute("aria-pressed", "false");
		expect(mockSavePlaylistTargets).not.toHaveBeenCalled();
	});

	it("commit saves the single selected target and advances", async () => {
		const { user } = render(
			<FlagPlaylistsStep playlists={testPlaylists} accountId="acct-test" />,
		);

		await user.click(getCard(ONBOARDING_PLAYLISTS.focus.id));
		await user.click(screen.getByTestId("dialog-commit"));

		await waitFor(() => {
			expect(mockSavePlaylistTargets).toHaveBeenCalledWith({
				data: { playlistIds: [ONBOARDING_PLAYLISTS.focus.id] },
			});
		});
		await waitFor(() => {
			expect(mockGoToStep).toHaveBeenCalledWith("pick-demo-song");
		});
	});

	it("dialog skip saves an empty target set and advances", async () => {
		const { user } = render(
			<FlagPlaylistsStep playlists={testPlaylists} accountId="acct-test" />,
		);

		await user.click(getCard(ONBOARDING_PLAYLISTS.lofiCityPop.id));
		await user.click(screen.getByTestId("dialog-skip"));

		await waitFor(() => {
			expect(mockSavePlaylistTargets).toHaveBeenCalledWith({
				data: { playlistIds: [] },
			});
		});
		await waitFor(() => {
			expect(mockGoToStep).toHaveBeenCalledWith("pick-demo-song");
		});
	});

	it("footer skip saves an empty target set and advances", async () => {
		const { user } = render(
			<FlagPlaylistsStep playlists={testPlaylists} accountId="acct-test" />,
		);

		await user.click(screen.getByRole("button", { name: /Skip for now/i }));

		await waitFor(() => {
			expect(mockSavePlaylistTargets).toHaveBeenCalledWith({
				data: { playlistIds: [] },
			});
		});
		await waitFor(() => {
			expect(mockGoToStep).toHaveBeenCalledWith("pick-demo-song");
		});
	});

	it("re-selecting the same playlist after dismiss reopens the dialog", async () => {
		const { user } = render(
			<FlagPlaylistsStep playlists={testPlaylists} accountId="acct-test" />,
		);

		const lofi = getCard(ONBOARDING_PLAYLISTS.lofiCityPop.id);
		await user.click(lofi);
		await user.click(screen.getByTestId("dialog-close"));
		expect(screen.queryByTestId("onboarding-description-dialog")).toBeNull();

		await user.click(lofi);
		expect(
			screen.getByTestId("onboarding-description-dialog"),
		).toBeInTheDocument();
		expect(screen.getByTestId("dialog-playlist-id")).toHaveTextContent(
			ONBOARDING_PLAYLISTS.lofiCityPop.id,
		);
	});
});
