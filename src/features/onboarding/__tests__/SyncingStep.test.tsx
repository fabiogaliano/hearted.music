/**
 * Tests for SyncingStep - progress display and auto-navigation.
 *
 * Focus: Progress states, auto-advance timing, error handling.
 * Mocking: useJobProgress hook to control progress states without SSE.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@/test/utils/render";
import { mockGoToStep, mockTheme, setupOnboardingNavigationMock } from "@/test/mocks";
import { SyncingStep } from "../components/SyncingStep";
import type { JobProgressState } from "@/lib/hooks/useJobProgress";
import type { PhaseJobIds } from "@/lib/jobs/progress/types";
import type { LibrarySummary } from "@/lib/server/onboarding.server";

const mockExecuteSync = vi.fn();
const mockUseJobProgress = vi.fn<(jobId: string | null) => JobProgressState>();

vi.mock("../hooks/useOnboardingNavigation", () => setupOnboardingNavigationMock());

vi.mock("@/lib/server/onboarding.server", () => ({
	executeSync: (args: unknown) => mockExecuteSync(args),
}));

vi.mock("@/lib/hooks/useJobProgress", () => ({
	useJobProgress: (jobId: string | null) => mockUseJobProgress(jobId),
}));

const mockPhaseJobIds: PhaseJobIds = {
	liked_songs: "job-songs-123",
	playlists: "job-playlists-456",
	playlist_tracks: "job-tracks-789",
};

const mockLibrarySummary: LibrarySummary = {
	songsTotal: 500,
	playlistsTotal: 10,
	tracksTotal: 1000,
	cachedPlaylists: [],
};

const createJobProgressState = (
	overrides?: Partial<JobProgressState>,
): JobProgressState => ({
	progress: null,
	status: null,
	items: new Map(),
	itemTotals: new Map(),
	currentItem: null,
	error: null,
	isConnected: false,
	...overrides,
});

const createProgressWithCounts = (
	itemId: string,
	count: number,
	total: number,
	status: JobProgressState["status"] = "running",
): JobProgressState => {
	const items = new Map();
	items.set(itemId, { id: itemId, count, status: "in_progress" });

	const itemTotals = new Map();
	itemTotals.set(itemId, total);

	return createJobProgressState({ status, items, itemTotals });
};

describe("SyncingStep", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecuteSync.mockResolvedValue(undefined);
		mockGoToStep.mockResolvedValue(undefined);

		mockUseJobProgress.mockReturnValue(createJobProgressState());
	});

	it("shows discovering state when no totals received", () => {
		mockUseJobProgress.mockReturnValue(createJobProgressState());

		render(
			<SyncingStep
				theme={mockTheme}
				phaseJobIds={mockPhaseJobIds}
				librarySummary={mockLibrarySummary}
			/>,
		);

		expect(
			screen.getByText(/Counting your songs and playlists/i),
		).toBeInTheDocument();
	});

	it("displays progress percentage when syncing", () => {
		mockUseJobProgress.mockImplementation((jobId) => {
			if (jobId === "job-songs-123") {
				return createProgressWithCounts("liked_songs", 250, 500, "running");
			}
			if (jobId === "job-playlists-456") {
				return createProgressWithCounts("playlists", 5, 10, "running");
			}
			if (jobId === "job-tracks-789") {
				return createProgressWithCounts("playlist_tracks", 500, 1000, "running");
			}
			return createJobProgressState();
		});

		render(
			<SyncingStep
				theme={mockTheme}
				phaseJobIds={mockPhaseJobIds}
				librarySummary={mockLibrarySummary}
			/>,
		);

		expect(screen.getByText(/250\/500 liked songs/i)).toBeInTheDocument();
		expect(screen.getByText(/5\/10 playlists/i)).toBeInTheDocument();
		expect(screen.getByText(/500\/1,000 playlist tracks/i)).toBeInTheDocument();
	});

	it("auto-advances to flag-playlists after completion delay", async () => {
		const completedState = (
			itemId: string,
			total: number,
		): JobProgressState => {
			const items = new Map();
			items.set(itemId, { id: itemId, count: total, status: "succeeded" });
			const itemTotals = new Map();
			itemTotals.set(itemId, total);
			return createJobProgressState({
				status: "completed",
				items,
				itemTotals,
			});
		};

		mockUseJobProgress.mockImplementation((jobId) => {
			if (jobId === "job-songs-123") {
				return completedState("liked_songs", 500);
			}
			if (jobId === "job-playlists-456") {
				return completedState("playlists", 10);
			}
			if (jobId === "job-tracks-789") {
				return completedState("playlist_tracks", 1000);
			}
			return createJobProgressState();
		});

		render(
			<SyncingStep
				theme={mockTheme}
				phaseJobIds={mockPhaseJobIds}
				librarySummary={mockLibrarySummary}
			/>,
		);

		await waitFor(
			() => {
				expect(mockGoToStep).toHaveBeenCalledWith("flag-playlists", {
					syncStats: { songs: 500, playlists: 10 },
				});
			},
			{ timeout: 3000 },
		);
	}, 10000);

	it("shows error state when phaseJobIds is null", () => {
		render(
			<SyncingStep
				theme={mockTheme}
				phaseJobIds={null}
				librarySummary={mockLibrarySummary}
			/>,
		);

		expect(screen.getByText(/Sync interrupted/i)).toBeInTheDocument();
		expect(
			screen.getByText(/Please start over to sync your library/i),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /Start Over/i }),
		).toBeInTheDocument();
	});
});
