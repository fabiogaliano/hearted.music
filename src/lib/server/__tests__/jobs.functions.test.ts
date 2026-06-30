import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/shared/errors/database";
import { getActiveJobs } from "../jobs.functions";

const {
	mockAuthContext,
	mockLoadLibraryProcessingState,
	mockGetJobById,
	mockHasFirstVisibleReviewSubject,
} = vi.hoisted(() => ({
	mockAuthContext: {
		session: { accountId: "acct-1" },
		account: null,
	},
	mockLoadLibraryProcessingState: vi.fn(),
	mockGetJobById: vi.fn(),
	mockHasFirstVisibleReviewSubject: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => {
	const builder = (): Record<string, unknown> => ({
		middleware: () => builder(),
		inputValidator: () => builder(),
		handler:
			(
				fn: (args: {
					context: typeof mockAuthContext;
					data: unknown;
				}) => unknown,
			) =>
			(input?: { data?: unknown }) =>
				fn({ context: mockAuthContext, data: input?.data }),
	});
	return {
		createServerFn: builder,
		createMiddleware: () => ({
			server: () => ({}),
			type: () => ({ server: () => ({}) }),
		}),
	};
});

vi.mock("@/lib/workflows/library-processing/queries", () => ({
	loadLibraryProcessingState: (...args: unknown[]) =>
		mockLoadLibraryProcessingState(...args),
}));

vi.mock("@/lib/platform/jobs/repository", async () => {
	const actual = await vi.importActual<
		typeof import("@/lib/platform/jobs/repository")
	>("@/lib/platform/jobs/repository");

	return {
		...actual,
		getJobById: (...args: unknown[]) => mockGetJobById(...args),
	};
});

vi.mock("@/lib/domains/taste/match-review-queue/service", () => ({
	hasFirstVisibleReviewSubject: (...args: unknown[]) =>
		mockHasFirstVisibleReviewSubject(...args),
}));

describe("jobs.functions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLoadLibraryProcessingState.mockResolvedValue(Result.ok(null));
		mockGetJobById.mockResolvedValue(Result.ok(null));
	});

	it("reports firstMatchReady=false and firstVisibleMatchReady=false when no visible review subject exists", async () => {
		mockHasFirstVisibleReviewSubject.mockResolvedValue(Result.ok(false));

		const result = await getActiveJobs();

		expect(result.firstMatchReady).toBe(false);
		expect(result.firstVisibleMatchReady).toBe(false);
		// matchSnapshotRefresh is null and targetPlaylistMatchRefresh is absent when
		// getJobById returns null (no jobs running) — guards against silent regressions
		// where a missing job surfaces as undefined instead of being omitted/nulled.
		expect(result.matchSnapshotRefresh).toBeNull();
		expect("targetPlaylistMatchRefresh" in result).toBe(false);
	});

	it("reports firstMatchReady=true and firstVisibleMatchReady=true when a visible review subject exists", async () => {
		mockHasFirstVisibleReviewSubject.mockResolvedValue(Result.ok(true));

		const result = await getActiveJobs();

		expect(result.firstMatchReady).toBe(true);
		expect(result.firstVisibleMatchReady).toBe(true);
	});

	it("degrades firstMatchReady and firstVisibleMatchReady to false when the helper returns a DB error", async () => {
		// Transient errors must not surface as a thrown exception — graceful false.
		mockHasFirstVisibleReviewSubject.mockResolvedValue(
			Result.err(new DatabaseError({ code: "08006", message: "conn lost" })),
		);

		const result = await getActiveJobs();

		expect(result.firstMatchReady).toBe(false);
		expect(result.firstVisibleMatchReady).toBe(false);
	});

	it("firstMatchReady always mirrors firstVisibleMatchReady (backward-compat alias)", async () => {
		mockHasFirstVisibleReviewSubject.mockResolvedValue(Result.ok(true));

		const result = await getActiveJobs();

		expect(result.firstMatchReady).toBe(result.firstVisibleMatchReady);
	});
});
