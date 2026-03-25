/**
 * Tests for SyncingStep - extension-driven progress and auto-navigation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionSyncState } from "@/lib/extension/detect";
import { mockGoToStep, setupOnboardingNavigationMock } from "@/test/mocks";
import { render, screen, waitFor } from "@/test/utils/render";
import { SyncingStep } from "../components/SyncingStep";

const mockGetExtensionStatus = vi.fn();
const mockTriggerExtensionSync = vi.fn();

vi.mock("../hooks/useOnboardingNavigation", () =>
	setupOnboardingNavigationMock(),
);

vi.mock("@/lib/extension/detect", () => ({
	getExtensionStatus: () => mockGetExtensionStatus(),
	triggerExtensionSync: () => mockTriggerExtensionSync(),
}));

function createSyncState(
	overrides?: Partial<ExtensionSyncState>,
): ExtensionSyncState {
	return {
		status: "syncing",
		phase: "likedSongs",
		fetched: 0,
		total: 0,
		likedSongs: { fetched: 0, total: 0 },
		playlists: { fetched: 0, total: 0 },
		playlistTracks: { fetched: 0, total: 0 },
		artistImages: { fetched: 0, total: 0 },
		lastSyncAt: null,
		error: null,
		...overrides,
	};
}

describe("SyncingStep", () => {
	beforeEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
		mockGoToStep.mockResolvedValue(undefined);
		mockGetExtensionStatus.mockResolvedValue({
			hasToken: true,
			tokenExpiresAtMs: null,
			sync: createSyncState(),
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("shows discovery copy before any counts are known", async () => {
		render(<SyncingStep phaseJobIds={null} />);

		await waitFor(() => {
			expect(screen.getByText(/Reading liked songs/i)).toBeInTheDocument();
		});
	});

	it("displays syncing counts including artist images", async () => {
		mockGetExtensionStatus.mockResolvedValue({
			hasToken: true,
			tokenExpiresAtMs: null,
			sync: createSyncState({
				phase: "artistImages",
				likedSongs: { fetched: 500, total: 500 },
				playlists: { fetched: 10, total: 10 },
				playlistTracks: { fetched: 1_000, total: 1_000 },
				artistImages: { fetched: 120, total: 240 },
			}),
		});

		render(<SyncingStep phaseJobIds={null} />);

		await waitFor(() => {
			expect(screen.getByText(/500\/500 liked songs/i)).toBeInTheDocument();
			expect(screen.getByText(/10\/10 playlists/i)).toBeInTheDocument();
			expect(
				screen.getByText(/1,000\/1,000 playlist tracks/i),
			).toBeInTheDocument();
			expect(screen.getByText(/120\/240 artists/i)).toBeInTheDocument();
		});
	});

	it("auto-advances to flag-playlists after sync completion", async () => {
		mockGetExtensionStatus.mockResolvedValue({
			hasToken: true,
			tokenExpiresAtMs: null,
			sync: createSyncState({
				status: "done",
				phase: "idle",
				likedSongs: { fetched: 500, total: 500 },
				playlists: { fetched: 10, total: 10 },
				playlistTracks: { fetched: 1_000, total: 1_000 },
				artistImages: { fetched: 240, total: 240 },
			}),
		});

		render(<SyncingStep phaseJobIds={null} />);

		await waitFor(() => {
			expect(screen.getByText(/Complete!/i)).toBeInTheDocument();
		});

		await waitFor(
			() => {
				expect(mockGoToStep).toHaveBeenCalledWith("flag-playlists", {
					syncStats: { songs: 500, playlists: 10 },
				});
			},
			{ timeout: 3_000 },
		);
	});
});
