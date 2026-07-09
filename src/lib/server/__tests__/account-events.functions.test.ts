import { describe, expect, it, vi } from "vitest";
import type { EventTokenClaims } from "@/lib/account-events/contract";
import { signEventToken, verifyEventToken } from "@/lib/account-events/token";
import { getAccountEventsToken } from "../account-events.functions";

const SECRET = "a-very-long-and-secure-test-secret-32-chars!!";

const { mockWithinRateLimit, mockAuthContext } = vi.hoisted(() => ({
	mockWithinRateLimit: vi.fn(),
	mockAuthContext: {
		session: { accountId: "acc-123", id: "sess-456", createdAt: new Date(1) },
	},
}));

vi.mock("@tanstack/react-start", () => {
	const builder = (): Record<string, unknown> => ({
		middleware: () => builder(),
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

vi.mock("@/lib/platform/rate-limit/edge-rate-limit", () => ({
	withinRateLimit: (...args: unknown[]) => mockWithinRateLimit(...args),
}));

describe("account-events token helper", () => {
	it("round-trips valid claims", async () => {
		const claims: EventTokenClaims = {
			sub: "acc-123",
			sid: "sess-456",
			ver: 1,
			iat: Math.floor(Date.now() / 1000),
			exp: Math.floor(Date.now() / 1000) + 300,
			jti: "test-jti",
		};

		const token = await signEventToken(claims, SECRET);
		const verified = await verifyEventToken(token, SECRET);

		expect(verified).toEqual(claims);
	});

	it("rejects expired tokens", async () => {
		const claims: EventTokenClaims = {
			sub: "acc-123",
			sid: "sess-456",
			ver: 1,
			iat: Math.floor(Date.now() / 1000) - 600,
			exp: Math.floor(Date.now() / 1000) - 300, // expired 5 mins ago
			jti: "test-jti",
		};

		const token = await signEventToken(claims, SECRET);
		const verified = await verifyEventToken(token, SECRET);

		expect(verified).toBeNull();
	});

	it("rejects invalid signature", async () => {
		const claims: EventTokenClaims = {
			sub: "acc-123",
			sid: "sess-456",
			ver: 1,
			iat: Math.floor(Date.now() / 1000),
			exp: Math.floor(Date.now() / 1000) + 300,
			jti: "test-jti",
		};

		const token = await signEventToken(claims, SECRET);
		const verified = await verifyEventToken(
			token,
			"wrong-secret-which-is-also-32-chars-long!",
		);

		expect(verified).toBeNull();
	});
});

import { env } from "@/env";

describe("getAccountEventsToken", () => {
	it("returns a token when rate limit allows", async () => {
		mockWithinRateLimit.mockResolvedValue(true);

		const result = (await getAccountEventsToken()) as { token: string };
		expect(result).toHaveProperty("token");

		const verified = await verifyEventToken(
			result.token,
			env.ACCOUNT_EVENTS_TOKEN_SECRET,
		);
		expect(verified).not.toBeNull();
		expect(verified?.sub).toBe("acc-123");
		expect(verified?.sid).toBe("sess-456");
		expect(verified?.ver).toBe(mockAuthContext.session.createdAt.getTime());
	});

	it("throws when rate limited", async () => {
		mockWithinRateLimit.mockResolvedValue(false);

		await expect(getAccountEventsToken()).rejects.toThrow(
			"Rate limit exceeded",
		);
	});
});
