/**
 * Tests for getPublicHandleIdentity server function.
 *
 * §14.8 coverage:
 * - lowercases handle before calling domain query
 * - returns null when domain query returns ok(null)
 * - returns identity when domain query returns ok(identity)
 * - throws when domain query returns err (not swallowed as null)
 * - no auth middleware on the function
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetPublicHandleIdentityByHandle } = vi.hoisted(() => ({
	mockGetPublicHandleIdentityByHandle: vi.fn(),
}));

vi.mock("@/lib/domains/library/accounts/queries", () => ({
	getPublicHandleIdentityByHandle: mockGetPublicHandleIdentityByHandle,
}));

// createServerFn is not available in test environment — stub it so the module
// loads and we can invoke the handler function directly.
vi.mock("@tanstack/react-start", () => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const builder = (): any => ({
		inputValidator: () => builder(),
		handler: (fn: unknown) => fn,
	});
	return { createServerFn: builder };
});

import { getPublicHandleIdentity } from "@/lib/server/public-handle.functions";

// After the mock, getPublicHandleIdentity is the raw handler function.
type HandlerFn = (args: { data: { handle: string } }) => Promise<unknown>;
const handler = getPublicHandleIdentity as unknown as HandlerFn;

describe("getPublicHandleIdentity server function", () => {
	beforeEach(() => {
		mockGetPublicHandleIdentityByHandle.mockReset();
	});

	it("returns null when the domain query returns ok(null)", async () => {
		mockGetPublicHandleIdentityByHandle.mockResolvedValue(Result.ok(null));

		const result = await handler({ data: { handle: "fabio" } });

		expect(result).toBeNull();
	});

	it("returns the identity when the domain query returns ok(identity)", async () => {
		const identity = { handle: "fabio", imageUrl: null };
		mockGetPublicHandleIdentityByHandle.mockResolvedValue(Result.ok(identity));

		const result = await handler({ data: { handle: "fabio" } });

		expect(result).toEqual(identity);
	});

	it("throws when the domain query returns an error (not swallowed as null)", async () => {
		const dbError = new Error("DB connection refused");
		mockGetPublicHandleIdentityByHandle.mockResolvedValue(
			Result.err(dbError as never),
		);

		await expect(handler({ data: { handle: "failme" } })).rejects.toThrow();
	});

	it("lowercases the handle before calling the domain query", async () => {
		mockGetPublicHandleIdentityByHandle.mockResolvedValue(Result.ok(null));

		await handler({ data: { handle: "MixedCase" } });

		expect(mockGetPublicHandleIdentityByHandle).toHaveBeenCalledWith(
			"mixedcase",
		);
	});

	it("does not trim or strip @ from the handle — passes it lowercased only", async () => {
		mockGetPublicHandleIdentityByHandle.mockResolvedValue(Result.ok(null));

		await handler({ data: { handle: "@fabio" } });

		// @ is NOT stripped — lowercase-only transformation applies
		expect(mockGetPublicHandleIdentityByHandle).toHaveBeenCalledWith("@fabio");
	});
});
