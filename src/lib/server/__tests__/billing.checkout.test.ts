import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuthContext = {
	session: { accountId: "acct-checkout-1" },
	account: null,
};

// Track calls to signBridgeRequest
const mockSignBridgeRequest = vi.fn().mockResolvedValue({
	timestamp: "1700000000",
	signature: "abc123",
});

// Track global fetch
const mockFetch = vi.fn();

vi.mock("@tanstack/react-start", () => {
	const builder = (): Record<string, unknown> => ({
		middleware: () => builder(),
		inputValidator: (validator: Function) => {
			const b = builder();
			const originalHandler = b.handler as Function;
			return {
				...b,
				handler: (fn: Function) => (input?: { data?: unknown }) => {
					const validated = validator(input?.data);
					return fn({ context: mockAuthContext, data: validated });
				},
			};
		},
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

vi.mock("@/lib/domains/billing/hmac", () => ({
	signBridgeRequest: (...args: unknown[]) => mockSignBridgeRequest(...args),
}));

vi.mock("@/lib/platform/auth/auth.middleware", () => ({
	authMiddleware: {},
}));

// Default: billing disabled
let mockEnv = {
	BILLING_ENABLED: false as boolean,
	BILLING_SERVICE_URL: undefined as string | undefined,
	BILLING_SHARED_SECRET: undefined as string | undefined,
};

vi.mock("@/env", () => ({
	get env() {
		return mockEnv;
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
	mockEnv = {
		BILLING_ENABLED: false,
		BILLING_SERVICE_URL: undefined,
		BILLING_SHARED_SECRET: undefined,
	};
	globalThis.fetch = mockFetch;
});

afterAll(() => {
	globalThis.fetch = originalFetch;
});

import { afterAll } from "vitest";
import type {
	CreateCheckoutSessionResponse,
	CreatePortalSessionResponse,
} from "../billing.functions";

async function importFunctions() {
	const mod = await import("../billing.functions");
	return {
		createCheckoutSession: mod.createCheckoutSession as unknown as (input: {
			data: { offer: string; checkoutAttemptId: string };
		}) => Promise<CreateCheckoutSessionResponse>,
		createPortalSession:
			mod.createPortalSession as unknown as () => Promise<CreatePortalSessionResponse>,
	};
}

describe("createCheckoutSession", () => {
	it("returns billing_disabled when BILLING_ENABLED=false", async () => {
		const { createCheckoutSession } = await importFunctions();
		const result = await createCheckoutSession({
			data: {
				offer: "song_pack_500",
				checkoutAttemptId: "550e8400-e29b-41d4-a716-446655440000",
			},
		});

		expect(result).toEqual({ success: false, error: "billing_disabled" });
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("returns billing_service_error when env vars are missing", async () => {
		mockEnv = {
			BILLING_ENABLED: true,
			BILLING_SERVICE_URL: undefined,
			BILLING_SHARED_SECRET: undefined,
		};

		const { createCheckoutSession } = await importFunctions();
		const result = await createCheckoutSession({
			data: {
				offer: "song_pack_500",
				checkoutAttemptId: "550e8400-e29b-41d4-a716-446655440000",
			},
		});

		expect(result).toEqual({
			success: false,
			error: "billing_service_error",
			message:
				"BILLING_SERVICE_URL and BILLING_SHARED_SECRET must be set when BILLING_ENABLED=true",
		});
	});

	it("sends HMAC-signed request to /checkout/pack for song_pack_500", async () => {
		mockEnv = {
			BILLING_ENABLED: true,
			BILLING_SERVICE_URL: "https://billing.example.com",
			BILLING_SHARED_SECRET: "test-secret",
		};

		mockFetch.mockResolvedValue(
			new Response(
				JSON.stringify({ checkout_url: "https://stripe.com/pay/123" }),
				{
					status: 200,
				},
			),
		);

		const { createCheckoutSession } = await importFunctions();
		const result = await createCheckoutSession({
			data: {
				offer: "song_pack_500",
				checkoutAttemptId: "550e8400-e29b-41d4-a716-446655440000",
			},
		});

		expect(result).toEqual({
			success: true,
			checkoutUrl: "https://stripe.com/pay/123",
		});

		expect(mockSignBridgeRequest).toHaveBeenCalledWith(
			expect.any(String),
			"test-secret",
		);

		expect(mockFetch).toHaveBeenCalledWith(
			"https://billing.example.com/checkout/pack",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					"X-Timestamp": "1700000000",
					"X-Signature": "abc123",
				}),
			}),
		);

		// Verify the body contains expected fields
		const callBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
		expect(callBody).toEqual({
			account_id: "acct-checkout-1",
			offer_id: "song_pack_500",
			checkout_attempt_id: "550e8400-e29b-41d4-a716-446655440000",
		});
	});

	it("sends request to /checkout/unlimited for unlimited_yearly", async () => {
		mockEnv = {
			BILLING_ENABLED: true,
			BILLING_SERVICE_URL: "https://billing.example.com",
			BILLING_SHARED_SECRET: "test-secret",
		};

		mockFetch.mockResolvedValue(
			new Response(
				JSON.stringify({ checkout_url: "https://stripe.com/sub/456" }),
				{
					status: 200,
				},
			),
		);

		const { createCheckoutSession } = await importFunctions();
		const result = await createCheckoutSession({
			data: {
				offer: "unlimited_yearly",
				checkoutAttemptId: "550e8400-e29b-41d4-a716-446655440000",
			},
		});

		expect(result).toEqual({
			success: true,
			checkoutUrl: "https://stripe.com/sub/456",
		});

		expect(mockFetch).toHaveBeenCalledWith(
			"https://billing.example.com/checkout/unlimited",
			expect.anything(),
		);
	});

	it("returns billing_service_error on non-ok response", async () => {
		mockEnv = {
			BILLING_ENABLED: true,
			BILLING_SERVICE_URL: "https://billing.example.com",
			BILLING_SHARED_SECRET: "test-secret",
		};

		mockFetch.mockResolvedValue(
			new Response("Internal Server Error", { status: 500 }),
		);

		const { createCheckoutSession } = await importFunctions();
		const result = await createCheckoutSession({
			data: {
				offer: "song_pack_500",
				checkoutAttemptId: "550e8400-e29b-41d4-a716-446655440000",
			},
		});

		expect(result).toEqual({
			success: false,
			error: "billing_service_error",
			message: "Billing service returned 500: Internal Server Error",
		});
	});

	it("returns billing_service_error on network failure", async () => {
		mockEnv = {
			BILLING_ENABLED: true,
			BILLING_SERVICE_URL: "https://billing.example.com",
			BILLING_SHARED_SECRET: "test-secret",
		};

		mockFetch.mockRejectedValue(new Error("Connection refused"));

		const { createCheckoutSession } = await importFunctions();
		const result = await createCheckoutSession({
			data: {
				offer: "song_pack_500",
				checkoutAttemptId: "550e8400-e29b-41d4-a716-446655440000",
			},
		});

		expect(result).toEqual({
			success: false,
			error: "billing_service_error",
			message: "Connection refused",
		});
	});

	it("rejects invalid offer IDs via schema validation", async () => {
		mockEnv = {
			BILLING_ENABLED: true,
			BILLING_SERVICE_URL: "https://billing.example.com",
			BILLING_SHARED_SECRET: "test-secret",
		};

		const { createCheckoutSession } = await importFunctions();

		let threw = false;
		try {
			await createCheckoutSession({
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
		const { createPortalSession } = await importFunctions();
		const result = await createPortalSession();

		expect(result).toEqual({ success: false, error: "billing_disabled" });
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("sends HMAC-signed request to /portal/session", async () => {
		mockEnv = {
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

		const { createPortalSession } = await importFunctions();
		const result = await createPortalSession();

		expect(result).toEqual({
			success: true,
			portalUrl: "https://billing.stripe.com/portal/abc",
		});

		expect(mockSignBridgeRequest).toHaveBeenCalledWith(
			expect.any(String),
			"test-secret",
		);

		expect(mockFetch).toHaveBeenCalledWith(
			"https://billing.example.com/portal/session",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					"X-Timestamp": "1700000000",
					"X-Signature": "abc123",
				}),
			}),
		);

		const callBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
		expect(callBody).toEqual({
			account_id: "acct-checkout-1",
		});
	});

	it("returns billing_service_error on non-ok response", async () => {
		mockEnv = {
			BILLING_ENABLED: true,
			BILLING_SERVICE_URL: "https://billing.example.com",
			BILLING_SHARED_SECRET: "test-secret",
		};

		mockFetch.mockResolvedValue(new Response("Forbidden", { status: 403 }));

		const { createPortalSession } = await importFunctions();
		const result = await createPortalSession();

		expect(result).toEqual({
			success: false,
			error: "billing_service_error",
			message: "Billing service returned 403: Forbidden",
		});
	});
});
