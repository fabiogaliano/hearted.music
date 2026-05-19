import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type CreateCheckoutSessionResponse,
	type CreatePortalSessionResponse,
	createCheckoutSession,
	createPortalSession,
} from "../billing.functions";

const { mockAuthContext, mockSignBridgeRequest, mockFetch, mockEnv } =
	vi.hoisted(() => ({
		mockAuthContext: {
			session: { accountId: "acct-checkout-1" },
			account: null,
		},
		mockSignBridgeRequest: vi.fn().mockResolvedValue({
			timestamp: "1700000000",
			signature: "abc123",
		}),
		mockFetch: Object.assign(
			vi.fn<
				(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
			>(),
			{ preconnect: vi.fn<typeof fetch.preconnect>() },
		),
		mockEnv: {
			value: {
				BILLING_ENABLED: false as boolean,
				BILLING_SERVICE_URL: undefined as string | undefined,
				BILLING_SHARED_SECRET: undefined as string | undefined,
			},
		},
	}));

vi.mock("@tanstack/react-start", () => {
	const builder = (): Record<string, unknown> => ({
		middleware: () => builder(),
		inputValidator: (validator: (data: unknown) => unknown) => {
			const b = builder();
			return {
				...b,
				handler:
					(
						fn: (args: {
							context: typeof mockAuthContext;
							data: unknown;
						}) => unknown,
					) =>
					(input?: { data?: unknown }) => {
						const validated = validator(input?.data);
						return fn({ context: mockAuthContext, data: validated });
					},
			};
		},
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

vi.mock("@/lib/domains/billing/hmac", () => ({
	signBridgeRequest: (...args: unknown[]) => mockSignBridgeRequest(...args),
}));

vi.mock("@/lib/platform/auth/auth.middleware", () => ({
	authMiddleware: {},
}));

vi.mock("@/env", () => ({
	get env() {
		return mockEnv.value;
	},
}));

// Mock out unused imports from the same file
vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({}),
}));
vi.mock("@/lib/domains/billing/queries", () => ({
	readBillingState: vi.fn(),
}));
vi.mock("@/lib/domains/billing/unlocks", () => ({
	requestSongUnlock: vi.fn(),
}));

// Replace global fetch
const originalFetch = globalThis.fetch;

beforeEach(() => {
	vi.clearAllMocks();
	mockEnv.value = {
		BILLING_ENABLED: false,
		BILLING_SERVICE_URL: undefined,
		BILLING_SHARED_SECRET: undefined,
	};
	globalThis.fetch = mockFetch;
});

afterAll(() => {
	globalThis.fetch = originalFetch;
});

const createCheckoutSessionForTest =
	createCheckoutSession as unknown as (input: {
		data: { offer: string; checkoutAttemptId: string };
	}) => Promise<CreateCheckoutSessionResponse>;
const createPortalSessionForTest =
	createPortalSession as unknown as () => Promise<CreatePortalSessionResponse>;

describe("createCheckoutSession", () => {
	it("returns billing_disabled when BILLING_ENABLED=false", async () => {
		const result = await createCheckoutSessionForTest({
			data: {
				offer: "song_pack_500",
				checkoutAttemptId: "550e8400-e29b-41d4-a716-446655440000",
			},
		});

		expect(result).toEqual({ success: false, error: "billing_disabled" });
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("returns billing_unavailable when env vars are missing", async () => {
		mockEnv.value = {
			BILLING_ENABLED: true,
			BILLING_SERVICE_URL: undefined,
			BILLING_SHARED_SECRET: undefined,
		};

		const result = await createCheckoutSessionForTest({
			data: {
				offer: "song_pack_500",
				checkoutAttemptId: "550e8400-e29b-41d4-a716-446655440000",
			},
		});

		expect(result).toEqual({ success: false, error: "billing_unavailable" });
	});

	it("sends HMAC-signed request to /checkout/pack for song_pack_500", async () => {
		mockEnv.value = {
			BILLING_ENABLED: true,
			BILLING_SERVICE_URL: "https://billing.example.com",
			BILLING_SHARED_SECRET: "test-secret",
		};

		mockFetch.mockResolvedValue(
			new Response(
				JSON.stringify({
					checkout_url: "https://checkout.stripe.com/c/pay/cs_test_123",
				}),
				{
					status: 200,
				},
			),
		);

		const result = await createCheckoutSessionForTest({
			data: {
				offer: "song_pack_500",
				checkoutAttemptId: "550e8400-e29b-41d4-a716-446655440000",
			},
		});

		expect(result).toEqual({
			success: true,
			checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_123",
		});

		expect(mockSignBridgeRequest).toHaveBeenCalledWith(
			expect.any(String),
			"test-secret",
		);

		expect(mockFetch).toHaveBeenCalledWith(
			"https://billing.example.com/api/checkout/pack",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					"X-Timestamp": "1700000000",
					"X-Signature": "abc123",
				}),
			}),
		);

		// Verify the body contains expected fields
		const requestInit = mockFetch.mock.calls.at(0)?.[1];
		if (typeof requestInit?.body !== "string") {
			throw new Error("Expected checkout request body to be a string");
		}
		const callBody = JSON.parse(requestInit.body);
		expect(callBody).toEqual({
			account_id: "acct-checkout-1",
			offer_id: "song_pack_500",
			checkout_attempt_id: "550e8400-e29b-41d4-a716-446655440000",
		});
	});

	it("sends request to /checkout/unlimited for unlimited_yearly", async () => {
		mockEnv.value = {
			BILLING_ENABLED: true,
			BILLING_SERVICE_URL: "https://billing.example.com",
			BILLING_SHARED_SECRET: "test-secret",
		};

		mockFetch.mockResolvedValue(
			new Response(
				JSON.stringify({
					checkout_url: "https://checkout.stripe.com/c/sub/cs_test_456",
				}),
				{
					status: 200,
				},
			),
		);

		const result = await createCheckoutSessionForTest({
			data: {
				offer: "unlimited_yearly",
				checkoutAttemptId: "550e8400-e29b-41d4-a716-446655440000",
			},
		});

		expect(result).toEqual({
			success: true,
			checkoutUrl: "https://checkout.stripe.com/c/sub/cs_test_456",
		});

		expect(mockFetch).toHaveBeenCalledWith(
			"https://billing.example.com/api/checkout/unlimited",
			expect.anything(),
		);
	});

	it("returns billing_unavailable on non-ok response without leaking body", async () => {
		mockEnv.value = {
			BILLING_ENABLED: true,
			BILLING_SERVICE_URL: "https://billing.example.com",
			BILLING_SHARED_SECRET: "test-secret",
		};

		mockFetch.mockResolvedValue(
			new Response("Internal Server Error: secret_token_xyz", { status: 500 }),
		);

		const result = await createCheckoutSessionForTest({
			data: {
				offer: "song_pack_500",
				checkoutAttemptId: "550e8400-e29b-41d4-a716-446655440000",
			},
		});

		expect(result).toEqual({ success: false, error: "billing_unavailable" });
		expect(JSON.stringify(result)).not.toContain("secret_token_xyz");
		expect(JSON.stringify(result)).not.toContain("500");
	});

	it("returns rate_limited on 429 response", async () => {
		mockEnv.value = {
			BILLING_ENABLED: true,
			BILLING_SERVICE_URL: "https://billing.example.com",
			BILLING_SHARED_SECRET: "test-secret",
		};

		mockFetch.mockResolvedValue(
			new Response("Too Many Requests", { status: 429 }),
		);

		const result = await createCheckoutSessionForTest({
			data: {
				offer: "song_pack_500",
				checkoutAttemptId: "550e8400-e29b-41d4-a716-446655440000",
			},
		});

		expect(result).toEqual({ success: false, error: "rate_limited" });
	});

	it("returns billing_unavailable on network failure without leaking error text", async () => {
		mockEnv.value = {
			BILLING_ENABLED: true,
			BILLING_SERVICE_URL: "https://billing.example.com",
			BILLING_SHARED_SECRET: "test-secret",
		};

		mockFetch.mockRejectedValue(new Error("Connection refused"));

		const result = await createCheckoutSessionForTest({
			data: {
				offer: "song_pack_500",
				checkoutAttemptId: "550e8400-e29b-41d4-a716-446655440000",
			},
		});

		expect(result).toEqual({ success: false, error: "billing_unavailable" });
		expect(JSON.stringify(result)).not.toContain("Connection refused");
	});

	it("returns invalid_billing_redirect when checkout_url is not on checkout.stripe.com", async () => {
		mockEnv.value = {
			BILLING_ENABLED: true,
			BILLING_SERVICE_URL: "https://billing.example.com",
			BILLING_SHARED_SECRET: "test-secret",
		};

		mockFetch.mockResolvedValue(
			new Response(
				JSON.stringify({ checkout_url: "https://stripe.com/pay/123" }),
				{ status: 200 },
			),
		);

		const result = await createCheckoutSessionForTest({
			data: {
				offer: "song_pack_500",
				checkoutAttemptId: "550e8400-e29b-41d4-a716-446655440000",
			},
		});

		expect(result).toEqual({
			success: false,
			error: "invalid_billing_redirect",
		});
	});

	it("returns invalid_billing_redirect when checkout_url uses http instead of https", async () => {
		mockEnv.value = {
			BILLING_ENABLED: true,
			BILLING_SERVICE_URL: "https://billing.example.com",
			BILLING_SHARED_SECRET: "test-secret",
		};

		mockFetch.mockResolvedValue(
			new Response(
				JSON.stringify({
					checkout_url: "http://checkout.stripe.com/c/pay/cs_test_123",
				}),
				{ status: 200 },
			),
		);

		const result = await createCheckoutSessionForTest({
			data: {
				offer: "song_pack_500",
				checkoutAttemptId: "550e8400-e29b-41d4-a716-446655440000",
			},
		});

		expect(result).toEqual({
			success: false,
			error: "invalid_billing_redirect",
		});
	});

	it("rejects invalid offer IDs via schema validation", async () => {
		mockEnv.value = {
			BILLING_ENABLED: true,
			BILLING_SERVICE_URL: "https://billing.example.com",
			BILLING_SHARED_SECRET: "test-secret",
		};

		let threw = false;
		try {
			await createCheckoutSessionForTest({
				data: {
					offer: "invalid_offer",
					checkoutAttemptId: "550e8400-e29b-41d4-a716-446655440000",
				},
			});
		} catch {
			threw = true;
		}

		expect(threw).toBe(true);
		expect(mockFetch).not.toHaveBeenCalled();
	});
});

