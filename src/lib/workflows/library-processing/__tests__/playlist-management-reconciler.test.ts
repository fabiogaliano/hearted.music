import { describe, expect, it } from "vitest";
import { reconcileLibraryProcessing } from "../reconciler";
import type { LibraryProcessingState, LibraryProcessingChange } from "../types";

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
			targetMetadataChanged: false,
		});

		expect(state.matchSnapshotRefresh.requestedAt).toBe("2026-03-28T12:00:00Z");
		expect(effects).toHaveLength(1);
		expect(effects[0].kind).toBe("ensure_match_snapshot_refresh_job");
	});

	it("advances matchSnapshotRefresh when target metadata changed", () => {
		const { state, effects } = reconcile(makeState(), {
			kind: "playlist_management_session_flushed",
			accountId: "acct-1",
			targetMembershipChanged: false,
			targetMetadataChanged: true,
		});

		expect(state.matchSnapshotRefresh.requestedAt).toBe("2026-03-28T12:00:00Z");
		expect(effects).toHaveLength(1);
		expect(effects[0].kind).toBe("ensure_match_snapshot_refresh_job");
	});

	it("does not advance when neither membership nor metadata changed", () => {
		const { state, effects } = reconcile(makeState(), {
			kind: "playlist_management_session_flushed",
			accountId: "acct-1",
			targetMembershipChanged: false,
			targetMetadataChanged: false,
		});

		expect(state.matchSnapshotRefresh.requestedAt).toBeNull();
		expect(effects).toHaveLength(0);
	});

	it("does not affect enrichment workflow", () => {
		const { state } = reconcile(makeState(), {
			kind: "playlist_management_session_flushed",
			accountId: "acct-1",
			targetMembershipChanged: true,
			targetMetadataChanged: true,
		});

		expect(state.enrichment.requestedAt).toBeNull();
	});

	it("collapses membership and metadata into a single refresh", () => {
		const { effects } = reconcile(makeState(), {
			kind: "playlist_management_session_flushed",
			accountId: "acct-1",
			targetMembershipChanged: true,
			targetMetadataChanged: true,
		});

		expect(effects).toHaveLength(1);
		expect(effects[0].kind).toBe("ensure_match_snapshot_refresh_job");
	});
});
