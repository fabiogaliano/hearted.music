import { describe, expect, it } from "vitest";
import { reconcileLibraryProcessing } from "../reconciler";
import type { LibraryProcessingState } from "../types";

function makeState(
	overrides: Partial<LibraryProcessingState> = {},
): LibraryProcessingState {
	return {
		accountId: "acct-1",
		enrichment: { requestedAt: null, settledAt: null, activeJobId: null },
		matchSnapshotRefresh: {
			requestedAt: null,
			settledAt: null,
			activeJobId: null,
		},
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

describe("reconcileLibraryProcessing — match_snapshot_superseded", () => {
	it("clears activeJobId when the superseded job matches the active job", () => {
		const state = makeState({
			matchSnapshotRefresh: {
				requestedAt: "2026-06-25T10:00:00Z",
				settledAt: null,
				activeJobId: "job-2",
			},
		});

		const { state: next } = reconcileLibraryProcessing({
			state,
			change: {
				kind: "match_snapshot_superseded",
				accountId: "acct-1",
				jobId: "job-2",
			},
			requestMarker: "2026-06-25T11:00:00Z",
			hasTargetPlaylists: true,
			satisfiedMarker: null,
		});

		expect(next.matchSnapshotRefresh.activeJobId).toBeNull();
	});

	it("does not change activeJobId when jobId does not match the active job", () => {
		const state = makeState({
			matchSnapshotRefresh: {
				requestedAt: "2026-06-25T10:00:00Z",
				settledAt: null,
				activeJobId: "job-other",
			},
		});

		const { state: next } = reconcileLibraryProcessing({
			state,
			change: {
				kind: "match_snapshot_superseded",
				accountId: "acct-1",
				jobId: "job-2",
			},
			requestMarker: "2026-06-25T11:00:00Z",
			hasTargetPlaylists: true,
			satisfiedMarker: null,
		});

		expect(next.matchSnapshotRefresh.activeJobId).toBe("job-other");
	});

	it("does not advance settledAt — the newer request still needs processing", () => {
		const state = makeState({
			matchSnapshotRefresh: {
				requestedAt: "2026-06-25T10:00:00Z",
				settledAt: null,
				activeJobId: "job-2",
			},
		});

		const { state: next } = reconcileLibraryProcessing({
			state,
			change: {
				kind: "match_snapshot_superseded",
				accountId: "acct-1",
				jobId: "job-2",
			},
			requestMarker: "2026-06-25T11:00:00Z",
			hasTargetPlaylists: true,
			satisfiedMarker: null,
		});

		expect(next.matchSnapshotRefresh.settledAt).toBeNull();
	});

	it("emits ensure_match_snapshot_refresh_job when workflow is still stale after clearing", () => {
		// requestedAt newer than settledAt = stale; no active job after clearing => re-ensure
		const state = makeState({
			matchSnapshotRefresh: {
				requestedAt: "2026-06-25T10:00:00Z",
				settledAt: null,
				activeJobId: "job-2",
			},
		});

		const { effects } = reconcileLibraryProcessing({
			state,
			change: {
				kind: "match_snapshot_superseded",
				accountId: "acct-1",
				jobId: "job-2",
			},
			requestMarker: "2026-06-25T11:00:00Z",
			hasTargetPlaylists: true,
			satisfiedMarker: null,
		});

		const refreshEffect = effects.find(
			(e) => e.kind === "ensure_match_snapshot_refresh_job",
		);
		expect(refreshEffect).toBeDefined();
		expect(refreshEffect?.kind).toBe("ensure_match_snapshot_refresh_job");
	});

	it("does not emit ensure_match_snapshot_refresh_job when workflow is already settled", () => {
		// settledAt >= requestedAt = not stale
		const state = makeState({
			matchSnapshotRefresh: {
				requestedAt: "2026-06-25T09:00:00Z",
				settledAt: "2026-06-25T09:30:00Z",
				activeJobId: "job-2",
			},
		});

		const { effects } = reconcileLibraryProcessing({
			state,
			change: {
				kind: "match_snapshot_superseded",
				accountId: "acct-1",
				jobId: "job-2",
			},
			requestMarker: "2026-06-25T11:00:00Z",
			hasTargetPlaylists: true,
			satisfiedMarker: null,
		});

		const refreshEffect = effects.find(
			(e) => e.kind === "ensure_match_snapshot_refresh_job",
		);
		expect(refreshEffect).toBeUndefined();
	});
});
