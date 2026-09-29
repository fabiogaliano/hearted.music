/**
 * Onboarding step-shell wiring: which phaseJobIds source reaches SyncingStep
 * when navigation state and the DB snapshot disagree.
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
	setupListNavigationMock,
	setupOnboardingNavigationMock,
	setupShortcutMock,
} from "@/test/mocks";
import { render, screen } from "@/test/utils/render";
import { Onboarding } from "../Onboarding";

const mockSaveThemePreference = vi.fn();
const mockUseLocation = vi.fn(() => ({ state: {} }));

vi.mock("../hooks/useOnboardingNavigation", () =>
	setupOnboardingNavigationMock(),
);
vi.mock("@/lib/keyboard/useListNavigation", () => setupListNavigationMock());
vi.mock("@/lib/keyboard/useShortcut", () => setupShortcutMock());
vi.mock("@/lib/server/onboarding.functions", () => ({
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
});
