import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/shared/errors/database";
import { getLikedSongsPage } from "../liked-songs.functions";

const { mockAuthContext, mockGetPageWithDetails, mockCaptureServerError } =
	vi.hoisted(() => ({
		mockAuthContext: {
			session: { accountId: "acct-1" },
			account: null,
		},
		mockGetPageWithDetails: vi.fn(),
		mockCaptureServerError: vi.fn(),
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

vi.mock("@/lib/platform/auth/auth.middleware", () => ({
	authMiddleware: {},
}));

vi.mock("@/lib/domains/library/accounts/preferences-queries", () => ({
	resolveMinMatchScore: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/domains/library/liked-songs/queries", () => ({
	getPageWithDetails: (...args: unknown[]) => mockGetPageWithDetails(...args),
	getPageRowBySlug: vi.fn(),
	getBootstrapPagesBySlug: vi.fn(),
	getStats: vi.fn(),
}));

vi.mock("@/lib/observability/capture-server-error", () => ({
	captureServerError: (...args: unknown[]) => mockCaptureServerError(...args),
}));

describe("getLikedSongsPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("regression: a DB error throws and is reported instead of returning an empty library", async () => {
		const dbError = new DatabaseError({
			code: "57014",
			message: "canceling statement due to statement timeout",
		});
		mockGetPageWithDetails.mockResolvedValue(Result.err(dbError));

		await expect(
			getLikedSongsPage({ data: { filter: "all" } }),
		).rejects.toThrow();
		// Identity, not deep equality: tagged errors are iterable, which trips
		// Vitest's structural matcher.
		const [reported, context] = mockCaptureServerError.mock.calls[0];
		expect(reported).toBe(dbError);
		expect(context).toMatchObject({ accountId: "acct-1" });
	});
});
