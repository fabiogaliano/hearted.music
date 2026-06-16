/**
 * Integration tests for onboarding flow.
 *
 * Tests the complete user journey through onboarding steps.
 * Mocks server functions and job progress to simulate the full flow.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingData } from "@/lib/server/onboarding.functions";
import { AuthenticatedThemeProvider } from "@/lib/theme/authenticated-theme";
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
import { render, screen, within } from "@/test/utils/render";
import { Onboarding } from "../Onboarding";

const mockSavePlaylistTargets = vi.fn();
const mockSaveThemePreference = vi.fn();
const mockUseLocation = vi.fn(() => ({ state: {} }));

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
	saveThemePreference: (args: unknown) => mockSaveThemePreference(args),
}));

vi.mock("../components/SyncingStep", () => ({
	SyncingStep: ({ phaseJobIds }: { phaseJobIds: unknown }) => (
		<div data-testid="syncing-step-phase-job-ids">
			{phaseJobIds === null ? "null" : "non-null"}
		</div>
	),
}));

// Stub the teaching dialog so the flag-playlists step doesn't pull the real
// dialog's TanStack Query (genre quick-picks) into this provider-light
// integration render; selecting a playlist opens it on every pick now.
vi.mock("../components/OnboardingDescriptionDialog", () => ({
	OnboardingDescriptionDialog: ({ onClose }: { onClose: () => void }) => (
		<div data-testid="onboarding-description-dialog">
			<button type="button" onClick={onClose} data-testid="dialog-close">
				close
			</button>
		</div>
	),
}));

vi.mock("@tanstack/react-router", () => ({
	useLocation: () => mockUseLocation(),
	useNavigate: () => vi.fn(),
}));

const testPlaylists = [
	ONBOARDING_PLAYLISTS.lofiCityPop,
	toOnboardingPlaylist(PLAYLISTS.oldRock, { isTarget: true }),
];

const createMockOnboardingData = (
	overrides?: Partial<OnboardingData>,
): OnboardingData => ({
	accountId: "test-account-id",
	claimHandleSeed: { kind: "blank" },
	theme: "rose",
	playlists: testPlaylists,
	session: { status: "welcome" },
	phaseJobIds: null,
	syncStats: { songs: 0, playlists: 0, playlistSongs: 0, artists: 0 },
	readyCopyVariant: "free",
	landingSongs: [],
	...overrides,
});

function renderOnboarding(
	step: OnboardingData["session"]["status"],
	data: OnboardingData,
) {
	return render(
		<AuthenticatedThemeProvider initialThemeColor={data.theme ?? "rose"}>
			<Onboarding step={step} data={data} accountId={data.accountId} />
		</AuthenticatedThemeProvider>,
	);
}

describe("Onboarding Flow", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUseLocation.mockReturnValue({ state: {} });
		mockGoToStep.mockResolvedValue(undefined);
		mockSavePlaylistTargets.mockResolvedValue(undefined);
		mockSaveThemePreference.mockResolvedValue(undefined);
	});

	it("uses explicit null phaseJobIds from navigation state over DB fallback", () => {
		mockUseLocation.mockReturnValue({
			state: { phaseJobIds: null },
		});

		renderOnboarding(
			"syncing",
			createMockOnboardingData({
				phaseJobIds: {
					liked_songs: "db-liked",
					playlists: "db-playlists",
					playlist_tracks: "db-tracks",
				},
			}),
		);

		expect(screen.getByTestId("syncing-step-phase-job-ids")).toHaveTextContent(
			"null",
		);
	});

	it("renders welcome step with app branding", () => {
		renderOnboarding("welcome", createMockOnboardingData());

		const stepContainer = document.querySelector('[data-step="welcome"]');
		expect(stepContainer).toBeInTheDocument();

		const container = within(stepContainer as HTMLElement);
		expect(container.getByText(/hearted/i)).toBeInTheDocument();
	});

	it("renders pick-color step with theme options", () => {
		renderOnboarding("pick-color", createMockOnboardingData());

		const stepContainer = document.querySelector('[data-step="pick-color"]');
		expect(stepContainer).toBeInTheDocument();

		const container = within(stepContainer as HTMLElement);
		expect(container.getByText(/Pick your/i)).toBeInTheDocument();
	});
});
