import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@/lib/platform/jobs/repository";
import { DatabaseError } from "@/lib/shared/errors/database";
import type {
	LibraryProcessingApplyOutcome,
	LibraryProcessingState,
} from "../types";

vi.mock("../queries", async (importOriginal: <T>() => Promise<T>) => {
	const original = await importOriginal<typeof import("../queries")>();
	return {
		...original,
		findStatesWithoutEnrichmentActiveJob: vi.fn(),
	};
});

vi.mock("@/lib/platform/jobs/library-processing-queue", () => ({
	getActiveEnrichmentJob: vi.fn(),
}));

vi.mock(
	"@/lib/platform/jobs/repository",
	async (importOriginal: <T>() => Promise<T>) => {
		const original =
			await importOriginal<typeof import("@/lib/platform/jobs/repository")>();
		return {
			...original,
			getLatestJob: vi.fn(),
		};
	},
);

vi.mock("@/lib/workflows/enrichment-pipeline/batch", () => ({
	hasMoreSongsNeedingEnrichmentWork: vi.fn(),
}));

vi.mock("../service", () => ({
	applyLibraryProcessingChange: vi.fn(),
}));

import { getActiveEnrichmentJob } from "@/lib/platform/jobs/library-processing-queue";
import { getLatestJob } from "@/lib/platform/jobs/repository";
import { hasMoreSongsNeedingEnrichmentWork } from "@/lib/workflows/enrichment-pipeline/batch";
import { recoverIdleEnrichmentWorkflows } from "../idle-recovery";
import { findStatesWithoutEnrichmentActiveJob } from "../queries";
import { applyLibraryProcessingChange } from "../service";

const findStatesMock = vi.mocked(findStatesWithoutEnrichmentActiveJob);
const getActiveEnrichmentJobMock = vi.mocked(getActiveEnrichmentJob);
const getLatestJobMock = vi.mocked(getLatestJob);
const hasMoreSongsMock = vi.mocked(hasMoreSongsNeedingEnrichmentWork);
const applyMock = vi.mocked(applyLibraryProcessingChange);

function makeJob(overrides: Partial<Job> = {}): Job {
	return {
		id: overrides.id ?? "job-1",
		account_id: overrides.account_id ?? "acct-1",
		type: "enrichment",
		status: overrides.status ?? "completed",
		attempts: 1,
		max_attempts: 3,
		progress: null,
		queue_priority: null,
		error: null,
		heartbeat_at: null,
		started_at: null,
		completed_at: null,
		satisfies_requested_at: null,
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		...overrides,
	} as Job;
}

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

function makeApplyOutcome(): LibraryProcessingApplyOutcome {
	return {
		accountId: "acct-1",
		changeKind: "enrichment_work_available",
		state: makeState(),
		effects: [],
		effectResults: [],
	};
}

describe("recoverIdleEnrichmentWorkflows", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		findStatesMock.mockResolvedValue(Result.ok([]));
		getActiveEnrichmentJobMock.mockResolvedValue(Result.ok(null));
		getLatestJobMock.mockResolvedValue(Result.ok(null));
		hasMoreSongsMock.mockResolvedValue(false);
		applyMock.mockResolvedValue(Result.ok(makeApplyOutcome()));
	});

	it("returns empty when no idle states exist", async () => {
		const results = await recoverIdleEnrichmentWorkflows();
		expect(results).toEqual([]);
		expect(applyMock).not.toHaveBeenCalled();
	});

	it("recovers an idle account with current work and a non-failed latest job", async () => {
		findStatesMock.mockResolvedValue(Result.ok([makeState()]));
		getLatestJobMock.mockResolvedValue(
			Result.ok(makeJob({ status: "completed" })),
		);
		hasMoreSongsMock.mockResolvedValue(true);
		applyMock.mockResolvedValue(Result.ok(makeApplyOutcome()));

		const results = await recoverIdleEnrichmentWorkflows();

		expect(hasMoreSongsMock).toHaveBeenCalledWith("acct-1");
		expect(applyMock).toHaveBeenCalledWith({
			kind: "enrichment_work_available",
			accountId: "acct-1",
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.latestJobStatus).toBe("completed");
		expect(Result.isOk(results[0]?.outcome)).toBe(true);
	});

	it("skips accounts whose latest enrichment job failed", async () => {
		findStatesMock.mockResolvedValue(Result.ok([makeState()]));
		getLatestJobMock.mockResolvedValue(
			Result.ok(makeJob({ status: "failed" })),
		);
		hasMoreSongsMock.mockResolvedValue(true);

		const results = await recoverIdleEnrichmentWorkflows();

		expect(results).toEqual([]);
		expect(applyMock).not.toHaveBeenCalled();
	});

	it("skips accounts that still have an active job despite a null state ref", async () => {
		findStatesMock.mockResolvedValue(Result.ok([makeState()]));
		getActiveEnrichmentJobMock.mockResolvedValue(
			Result.ok(makeJob({ status: "running" })),
		);
		hasMoreSongsMock.mockResolvedValue(true);

		const results = await recoverIdleEnrichmentWorkflows();

		expect(results).toEqual([]);
		expect(hasMoreSongsMock).not.toHaveBeenCalled();
		expect(applyMock).not.toHaveBeenCalled();
	});

	it("returns empty when the state query fails", async () => {
		findStatesMock.mockResolvedValue(
			Result.err(new DatabaseError({ code: "500", message: "db down" })),
		);

		const results = await recoverIdleEnrichmentWorkflows();

		expect(results).toEqual([]);
		expect(applyMock).not.toHaveBeenCalled();
	});
});
