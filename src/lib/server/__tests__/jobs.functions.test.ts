import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuthContext = {
	session: { accountId: "acct-1" },
	account: null,
};

const mockLoadLibraryProcessingState = vi.fn();
const mockGetJobById = vi.fn();
const mockMatchSnapshotMaybeSingle = vi.fn();
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
			if (table === "match_snapshot") {
				return {
					select: () => ({
						eq: () => ({
							order: () => ({
								limit: () => ({
									maybeSingle: mockMatchSnapshotMaybeSingle,
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

const { getActiveJobs } = await import("../jobs.functions");

describe("jobs.functions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLoadLibraryProcessingState.mockResolvedValue(Result.ok(null));
		mockGetJobById.mockResolvedValue(Result.ok(null));
	});

	it("reports firstMatchReady=false when the latest snapshot has no matches", async () => {
		mockMatchSnapshotMaybeSingle.mockResolvedValue({
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
		mockMatchSnapshotMaybeSingle.mockResolvedValue({
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
});
