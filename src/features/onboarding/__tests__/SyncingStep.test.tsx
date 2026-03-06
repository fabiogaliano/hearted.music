/**
 * Tests for SyncingStep - progress display and auto-navigation.
 *
 * Focus: Progress states, auto-advance timing, error handling.
 * Mocking: useJobProgress hook to control progress states without SSE.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobProgressState } from "@/lib/hooks/useJobProgress";
import type { PhaseJobIds } from "@/lib/jobs/progress/types";
import { mockGoToStep, setupOnboardingNavigationMock } from "@/test/mocks";
import { render, screen, waitFor } from "@/test/utils/render";
import { SyncingStep } from "../components/SyncingStep";

const DEFAULT_PROGRESS: JobProgressState = {
	progress: null,
	status: null,
	items: new Map(),
	itemTotals: new Map(),
	currentItem: null,
	error: null,
	isConnected: false,
};

const mockUseJobProgress = vi
	.fn<(jobId: string | null) => JobProgressState>()
	.mockReturnValue(DEFAULT_PROGRESS);

vi.mock("../hooks/useOnboardingNavigation", () =>
	setupOnboardingNavigationMock(),
);

vi.mock("@/lib/hooks/useJobProgress", () => ({
	useJobProgress: (jobId: string | null) =>
		mockUseJobProgress(jobId) ?? DEFAULT_PROGRESS,
}));

vi.mock("@/lib/server/onboarding.functions", () => ({
	pollPhaseJobIds: vi.fn().mockResolvedValue(null),
}));

const mockPhaseJobIds: PhaseJobIds = {
	liked_songs: "job-songs-123",
	playlists: "job-playlists-456",
	playlist_tracks: "job-tracks-789",
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
	afterEach(() => {
		vi.restoreAllMocks();
	});

	beforeEach(() => {
		vi.clearAllMocks();
		mockGoToStep.mockResolvedValue(undefined);

		mockUseJobProgress.mockReturnValue(createJobProgressState());
	});

	it("shows discovering state when no totals received", () => {
		mockUseJobProgress.mockReturnValue(createJobProgressState());

		render(<SyncingStep phaseJobIds={mockPhaseJobIds} />);

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
				return createProgressWithCounts(
					"playlist_tracks",
					500,
					1000,
					"running",
				);
			}
			return createJobProgressState();
		});

		render(<SyncingStep phaseJobIds={mockPhaseJobIds} />);

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

		render(<SyncingStep phaseJobIds={mockPhaseJobIds} />);

		await waitFor(
			() => {
				expect(mockGoToStep).toHaveBeenCalledWith("flag-playlists", {
					syncStats: { songs: 500, playlists: 10 },
				});
			},
			{ timeout: 3000 },
		);
	}, 10000);

	it("shows waiting for extension state when phaseJobIds is null", () => {
		render(<SyncingStep phaseJobIds={null} />);

		expect(screen.getByText(/Waiting for/i)).toBeInTheDocument();
		expect(screen.getByText(/Spotify/i)).toBeInTheDocument();
	});
});
