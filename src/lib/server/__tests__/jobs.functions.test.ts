import { beforeEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";
import type { Job } from "@/lib/data/jobs";

const mockAuthContext = {
	session: { accountId: "acct-1" },
	account: null,
};

const mockLoadLibraryProcessingState = vi.fn();
const mockGetJobById = vi.fn();
const mockMatchContextMaybeSingle = vi.fn();
const mockMatchResultMaybeSingle = vi.fn();

vi.mock("@tanstack/react-start", () => {
	const builder = (): Record<string, unknown> => ({
		middleware: () => builder(),
		inputValidator: () => builder(),
		handler: (fn: Function) => (input?: { data?: unknown }) =>
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

vi.mock("@/lib/data/jobs", async () => {
	const actual =
		await vi.importActual<typeof import("@/lib/data/jobs")>("@/lib/data/jobs");

	return {
		...actual,
		getJobById: (...args: unknown[]) => mockGetJobById(...args),
	};
});

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({
		from: (table: string) => {
			if (table === "match_context") {
				return {
					select: () => ({
						eq: () => ({
							order: () => ({
								limit: () => ({
									maybeSingle: mockMatchContextMaybeSingle,
								}),
							}),
						}),
					}),
				};
			}

			return {
				select: () => ({
					eq: () => ({
						limit: () => ({
							maybeSingle: mockMatchResultMaybeSingle,
						}),
					}),
				}),
			};
		},
	}),
}));

const { getActiveJobs, getLibraryProcessingJobProgress } = await import(
	"../jobs.functions"
);

function makeJob(overrides: Partial<Job> = {}): Job {
	return {
		id: "job-1",
		account_id: "acct-1",
		type: "enrichment",
		status: "running",
		progress: {},
		error: null,
		attempts: 1,
		max_attempts: 3,
		created_at: "2026-03-26T00:00:00Z",
		updated_at: "2026-03-26T00:00:00Z",
		started_at: "2026-03-26T00:00:00Z",
		completed_at: null,
		heartbeat_at: "2026-03-26T00:00:00Z",
		queue_priority: 0,
		satisfies_requested_at: null,
		...overrides,
	};
}

describe("jobs.functions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLoadLibraryProcessingState.mockResolvedValue(Result.ok(null));
		mockGetJobById.mockResolvedValue(Result.ok(null));
	});

	it("reports firstMatchReady=false when the latest snapshot has no matches", async () => {
		mockMatchContextMaybeSingle.mockResolvedValue({
			data: { id: "ctx-1" },
			error: null,
		});
		mockMatchResultMaybeSingle.mockResolvedValue({ data: null, error: null });

		const result = await getActiveJobs();

		expect(result.matchSnapshotRefresh).toBeNull();
		expect("targetPlaylistMatchRefresh" in result).toBe(false);
		expect(result.firstMatchReady).toBe(false);
	});

	it("reports firstMatchReady=true when the latest snapshot has at least one match", async () => {
		mockMatchContextMaybeSingle.mockResolvedValue({
			data: { id: "ctx-2" },
			error: null,
		});
		mockMatchResultMaybeSingle.mockResolvedValue({
			data: { id: "match-1" },
			error: null,
		});

		const result = await getActiveJobs();

		expect(result.firstMatchReady).toBe(true);
	});

	it("returns typed enrichment progress for the authenticated account", async () => {
		mockGetJobById.mockResolvedValue(
			Result.ok(
				makeJob({
					progress: {
						total: 20,
						done: 10,
						succeeded: 8,
						failed: 2,
						currentStage: "song_analysis",
						batchSize: 5,
						batchSequence: 1,
					},
				}),
			),
		);

		const result = await getLibraryProcessingJobProgress({
			data: { jobId: "job-1" },
		});

		expect(result?.type).toBe("enrichment");
		if (result?.type === "enrichment") {
			expect(result.progress.currentStage).toBe("song_analysis");
			expect(result.progress.batchSequence).toBe(1);
		}
	});

	it("returns null for library-processing jobs owned by another account", async () => {
		mockGetJobById.mockResolvedValue(
			Result.ok(makeJob({ account_id: "acct-2" })),
		);

		const result = await getLibraryProcessingJobProgress({
			data: { jobId: "job-1" },
		});

		expect(result).toBeNull();
	});
});