describe("createPortalSession", () => {
	it("returns billing_disabled when BILLING_ENABLED=false", async () => {
		const result = await createPortalSessionForTest();

		expect(result).toEqual({ success: false, error: "billing_disabled" });
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("sends HMAC-signed request to /portal/session", async () => {
		mockEnv.value = {
			BILLING_ENABLED: true,
			BILLING_SERVICE_URL: "https://billing.example.com",
			BILLING_SHARED_SECRET: "test-secret",
		};

		mockFetch.mockResolvedValue(
			new Response(
				JSON.stringify({ portal_url: "https://billing.stripe.com/portal/abc" }),
				{ status: 200 },
			),
		);

		const result = await createPortalSessionForTest();

		expect(result).toEqual({
			success: true,
			portalUrl: "https://billing.stripe.com/portal/abc",
		});

		expect(mockSignBridgeRequest).toHaveBeenCalledWith(
			expect.any(String),
			"test-secret",
		);

		expect(mockFetch).toHaveBeenCalledWith(
			"https://billing.example.com/api/portal/session",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					"X-Timestamp": "1700000000",
					"X-Signature": "abc123",
				}),
			}),
		);

		const requestInit = mockFetch.mock.calls.at(0)?.[1];
		if (typeof requestInit?.body !== "string") {
			throw new Error("Expected portal request body to be a string");
		}
		const callBody = JSON.parse(requestInit.body);
		expect(callBody).toEqual({
			account_id: "acct-checkout-1",
		});
	});

	it("returns billing_unavailable on non-ok response without leaking body", async () => {
		mockEnv.value = {
			BILLING_ENABLED: true,
			BILLING_SERVICE_URL: "https://billing.example.com",
			BILLING_SHARED_SECRET: "test-secret",
		};

		mockFetch.mockResolvedValue(
			new Response("Forbidden: secret_token_xyz", { status: 403 }),
		);

		const result = await createPortalSessionForTest();

		expect(result).toEqual({ success: false, error: "billing_unavailable" });
		expect(JSON.stringify(result)).not.toContain("secret_token_xyz");
	});

	it("returns rate_limited on 429 response", async () => {
		mockEnv.value = {
			BILLING_ENABLED: true,
			BILLING_SERVICE_URL: "https://billing.example.com",
			BILLING_SHARED_SECRET: "test-secret",
		};

		mockFetch.mockResolvedValue(
			new Response("Too Many Requests", { status: 429 }),
		);

		const result = await createPortalSessionForTest();

		expect(result).toEqual({ success: false, error: "rate_limited" });
	});

	it("returns invalid_billing_redirect when portal_url is not on billing.stripe.com", async () => {
		mockEnv.value = {
			BILLING_ENABLED: true,
			BILLING_SERVICE_URL: "https://billing.example.com",
			BILLING_SHARED_SECRET: "test-secret",
		};

		mockFetch.mockResolvedValue(
			new Response(
				JSON.stringify({
					portal_url: "https://checkout.stripe.com/portal/abc",
				}),
				{ status: 200 },
			),
		);

		const result = await createPortalSessionForTest();

		expect(result).toEqual({
			success: false,
			error: "invalid_billing_redirect",
		});
	});
});
