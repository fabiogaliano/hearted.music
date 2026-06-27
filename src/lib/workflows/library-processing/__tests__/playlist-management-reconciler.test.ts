import { describe, expect, it } from "vitest";
import { reconcileLibraryProcessing } from "../reconciler";
import type { LibraryProcessingChange, LibraryProcessingState } from "../types";

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

function reconcile(
	state: LibraryProcessingState,
	change: LibraryProcessingChange,
	opts: {
		hasTargetPlaylists?: boolean;
		requestMarker?: string;
		satisfiedMarker?: string | null;
	} = {},
) {
	return reconcileLibraryProcessing({
		state,
		change,
		requestMarker: opts.requestMarker ?? "2026-03-28T12:00:00Z",
		hasTargetPlaylists: opts.hasTargetPlaylists ?? true,
		satisfiedMarker: opts.satisfiedMarker ?? null,
	});
}

describe("playlist_management_session_flushed", () => {
	it("advances matchSnapshotRefresh when membership changed", () => {
		const { state, effects } = reconcile(makeState(), {
			kind: "playlist_management_session_flushed",
			accountId: "acct-1",
			targetMembershipChanged: true,
			scoringConfigChanged: false,
			readTimeFilterChanged: false,
		});

		expect(state.matchSnapshotRefresh.requestedAt).toBe("2026-03-28T12:00:00Z");
		expect(effects).toHaveLength(1);
		expect(effects[0].kind).toBe("ensure_match_snapshot_refresh_job");
	});

	it("advances matchSnapshotRefresh when scoring config changed (intent/genre pills)", () => {
		const { state, effects } = reconcile(makeState(), {
			kind: "playlist_management_session_flushed",
			accountId: "acct-1",
			targetMembershipChanged: false,
			scoringConfigChanged: true,
			readTimeFilterChanged: false,
		});

		expect(state.matchSnapshotRefresh.requestedAt).toBe("2026-03-28T12:00:00Z");
		expect(effects).toHaveLength(1);
		expect(effects[0].kind).toBe("ensure_match_snapshot_refresh_job");
	});

	it("collapses membership and scoring into a single refresh", () => {
		const { effects } = reconcile(makeState(), {
			kind: "playlist_management_session_flushed",
			accountId: "acct-1",
			targetMembershipChanged: true,
			scoringConfigChanged: true,
			readTimeFilterChanged: false,
		});

		expect(effects).toHaveLength(1);
		expect(effects[0].kind).toBe("ensure_match_snapshot_refresh_job");
	});

	it("does not advance matchSnapshotRefresh when only read-time filters changed", () => {
		const { state, effects } = reconcile(makeState(), {
			kind: "playlist_management_session_flushed",
			accountId: "acct-1",
			targetMembershipChanged: false,
			scoringConfigChanged: false,
			readTimeFilterChanged: true,
		});

		// Read-time filter changes sync sessions at read time — no snapshot
		// recompute is needed, so matchSnapshotRefresh must not be advanced.
		expect(state.matchSnapshotRefresh.requestedAt).toBeNull();
		expect(effects).toHaveLength(0);
	});

	it("still enqueues refresh when scoring and filter both changed (mixed save)", () => {
		const { state, effects } = reconcile(makeState(), {
			kind: "playlist_management_session_flushed",
			accountId: "acct-1",
			targetMembershipChanged: false,
			scoringConfigChanged: true,
			readTimeFilterChanged: true,
		});

		// Mixed save: scoring change dominates — full refresh subsumes the sync.
		expect(state.matchSnapshotRefresh.requestedAt).toBe("2026-03-28T12:00:00Z");
		expect(effects).toHaveLength(1);
		expect(effects[0].kind).toBe("ensure_match_snapshot_refresh_job");
	});

	it("still enqueues refresh when membership and filter both changed", () => {
		const { state, effects } = reconcile(makeState(), {
			kind: "playlist_management_session_flushed",
			accountId: "acct-1",
			targetMembershipChanged: true,
			scoringConfigChanged: false,
			readTimeFilterChanged: true,
		});

		expect(state.matchSnapshotRefresh.requestedAt).toBe("2026-03-28T12:00:00Z");
		expect(effects).toHaveLength(1);
		expect(effects[0].kind).toBe("ensure_match_snapshot_refresh_job");
	});

	it("does not advance when nothing changed", () => {
		const { state, effects } = reconcile(makeState(), {
			kind: "playlist_management_session_flushed",
			accountId: "acct-1",
			targetMembershipChanged: false,
			scoringConfigChanged: false,
			readTimeFilterChanged: false,
		});

		expect(state.matchSnapshotRefresh.requestedAt).toBeNull();
		expect(effects).toHaveLength(0);
	});

	it("does not affect enrichment workflow", () => {
		const { state } = reconcile(makeState(), {
			kind: "playlist_management_session_flushed",
			accountId: "acct-1",
			targetMembershipChanged: true,
			scoringConfigChanged: true,
			readTimeFilterChanged: false,
		});

		expect(state.enrichment.requestedAt).toBeNull();
	});
});
