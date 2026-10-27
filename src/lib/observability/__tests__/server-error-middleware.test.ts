import { redirect } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { serverFnErrorMiddleware } from "../server-error-middleware";

const { mockCaptureServerError } = vi.hoisted(() => ({
	mockCaptureServerError: vi.fn(),
}));

vi.mock("@/lib/observability/capture-server-error", () => ({
	captureServerError: mockCaptureServerError,
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
	it("reports a failing server fn and still rethrows it to the caller", async () => {
		const failure = new Error("db down");

		await expect(
			runServer({ next: () => Promise.reject(failure), serverFnMeta }),
		).rejects.toBe(failure);
		expect(mockCaptureServerError).toHaveBeenCalledWith(
			failure,
			expect.objectContaining({ operation: "getBillingState" }),
		);
	});

	it("does not report a redirect", async () => {
		const thrown = redirect({ to: "/" });

		await expect(
			runServer({ next: () => Promise.reject(thrown), serverFnMeta }),
		).rejects.toBe(thrown);
		expect(mockCaptureServerError).not.toHaveBeenCalled();
	});
});
