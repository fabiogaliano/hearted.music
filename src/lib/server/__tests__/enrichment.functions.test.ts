import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuthContext, mockHasPhase1Work, mockApplyLibraryProcessingChange } =
	vi.hoisted(() => ({
		mockAuthContext: { session: { accountId: "acct-test" } },
		mockHasPhase1Work: vi.fn(),
		mockApplyLibraryProcessingChange: vi.fn(),
	}));

vi.mock("@tanstack/react-start", () => {
	const builder = (): Record<string, unknown> => ({
		middleware: () => builder(),
		inputValidator: () => builder(),
		handler:
			(fn: (args: { context: typeof mockAuthContext }) => unknown) => () =>
				fn({ context: mockAuthContext }),
	});
	return {
		createServerFn: builder,
		createMiddleware: () => ({
			server: () => ({}),
			type: () => ({ server: () => ({}) }),
		}),
	};
});

vi.mock("@/lib/platform/auth/auth.middleware", () => ({
	authMiddleware: {},
}));

vi.mock("@/lib/observability/logger", () => ({
	log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock("@/lib/workflows/enrichment-pipeline/phase1-backfill", () => ({
	hasPhase1SongsNeedingEnrichment: (...args: unknown[]) =>
		mockHasPhase1Work(...args),
}));

vi.mock("@/lib/workflows/library-processing/service", () => ({
	applyLibraryProcessingChange: (...args: unknown[]) =>
		mockApplyLibraryProcessingChange(...args),
}));

import { requestLibraryPhase1Enrichment } from "../enrichment.functions";

function makeApplyOutcome(overrides: {
	effectResults?: Array<{ kind: string; status: string; jobId: string }>;
}) {
	return Result.ok({
		accountId: "acct-test",
		changeKind: "enrichment_work_available" as const,
		state: {
			accountId: "acct-test",
			enrichment: {
				requestedAt: "2026-01-01T00:00:00Z",
				settledAt: null,
				activeJobId: "job-1",
			},
			matchSnapshotRefresh: {
				requestedAt: null,
				settledAt: null,
				activeJobId: null,
			},
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-01T00:00:00Z",
		},
		effects: [],
		effectResults: overrides.effectResults ?? [],
	});
}

describe("requestLibraryPhase1Enrichment", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns nothing_to_do when no Phase-1 work is pending", async () => {
		mockHasPhase1Work.mockResolvedValue(false);

		const result = await requestLibraryPhase1Enrichment();

		expect(result).toEqual({ status: "nothing_to_do" });
		expect(mockApplyLibraryProcessingChange).not.toHaveBeenCalled();
	});

	it("returns scheduled with jobId when a new enrichment job is enqueued", async () => {
		mockHasPhase1Work.mockResolvedValue(true);
		mockApplyLibraryProcessingChange.mockResolvedValue(
			makeApplyOutcome({
				effectResults: [
					{
						kind: "ensure_enrichment_job",
						status: "ensured",
						jobId: "job-new",
					},
				],
			}),
		);

		const result = await requestLibraryPhase1Enrichment();

		expect(result).toEqual({ status: "scheduled", jobId: "job-new" });
	});

	it("returns already_running when reconciler enqueues no new job", async () => {
		// Reconciler returned no effects — enrichment job already active
		mockHasPhase1Work.mockResolvedValue(true);
		mockApplyLibraryProcessingChange.mockResolvedValue(
			makeApplyOutcome({ effectResults: [] }),
		);

		const result = await requestLibraryPhase1Enrichment();

		expect(result).toEqual({ status: "already_running" });
	});

	it("returns error when apply fails", async () => {
		mockHasPhase1Work.mockResolvedValue(true);
		mockApplyLibraryProcessingChange.mockResolvedValue(
			Result.err({ kind: "load_state", cause: { message: "db down" } }),
		);

		const result = await requestLibraryPhase1Enrichment();

		expect(result).toMatchObject({ status: "error" });
	});

	it("passes enrichment_work_available change for the current account", async () => {
		mockHasPhase1Work.mockResolvedValue(true);
		mockApplyLibraryProcessingChange.mockResolvedValue(
			makeApplyOutcome({ effectResults: [] }),
		);

		await requestLibraryPhase1Enrichment();

		expect(mockApplyLibraryProcessingChange).toHaveBeenCalledWith({
			kind: "enrichment_work_available",
			accountId: "acct-test",
		});
	});

	it("uses the authenticated accountId — not a hardcoded value", async () => {
		// Override the mock context to verify the server function reads from auth
		mockAuthContext.session.accountId = "acct-different";
		mockHasPhase1Work.mockResolvedValue(false);

		await requestLibraryPhase1Enrichment();

		expect(mockHasPhase1Work).toHaveBeenCalledWith("acct-different");
		// Restore
		mockAuthContext.session.accountId = "acct-test";
	});
});
