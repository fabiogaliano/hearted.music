/**
 * Integration tests for onboarding flow.
 *
 * Tests the complete user journey through onboarding steps.
 * Mocks server functions and job progress to simulate the full flow.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingData } from "@/lib/server/onboarding.functions";
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
import { AuthenticatedThemeProvider } from "@/lib/theme/authenticated-theme";
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
	theme: "rose",
	playlists: testPlaylists,
	currentStep: "welcome",
	isComplete: false,
	phaseJobIds: null,
	syncStats: { songs: 0, playlists: 0 },
	...overrides,
});

function renderOnboarding(
	step: OnboardingData["currentStep"],
	data: OnboardingData,
) {
	return render(
		<AuthenticatedThemeProvider initialThemeColor={data.theme ?? "rose"}>
			<Onboarding step={step} data={data} />
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

	it("renders flag-playlists step with playlist selection", async () => {
		const data = createMockOnboardingData();

		const { user } = renderOnboarding("flag-playlists", data);

		const stepContainer = document.querySelector(
			'[data-step="flag-playlists"]',
		);
		expect(stepContainer).toBeInTheDocument();

		const container = within(stepContainer as HTMLElement);
		const lofiButton = container.getByRole("button", {
			name: /lo-fi tokyo City Pop/i,
		});
		const rockButton = container.getByRole("button", {
			name: /old rock - coding zone/i,
		});

		expect(lofiButton).toBeInTheDocument();
		expect(rockButton).toBeInTheDocument();
		expect(rockButton).toHaveAttribute("aria-pressed", "true");

		await user.click(lofiButton);
		expect(lofiButton).toHaveAttribute("aria-pressed", "true");
	});

	it("renders ready step with completion message", () => {
		renderOnboarding(
			"ready",
			createMockOnboardingData({
				syncStats: { songs: 500, playlists: 10 },
			}),
		);

		const stepContainer = document.querySelector('[data-step="ready"]');
		expect(stepContainer).toBeInTheDocument();

		const container = within(stepContainer as HTMLElement);
		expect(container.getByText(/Start Exploring/i)).toBeInTheDocument();
	});
});
