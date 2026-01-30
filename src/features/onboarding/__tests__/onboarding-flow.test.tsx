/**
 * Integration tests for onboarding flow.
 *
 * Tests the complete user journey through onboarding steps.
 * Mocks server functions and job progress to simulate the full flow.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, within } from "@/test/utils/render";
import {
	mockGoToStep,
	setupFlagPlaylistsScrollMock,
	setupJobProgressMock,
	setupListNavigationMock,
	setupOnboardingNavigationMock,
	setupShortcutMock,
} from "@/test/mocks";
import {
	ONBOARDING_PLAYLISTS,
	toOnboardingPlaylist,
	PLAYLISTS,
} from "@/test/fixtures";
import { Onboarding } from "../Onboarding";
import type { OnboardingData } from "@/lib/server/onboarding.server";

const mockSavePlaylistDestinations = vi.fn();
const mockSaveTheme = vi.fn();

vi.mock("../hooks/useOnboardingNavigation", () =>
	setupOnboardingNavigationMock(),
);
vi.mock("../hooks/useFlagPlaylistsScroll", () =>
	setupFlagPlaylistsScrollMock(),
);
vi.mock("@/lib/keyboard/useListNavigation", () => setupListNavigationMock());
vi.mock("@/lib/keyboard/useShortcut", () => setupShortcutMock());
vi.mock("@/lib/hooks/useJobProgress", () => setupJobProgressMock());

vi.mock("@/lib/server/onboarding.server", () => ({
	savePlaylistDestinations: (args: unknown) =>
		mockSavePlaylistDestinations(args),
	saveTheme: (args: unknown) => mockSaveTheme(args),
}));

vi.mock("@tanstack/react-router", () => ({
	useLocation: () => ({ state: {} }),
	useNavigate: () => vi.fn(),
}));

const testPlaylists = [
	ONBOARDING_PLAYLISTS.lofiCityPop,
	toOnboardingPlaylist(PLAYLISTS.oldRock, { isDestination: true }),
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

describe("Onboarding Flow", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGoToStep.mockResolvedValue(undefined);
		mockSavePlaylistDestinations.mockResolvedValue(undefined);
		mockSaveTheme.mockResolvedValue(undefined);
	});

	it("renders welcome step with app branding", () => {
		render(<Onboarding step="welcome" data={createMockOnboardingData()} />);

		const stepContainer = document.querySelector('[data-step="welcome"]');
		expect(stepContainer).toBeInTheDocument();

		const container = within(stepContainer as HTMLElement);
		expect(container.getByText(/hearted/i)).toBeInTheDocument();
	});

	it("renders pick-color step with theme options", () => {
		render(<Onboarding step="pick-color" data={createMockOnboardingData()} />);

		const stepContainer = document.querySelector('[data-step="pick-color"]');
		expect(stepContainer).toBeInTheDocument();

		const container = within(stepContainer as HTMLElement);
		expect(container.getByText(/Pick your/i)).toBeInTheDocument();
	});

	it("renders flag-playlists step with playlist selection", async () => {
		const data = createMockOnboardingData();

		const { user } = render(<Onboarding step="flag-playlists" data={data} />);

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
		render(
			<Onboarding
				step="ready"
				data={createMockOnboardingData({
					syncStats: { songs: 500, playlists: 10 },
				})}
			/>,
		);

		const stepContainer = document.querySelector('[data-step="ready"]');
		expect(stepContainer).toBeInTheDocument();

		const container = within(stepContainer as HTMLElement);
		expect(container.getByText(/Start Exploring/i)).toBeInTheDocument();
	});
});
