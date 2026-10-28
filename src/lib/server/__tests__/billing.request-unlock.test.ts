import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/shared/errors/database";
import { requestSongUnlock } from "../billing.functions";

const { mockAuthContext, mockOrchestrateUnlock, mockCaptureServerError } =
	vi.hoisted(() => ({
		mockAuthContext: {
			session: { accountId: "acct-unlock-1" },
			account: null,
		},
		mockOrchestrateUnlock: vi.fn(),
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

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({}),
}));

vi.mock("@/lib/domains/billing/unlocks", () => ({
	requestSongUnlock: (...args: unknown[]) => mockOrchestrateUnlock(...args),
}));

vi.mock("@/lib/observability/capture-server-error", () => ({
	captureServerError: (...args: unknown[]) => mockCaptureServerError(...args),
}));

const requestSongUnlockForTest = requestSongUnlock as unknown as (input: {
	data: { songIds: string[] };
}) => Promise<unknown>;

describe("requestSongUnlock", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("regression: a db_error is reported to Sentry, not only mapped to internal_error", async () => {
		const dbError = new DatabaseError({
			code: "55P03",
			message: "lock timeout",
		});
		mockOrchestrateUnlock.mockResolvedValue(
			Result.err({ kind: "db_error", cause: dbError }),
		);

		const response = await requestSongUnlockForTest({
			data: { songIds: ["550e8400-e29b-41d4-a716-446655440000"] },
		});

		expect(response).toEqual({ success: false, error: "internal_error" });
		expect(mockCaptureServerError).toHaveBeenCalledTimes(1);
		// Identity check, not deep equality: a TaggedError is iterable for
		// Result.gen, and the equality matcher walking it panics.
		const [captured, context] = mockCaptureServerError.mock.calls[0];
		expect(captured).toBe(dbError);
		expect(context).toMatchObject({
			area: "billing",
			accountId: "acct-unlock-1",
		});
	});

	it("does not report expected outcomes such as an insufficient balance", async () => {
		mockOrchestrateUnlock.mockResolvedValue(
			Result.err({ kind: "insufficient_balance", required: 3, available: 1 }),
		);

		await requestSongUnlockForTest({
			data: { songIds: ["550e8400-e29b-41d4-a716-446655440000"] },
		});

		expect(mockCaptureServerError).not.toHaveBeenCalled();
	});
});
