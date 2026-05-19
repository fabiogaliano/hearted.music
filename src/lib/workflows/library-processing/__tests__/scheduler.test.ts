import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/shared/errors/database";

const ensureEnrichmentJobMock = vi.fn();
const ensureMatchSnapshotRefreshJobMock = vi.fn();
const getJobByIdMock = vi.fn();

vi.mock("@/lib/platform/jobs/library-processing-queue", () => ({
	ensureEnrichmentJob: (...args: unknown[]) => ensureEnrichmentJobMock(...args),
	ensureMatchSnapshotRefreshJob: (...args: unknown[]) =>
		ensureMatchSnapshotRefreshJobMock(...args),
}));

vi.mock("@/lib/platform/jobs/repository", () => ({
	getJobById: (...args: unknown[]) => getJobByIdMock(...args),
}));

const readBillingStateMock = vi.fn();

vi.mock("@/lib/domains/billing/queries", () => ({
	readBillingState: (...args: unknown[]) => readBillingStateMock(...args),
}));

const getLikedSongCountMock = vi.fn();

vi.mock("@/lib/domains/library/liked-songs/queries", () => ({
	getCount: (...args: unknown[]) => getLikedSongCountMock(...args),
}));

const getTargetPlaylistsMock = vi.fn();
const getPlaylistSongsMock = vi.fn();

vi.mock("@/lib/domains/library/playlists/queries", () => ({
	getTargetPlaylists: (...args: unknown[]) => getTargetPlaylistsMock(...args),
	getPlaylistSongs: (...args: unknown[]) => getPlaylistSongsMock(...args),
}));

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({
		from: () => ({
			select: () => ({
				eq: () => ({
					is: () => ({
						in: () => ({ data: [], error: null }),
					}),
				}),
			}),
		}),
	}),
}));

