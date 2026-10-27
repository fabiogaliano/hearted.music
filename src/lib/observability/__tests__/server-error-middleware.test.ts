import { redirect } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportAndThrow } from "@/lib/server/unwrap-or-throw";
import { serverFnErrorMiddleware } from "../server-error-middleware";

const { mockCaptureException } = vi.hoisted(() => ({
	mockCaptureException: vi.fn(),
}));

// Mocked at the Sentry edge, not captureServerError, so the real "already
// captured" bookkeeping between the boundary and the middleware is exercised.
vi.mock("@sentry/core", () => ({
	captureException: mockCaptureException,
}));

type ServerFn = (args: {
	next: () => Promise<unknown>;
	serverFnMeta: { id: string; name: string; filename: string };
}) => Promise<unknown>;

const runServer = serverFnErrorMiddleware.options.server as unknown as ServerFn;
const serverFnMeta = {
	id: "abc",
	name: "getBillingState",
	filename: "src/lib/server/billing.functions.ts",
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("serverFnErrorMiddleware", () => {
	it("captures an error nobody captured, and still rethrows it to the caller", async () => {
		const failure = new Error("db down");

		await expect(
			runServer({ next: () => Promise.reject(failure), serverFnMeta }),
		).rejects.toBe(failure);
		expect(mockCaptureException).toHaveBeenCalledTimes(1);
		expect(mockCaptureException).toHaveBeenCalledWith(
			failure,
			expect.objectContaining({
				tags: expect.objectContaining({ operation: "getBillingState" }),
			}),
		);
	});

	it("does not capture again an error the server fn captured at its boundary", async () => {
		const dbFailure = new Error("lock timeout");

		await expect(
			runServer({
				next: async () =>
					reportAndThrow(dbFailure, {
						area: "billing",
						operation: "get_billing_state",
						accountId: "account-1",
					}),
				serverFnMeta,
			}),
		).rejects.toThrow(/get_billing_state failed/);
		expect(mockCaptureException).toHaveBeenCalledTimes(1);
		expect(mockCaptureException).toHaveBeenCalledWith(
			dbFailure,
			expect.objectContaining({
				tags: expect.objectContaining({ operation: "get_billing_state" }),
			}),
		);
	});

	it("does not report a redirect", async () => {
		const thrown = redirect({ to: "/" });

		await expect(
			runServer({ next: () => Promise.reject(thrown), serverFnMeta }),
		).rejects.toBe(thrown);
		expect(mockCaptureException).not.toHaveBeenCalled();
	});
});
