import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuthContext, mockApplyLibraryProcessingChange } = vi.hoisted(
	() => ({
		mockAuthContext: { session: { accountId: "acct-test" } },
		mockApplyLibraryProcessingChange: vi.fn(),
	}),
);

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
		mockAuthContext.session.accountId = "acct-test";
	});

	it("returns scheduled with jobId when a new enrichment job is enqueued", async () => {
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
		// No effects — enrichment already active or nothing stale to (re)ensure.
		mockApplyLibraryProcessingChange.mockResolvedValue(
			makeApplyOutcome({ effectResults: [] }),
		);

		const result = await requestLibraryPhase1Enrichment();

		expect(result).toEqual({ status: "already_running" });
	});

	it("returns error when apply fails", async () => {
		mockApplyLibraryProcessingChange.mockResolvedValue(
			Result.err({ kind: "load_state", cause: { message: "db down" } }),
		);

		const result = await requestLibraryPhase1Enrichment();

		expect(result).toMatchObject({ status: "error" });
	});

	it("applies the enrichment_work_available change for the current account (no probe first)", async () => {
		mockApplyLibraryProcessingChange.mockResolvedValue(
			makeApplyOutcome({ effectResults: [] }),
		);

		await requestLibraryPhase1Enrichment();

		expect(mockApplyLibraryProcessingChange).toHaveBeenCalledTimes(1);
		expect(mockApplyLibraryProcessingChange).toHaveBeenCalledWith({
			kind: "enrichment_work_available",
			accountId: "acct-test",
		});
	});

	it("uses the authenticated accountId — not a hardcoded value", async () => {
		mockAuthContext.session.accountId = "acct-different";
		mockApplyLibraryProcessingChange.mockResolvedValue(
			makeApplyOutcome({ effectResults: [] }),
		);

		await requestLibraryPhase1Enrichment();

		expect(mockApplyLibraryProcessingChange).toHaveBeenCalledWith({
			kind: "enrichment_work_available",
			accountId: "acct-different",
		});
	});
});