import {
	deriveNeedsTargetSongEnrichment,
	executeEffect,
	loadJobOutcomeMetadata,
} from "../scheduler";
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
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("scheduler", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		readBillingStateMock.mockResolvedValue(
			Result.ok({
				plan: "free",
				creditBalance: 0,
				subscriptionStatus: "none",
				cancelAtPeriodEnd: false,
				subscriptionPeriodEnd: null,
				unlimitedAccess: { kind: "none" },
				queueBand: "standard",
			}),
		);
		getLikedSongCountMock.mockResolvedValue(Result.ok(100));
		getTargetPlaylistsMock.mockResolvedValue(Result.ok([]));
		getPlaylistSongsMock.mockResolvedValue(Result.ok([]));
	});

	describe("executeEffect - ensure_enrichment_job", () => {
		it("ensures enrichment job and returns updated state with jobId", async () => {
			ensureEnrichmentJobMock.mockResolvedValue(
				Result.ok({ id: "new-job-1", status: "pending" }),
			);

			const state = makeState();
			const result = await executeEffect(
				{
					kind: "ensure_enrichment_job",
					accountId: "acct-1",
					satisfiesRequestedAt: "2026-05-01T00:00:00Z",
				},
				state,
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
				{ satisfiedMarker: null, batchSequence: null },
			);

			expect(Result.isOk(result)).toBe(true);
			if (Result.isOk(result)) {
				expect(result.value.jobId).toBe("new-job-1");
				expect(result.value.state.enrichment.activeJobId).toBe("new-job-1");
			}

			expect(ensureEnrichmentJobMock).toHaveBeenCalledWith(
				expect.objectContaining({
					accountId: "acct-1",
					satisfiesRequestedAt: "2026-05-01T00:00:00Z",
					queuePriority: 50,
				}),
			);
		});

		it("advances batch sequence when change is enrichment_completed", async () => {
			ensureEnrichmentJobMock.mockResolvedValue(
				Result.ok({ id: "new-job-2", status: "pending" }),
			);

			const state = makeState();
			await executeEffect(
				{
					kind: "ensure_enrichment_job",
					accountId: "acct-1",
					satisfiesRequestedAt: "2026-05-01T00:00:00Z",
				},
				state,
				{
					kind: "enrichment_completed",
					accountId: "acct-1",
					jobId: "old-job",
					requestSatisfied: false,
					newCandidatesAvailable: true,
				},
				{ satisfiedMarker: null, batchSequence: 2 },
			);

			const calledProgress = ensureEnrichmentJobMock.mock.calls[0][0].progress;
			expect(calledProgress.batchSequence).toBe(3);
		});

		it("returns typed apply error when ensureEnrichmentJob fails", async () => {
			const dbError = new DatabaseError({
				code: "PGRST",
				message: "connection refused",
			});
			ensureEnrichmentJobMock.mockResolvedValue(Result.err(dbError));

			const state = makeState();
			const result = await executeEffect(
				{
					kind: "ensure_enrichment_job",
					accountId: "acct-1",
					satisfiesRequestedAt: "2026-05-01T00:00:00Z",
				},
				state,
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
				{ satisfiedMarker: null, batchSequence: null },
			);

			expect(Result.isError(result)).toBe(true);
			if (Result.isError(result)) {
				expect(result.error.kind).toBe("effect_ensure_failed");
				if (result.error.kind === "effect_ensure_failed") {
					expect(result.error.effectKind).toBe("ensure_enrichment_job");
					expect(result.error.cause).toBe(dbError);
				}
			}
			expect(state.enrichment.activeJobId).toBeNull();
		});
	});

	describe("executeEffect - ensure_match_snapshot_refresh_job", () => {
		it("ensures match snapshot refresh job and returns updated state", async () => {
			ensureMatchSnapshotRefreshJobMock.mockResolvedValue(
				Result.ok({ id: "refresh-job-1", status: "pending" }),
			);

			const state = makeState();
			const result = await executeEffect(
				{
					kind: "ensure_match_snapshot_refresh_job",
					accountId: "acct-1",
					satisfiesRequestedAt: "2026-05-01T00:00:00Z",
				},
				state,
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
				{ satisfiedMarker: null, batchSequence: null },
			);

			expect(Result.isOk(result)).toBe(true);
			if (Result.isOk(result)) {
				expect(result.value.jobId).toBe("refresh-job-1");
				expect(result.value.state.matchSnapshotRefresh.activeJobId).toBe(
					"refresh-job-1",
				);
			}
		});

		it("returns typed apply error when ensureMatchSnapshotRefreshJob fails", async () => {
			const dbError = new DatabaseError({
				code: "PGRST",
				message: "timeout",
			});
			ensureMatchSnapshotRefreshJobMock.mockResolvedValue(Result.err(dbError));

			const state = makeState();
			const result = await executeEffect(
				{
					kind: "ensure_match_snapshot_refresh_job",
					accountId: "acct-1",
					satisfiesRequestedAt: "2026-05-01T00:00:00Z",
				},
				state,
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
				{ satisfiedMarker: null, batchSequence: null },
			);

			expect(Result.isError(result)).toBe(true);
			if (Result.isError(result)) {
				expect(result.error.kind).toBe("effect_ensure_failed");
				if (result.error.kind === "effect_ensure_failed") {
					expect(result.error.effectKind).toBe(
						"ensure_match_snapshot_refresh_job",
					);
					expect(result.error.cause).toBe(dbError);
				}
			}
			expect(state.matchSnapshotRefresh.activeJobId).toBeNull();
		});

		it("passes needsTargetSongEnrichment when target playlists have unmatched songs", async () => {
			getTargetPlaylistsMock.mockResolvedValue(
				Result.ok([{ id: "playlist-1" }]),
			);
			getPlaylistSongsMock.mockResolvedValue(
				Result.ok([{ song_id: "song-a" }, { song_id: "song-b" }]),
			);

			ensureMatchSnapshotRefreshJobMock.mockResolvedValue(
				Result.ok({ id: "refresh-job-2", status: "pending" }),
			);

			const state = makeState();
			await executeEffect(
				{
					kind: "ensure_match_snapshot_refresh_job",
					accountId: "acct-1",
					satisfiesRequestedAt: "2026-05-01T00:00:00Z",
				},
				state,
				{ kind: "onboarding_target_selection_confirmed", accountId: "acct-1" },
				{ satisfiedMarker: null, batchSequence: null },
			);

			expect(ensureMatchSnapshotRefreshJobMock).toHaveBeenCalledWith(
				expect.objectContaining({
					needsTargetSongEnrichment: true,
				}),
			);
		});
	});

	describe("billing priority fallback", () => {
		it("falls back to free/low priority when billing read fails", async () => {
			readBillingStateMock.mockResolvedValue(
				Result.err(
					new DatabaseError({ code: "PGRST", message: "billing read failed" }),
				),
			);
			ensureEnrichmentJobMock.mockResolvedValue(
				Result.ok({ id: "job-fallback", status: "pending" }),
			);

			const state = makeState();
			await executeEffect(
				{
					kind: "ensure_enrichment_job",
					accountId: "acct-1",
					satisfiesRequestedAt: "2026-05-01T00:00:00Z",
				},
				state,
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
				{ satisfiedMarker: null, batchSequence: null },
			);

			expect(ensureEnrichmentJobMock).toHaveBeenCalledWith(
				expect.objectContaining({ queuePriority: 0 }),
			);
		});

		it("uses priority band for onboarding_target_selection_confirmed regardless of billing", async () => {
			readBillingStateMock.mockResolvedValue(
				Result.ok({
					plan: "free",
					creditBalance: 0,
					subscriptionStatus: "none",
					cancelAtPeriodEnd: false,
					subscriptionPeriodEnd: null,
					unlimitedAccess: { kind: "none" },
					queueBand: "low",
				}),
			);
			ensureEnrichmentJobMock.mockResolvedValue(
				Result.ok({ id: "job-onboard", status: "pending" }),
			);

			const state = makeState();
			await executeEffect(
				{
					kind: "ensure_enrichment_job",
					accountId: "acct-1",
					satisfiesRequestedAt: "2026-05-01T00:00:00Z",
				},
				state,
				{ kind: "onboarding_target_selection_confirmed", accountId: "acct-1" },
				{ satisfiedMarker: null, batchSequence: null },
			);

			expect(ensureEnrichmentJobMock).toHaveBeenCalledWith(
				expect.objectContaining({ queuePriority: 100 }),
			);
		});
	});

	describe("deriveNeedsTargetSongEnrichment", () => {
		it("returns false for changes that cannot need target song enrichment", async () => {
			const result = await deriveNeedsTargetSongEnrichment("acct-1", {
				kind: "enrichment_completed",
				accountId: "acct-1",
				jobId: "job-1",
				requestSatisfied: true,
				newCandidatesAvailable: false,
			});
			expect(result).toBe(false);
		});

		it("returns true when target playlists have songs not in liked library", async () => {
			getTargetPlaylistsMock.mockResolvedValue(
				Result.ok([{ id: "playlist-1" }]),
			);
			getPlaylistSongsMock.mockResolvedValue(
				Result.ok([{ song_id: "song-a" }, { song_id: "song-b" }]),
			);

			const result = await deriveNeedsTargetSongEnrichment("acct-1", {
				kind: "onboarding_target_selection_confirmed",
				accountId: "acct-1",
			});

			expect(result).toBe(true);
		});

		it("returns false when no target playlists exist", async () => {
			getTargetPlaylistsMock.mockResolvedValue(Result.ok([]));

			const result = await deriveNeedsTargetSongEnrichment("acct-1", {
				kind: "onboarding_target_selection_confirmed",
				accountId: "acct-1",
			});

			expect(result).toBe(false);
		});

		it("returns true for library_synced with trackMembershipChanged", async () => {
			getTargetPlaylistsMock.mockResolvedValue(
				Result.ok([{ id: "playlist-1" }]),
			);
			getPlaylistSongsMock.mockResolvedValue(
				Result.ok([{ song_id: "song-x" }]),
			);

			const result = await deriveNeedsTargetSongEnrichment("acct-1", {
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

			expect(result).toBe(true);
		});
	});

	describe("loadJobOutcomeMetadata", () => {
		it("returns null metadata for non-outcome changes", async () => {
			const result = await loadJobOutcomeMetadata({
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
			expect(result).toEqual({ satisfiedMarker: null, batchSequence: null });
			expect(getJobByIdMock).not.toHaveBeenCalled();
		});

		it("reads satisfiedMarker from job for match_snapshot_published", async () => {
			getJobByIdMock.mockResolvedValue(
				Result.ok({
					id: "job-99",
					satisfies_requested_at: "2026-04-01T00:00:00Z",
					progress: null,
				}),
			);

			const result = await loadJobOutcomeMetadata({
				kind: "match_snapshot_published",
				accountId: "acct-1",
				jobId: "job-99",
			});

			expect(result.satisfiedMarker).toBe("2026-04-01T00:00:00Z");
			expect(result.batchSequence).toBeNull();
		});

		it("reads batchSequence from enrichment_completed job progress", async () => {
			getJobByIdMock.mockResolvedValue(
				Result.ok({
					id: "job-50",
					satisfies_requested_at: "2026-03-15T00:00:00Z",
					progress: {
						batchSequence: 3,
						batchSize: 25,
						total: 100,
						processed: 25,
						succeeded: 20,
						failed: 5,
					},
				}),
			);

			const result = await loadJobOutcomeMetadata({
				kind: "enrichment_completed",
				accountId: "acct-1",
				jobId: "job-50",
				requestSatisfied: true,
				newCandidatesAvailable: false,
			});

			expect(result.satisfiedMarker).toBe("2026-03-15T00:00:00Z");
			expect(result.batchSequence).toBe(3);
		});

		it("returns null metadata when job lookup fails", async () => {
			getJobByIdMock.mockResolvedValue(
				Result.err(new DatabaseError({ code: "PGRST", message: "not found" })),
			);

			const result = await loadJobOutcomeMetadata({
				kind: "enrichment_completed",
				accountId: "acct-1",
				jobId: "job-gone",
				requestSatisfied: true,
				newCandidatesAvailable: false,
			});

			expect(result).toEqual({ satisfiedMarker: null, batchSequence: null });
		});
	});
});
