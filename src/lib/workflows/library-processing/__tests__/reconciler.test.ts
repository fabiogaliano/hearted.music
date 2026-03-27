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
	opts: { hasTargetPlaylists?: boolean; requestMarker?: string } = {},
) {
	return reconcileLibraryProcessing({
		state,
		change,
		requestMarker: opts.requestMarker ?? "2026-03-27T12:00:00Z",
		hasTargetPlaylists: opts.hasTargetPlaylists ?? true,
	});
}

describe("reconcileLibraryProcessing", () => {
	describe("onboarding_target_selection_confirmed", () => {
		it("advances both workflows", () => {
			const { state, effects } = reconcile(makeState(), {
				kind: "onboarding_target_selection_confirmed",
				accountId: "acct-1",
			});

			expect(state.enrichment.requestedAt).toBe("2026-03-27T12:00:00Z");
			expect(state.matchSnapshotRefresh.requestedAt).toBe(
				"2026-03-27T12:00:00Z",
			);
			expect(effects).toHaveLength(2);
			expect(effects[0].kind).toBe("ensure_enrichment_job");
			expect(effects[1].kind).toBe("ensure_match_snapshot_refresh_job");
		});
	});

	describe("library_synced", () => {
		it("liked songs added with targets: advances both workflows", () => {
			const { state, effects } = reconcile(makeState(), {
				kind: "library_synced",
				accountId: "acct-1",
				changes: {
					likedSongs: { added: true, removed: false },
					targetPlaylists: {
						trackMembershipChanged: false,
						profileTextChanged: false,
						removed: false,
					},
				},
			});

			expect(state.enrichment.requestedAt).toBe("2026-03-27T12:00:00Z");
			expect(state.matchSnapshotRefresh.requestedAt).toBe(
				"2026-03-27T12:00:00Z",
			);
			expect(effects).toHaveLength(2);
		});

		it("liked songs added without targets: advances enrichment only", () => {
			const { state, effects } = reconcile(
				makeState(),
				{
					kind: "library_synced",
					accountId: "acct-1",
					changes: {
						likedSongs: { added: true, removed: false },
						targetPlaylists: {
							trackMembershipChanged: false,
							profileTextChanged: false,
							removed: false,
						},
					},
				},
				{ hasTargetPlaylists: false },
			);

			expect(state.enrichment.requestedAt).toBe("2026-03-27T12:00:00Z");
			expect(state.matchSnapshotRefresh.requestedAt).toBeNull();
			expect(effects).toHaveLength(1);
			expect(effects[0].kind).toBe("ensure_enrichment_job");
		});

		it("liked songs removed: advances refresh only", () => {
			const { state, effects } = reconcile(makeState(), {
				kind: "library_synced",
				accountId: "acct-1",
				changes: {
					likedSongs: { added: false, removed: true },
					targetPlaylists: {
						trackMembershipChanged: false,
						profileTextChanged: false,
						removed: false,
					},
				},
			});

			expect(state.enrichment.requestedAt).toBeNull();
			expect(state.matchSnapshotRefresh.requestedAt).toBe(
				"2026-03-27T12:00:00Z",
			);
			expect(effects).toHaveLength(1);
			expect(effects[0].kind).toBe("ensure_match_snapshot_refresh_job");
		});

		it("target track membership changed: advances refresh", () => {
			const { state } = reconcile(makeState(), {
				kind: "library_synced",
				accountId: "acct-1",
				changes: {
					likedSongs: { added: false, removed: false },
					targetPlaylists: {
						trackMembershipChanged: true,
						profileTextChanged: false,
						removed: false,
					},
				},
			});

			expect(state.matchSnapshotRefresh.requestedAt).toBe(
				"2026-03-27T12:00:00Z",
			);
		});

		it("all-false sync: no effects", () => {
			const { state, effects } = reconcile(makeState(), {
				kind: "library_synced",
				accountId: "acct-1",
				changes: {
					likedSongs: { added: false, removed: false },
					targetPlaylists: {
						trackMembershipChanged: false,
						profileTextChanged: false,
						removed: false,
					},
				},
			});

			expect(state.enrichment.requestedAt).toBeNull();
			expect(state.matchSnapshotRefresh.requestedAt).toBeNull();
			expect(effects).toHaveLength(0);
		});
	});

	describe("enrichment_completed", () => {
		it("requestSatisfied settles and clears activeJobId", () => {
			const { state } = reconcile(
				makeState({
					enrichment: {
						requestedAt: "2026-03-27T10:00:00Z",
						settledAt: null,
						activeJobId: "job-1",
					},
				}),
				{
					kind: "enrichment_completed",
					accountId: "acct-1",
					jobId: "job-1",
					requestSatisfied: true,
					newCandidatesAvailable: false,
				},
			);

			expect(state.enrichment.settledAt).toBe("2026-03-27T10:00:00Z");
			expect(state.enrichment.activeJobId).toBeNull();
		});

		it("newCandidatesAvailable with targets: advances refresh", () => {
			const { state, effects } = reconcile(
				makeState({
					enrichment: {
						requestedAt: "2026-03-27T10:00:00Z",
						settledAt: null,
						activeJobId: "job-1",
					},
				}),
				{
					kind: "enrichment_completed",
					accountId: "acct-1",
					jobId: "job-1",
					requestSatisfied: false,
					newCandidatesAvailable: true,
				},
			);

			expect(state.matchSnapshotRefresh.requestedAt).toBe(
				"2026-03-27T12:00:00Z",
			);
			const refreshEffect = effects.find(
				(e) => e.kind === "ensure_match_snapshot_refresh_job",
			);
			expect(refreshEffect).toBeDefined();
		});

		it("newCandidatesAvailable without targets: no refresh", () => {
			const { state } = reconcile(
				makeState({
					enrichment: {
						requestedAt: "2026-03-27T10:00:00Z",
						settledAt: null,
						activeJobId: "job-1",
					},
				}),
				{
					kind: "enrichment_completed",
					accountId: "acct-1",
					jobId: "job-1",
					requestSatisfied: false,
					newCandidatesAvailable: true,
				},
				{ hasTargetPlaylists: false },
			);

			expect(state.matchSnapshotRefresh.requestedAt).toBeNull();
		});
	});

	describe("enrichment_stopped", () => {
		it("clears activeJobId, does not advance settledAt", () => {
			const { state, effects } = reconcile(
				makeState({
					enrichment: {
						requestedAt: "2026-03-27T10:00:00Z",
						settledAt: null,
						activeJobId: "job-1",
					},
				}),
				{
					kind: "enrichment_stopped",
					accountId: "acct-1",
					jobId: "job-1",
					reason: "error",
				},
			);

			expect(state.enrichment.settledAt).toBeNull();
			expect(state.enrichment.activeJobId).toBeNull();
			// Workflow is still stale but no auto-reensure in v1
			expect(effects).toHaveLength(0);
		});
	});

	describe("match_snapshot_published", () => {
		it("settles and clears activeJobId", () => {
			const { state } = reconcile(
				makeState({
					matchSnapshotRefresh: {
						requestedAt: "2026-03-27T10:00:00Z",
						settledAt: null,
						activeJobId: "job-2",
					},
				}),
				{
					kind: "match_snapshot_published",
					accountId: "acct-1",
					jobId: "job-2",
				},
			);

			expect(state.matchSnapshotRefresh.settledAt).toBe("2026-03-27T10:00:00Z");
			expect(state.matchSnapshotRefresh.activeJobId).toBeNull();
		});
	});

	describe("match_snapshot_failed", () => {
		it("clears activeJobId, does not advance settledAt", () => {
			const { state, effects } = reconcile(
				makeState({
					matchSnapshotRefresh: {
						requestedAt: "2026-03-27T10:00:00Z",
						settledAt: null,
						activeJobId: "job-2",
					},
				}),
				{
					kind: "match_snapshot_failed",
					accountId: "acct-1",
					jobId: "job-2",
				},
			);

			expect(state.matchSnapshotRefresh.settledAt).toBeNull();
			expect(state.matchSnapshotRefresh.activeJobId).toBeNull();
			expect(effects).toHaveLength(0);
		});
	});

	describe("staleness and effect generation", () => {
		it("does not ensure job when active job already exists", () => {
			const { effects } = reconcile(
				makeState({
					enrichment: {
						requestedAt: "2026-03-27T10:00:00Z",
						settledAt: null,
						activeJobId: "existing-job",
					},
				}),
				{
					kind: "library_synced",
					accountId: "acct-1",
					changes: {
						likedSongs: { added: true, removed: false },
						targetPlaylists: {
							trackMembershipChanged: false,
							profileTextChanged: false,
							removed: false,
						},
					},
				},
			);

			const enrichmentEffects = effects.filter(
				(e) => e.kind === "ensure_enrichment_job",
			);
			expect(enrichmentEffects).toHaveLength(0);
		});

		it("settled workflow is not stale", () => {
			const { effects } = reconcile(
				makeState({
					enrichment: {
						requestedAt: "2026-03-27T10:00:00Z",
						settledAt: "2026-03-27T10:00:00Z",
						activeJobId: null,
					},
				}),
				{
					kind: "library_synced",
					accountId: "acct-1",
					changes: {
						likedSongs: { added: false, removed: false },
						targetPlaylists: {
							trackMembershipChanged: false,
							profileTextChanged: false,
							removed: false,
						},
					},
				},
			);

			expect(effects).toHaveLength(0);
		});
	});
});
