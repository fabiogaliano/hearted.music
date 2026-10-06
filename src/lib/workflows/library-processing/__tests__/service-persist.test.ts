import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryProcessingState } from "../types";

const getOrCreateStateMock = vi.fn();
const persistStateMock = vi.fn();
const swapActiveJobRefMock = vi.fn();

vi.mock("../queries", () => ({
	getOrCreateLibraryProcessingState: (...args: unknown[]) =>
		getOrCreateStateMock(...args),
	persistLibraryProcessingState: (...args: unknown[]) =>
		persistStateMock(...args),
	swapActiveJobRef: (...args: unknown[]) => swapActiveJobRefMock(...args),
}));

const executeEffectMock = vi.fn();

vi.mock("../scheduler", () => ({
	createReadinessAccessor: () => async () => true,
	describeTrigger: () => "test",
	executeEffect: (...args: unknown[]) => executeEffectMock(...args),
	loadJobOutcomeMetadata: async () => ({
		satisfiedMarker: null,
		batchSequence: null,
	}),
}));

vi.mock("@/lib/domains/library/playlists/queries", () => ({
	getTargetPlaylists: async () => Result.ok([{ id: "playlist-1" }]),
}));

vi.mock("@/lib/observability/account-label", () => ({
	resolveAccountLabel: async () => "acct",
}));

import { MaintenanceChanges } from "../changes";
import { applyLibraryProcessingChange } from "../service";

function makeState(
	updatedAt: string,
	enrichmentActiveJobId: string | null = null,
): LibraryProcessingState {
	return {
		accountId: "acct-1",
		enrichment: {
			requestedAt: null,
			settledAt: null,
			activeJobId: enrichmentActiveJobId,
		},
		matchSnapshotRefresh: {
			requestedAt: null,
			settledAt: null,
			activeJobId: null,
		},
		createdAt: "2026-10-01T00:00:00.000000+00:00",
		updatedAt,
	};
}

describe("applyLibraryProcessingChange persistence", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		swapActiveJobRefMock.mockResolvedValue(Result.ok(true));
		executeEffectMock.mockImplementation(
			async (_effect: unknown, state: LibraryProcessingState) =>
				Result.ok({
					state: {
						...state,
						enrichment: { ...state.enrichment, activeJobId: "job-new" },
					},
					jobId: "job-new",
				}),
		);
	});

	it("regression: a lost compare-and-set reconciles again from the fresh row instead of writing the stale one", async () => {
		const stale = makeState("2026-10-06T10:00:00.000001+00:00");
		const fresh = makeState("2026-10-06T10:00:00.000002+00:00");
		getOrCreateStateMock
			.mockResolvedValueOnce(Result.ok(stale))
			.mockResolvedValueOnce(Result.ok(fresh));
		persistStateMock
			.mockResolvedValueOnce(Result.ok(null))
			.mockImplementationOnce(async (state: LibraryProcessingState) =>
				Result.ok(state),
			);

		const result = await applyLibraryProcessingChange(
			MaintenanceChanges.enrichmentWorkAvailable("acct-1"),
		);

		expect(result).toBeOk();
		expect(persistStateMock).toHaveBeenCalledTimes(2);
		expect(persistStateMock.mock.calls[1][0].updatedAt).toBe(fresh.updatedAt);
	});

	it("gives up with persist_conflict when every attempt loses", async () => {
		getOrCreateStateMock.mockResolvedValue(
			Result.ok(makeState("2026-10-06T10:00:00.000001+00:00")),
		);
		persistStateMock.mockResolvedValue(Result.ok(null));

		const result = await applyLibraryProcessingChange(
			MaintenanceChanges.enrichmentWorkAvailable("acct-1"),
		);

		expect(result).toHaveErrValue({ kind: "persist_conflict" });
		expect(executeEffectMock).not.toHaveBeenCalled();
	});

	it("writes an effect's new active ref as a per-field swap from the persisted baseline", async () => {
		const state = makeState("2026-10-06T10:00:00.000001+00:00");
		getOrCreateStateMock.mockResolvedValue(Result.ok(state));
		persistStateMock.mockImplementation(async (s: LibraryProcessingState) =>
			Result.ok(s),
		);

		await applyLibraryProcessingChange(
			MaintenanceChanges.enrichmentWorkAvailable("acct-1"),
		);

		// The full-row write happens once; the effect's ref goes through the swap.
		expect(persistStateMock).toHaveBeenCalledTimes(1);
		expect(swapActiveJobRefMock).toHaveBeenCalledWith(
			"acct-1",
			"enrichment",
			null,
			"job-new",
		);
	});
});
