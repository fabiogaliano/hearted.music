import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthToken } from "@/lib/data/auth-tokens";
import { refreshTokenWithCoordination } from "./client";

const authTokenMocks = vi.hoisted(() => ({
	upsertToken: vi.fn(),
	getTokenByAccountId: vi.fn(),
	isTokenExpired: vi.fn(),
}));

vi.mock("@/lib/data/auth-tokens", () => authTokenMocks);

vi.mock("@/env", () => ({
	env: {
		SPOTIFY_CLIENT_ID: "test-client-id",
		SPOTIFY_REDIRECT_URI: "http://localhost/callback",
	},
}));

describe("refreshTokenWithCoordination", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		authTokenMocks.upsertToken.mockReset();
		authTokenMocks.getTokenByAccountId.mockReset();
		authTokenMocks.isTokenExpired.mockReset();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.clearAllMocks();
	});

	it("deduplicates concurrent refreshes per account", async () => {
		const token = {
			account_id: "account-1",
			access_token: "old-access",
			refresh_token: "old-refresh",
			token_expires_at: new Date().toISOString(),
		} as AuthToken;

		const updatedToken = {
			...token,
			access_token: "new-access",
			refresh_token: "new-refresh",
			token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
		} as AuthToken;

		authTokenMocks.upsertToken.mockResolvedValue(Result.ok(updatedToken));

		const responsePayload = {
			access_token: "new-access",
			refresh_token: "new-refresh",
			token_type: "Bearer",
			expires_in: 3600,
		};

		let resolveFetch: (value: Response) => void;
		const fetchPromise = new Promise<Response>((resolve) => {
			resolveFetch = resolve;
		});

		globalThis.fetch = vi.fn(() => fetchPromise) as typeof globalThis.fetch;

		const first = refreshTokenWithCoordination("account-1", token);
		const second = refreshTokenWithCoordination("account-1", token);

		expect(globalThis.fetch).toHaveBeenCalledTimes(1);

		resolveFetch!({
			ok: true,
			json: async () => responsePayload,
		} as Response);

		const [firstResult, secondResult] = await Promise.all([first, second]);

		expect(firstResult).toHaveOkValue(updatedToken);
		expect(secondResult).toHaveOkValue(updatedToken);
		expect(authTokenMocks.upsertToken).toHaveBeenCalledTimes(1);
	});
});
