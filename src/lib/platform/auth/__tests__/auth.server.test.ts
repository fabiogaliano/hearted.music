import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "@/lib/domains/library/accounts/queries";
import type { AuthContext } from "@/lib/platform/auth/auth-types";
import { getAuthSession } from "../auth.server";

function createMockAuthRequestState() {
	let cachedSession: Promise<AuthContext | null> | undefined;

	return {
		getCachedSession: () => cachedSession,
		cacheSession: (sessionPromise: Promise<AuthContext | null>) => {
			cachedSession ??= sessionPromise;
			return cachedSession;
		},
	};
}

const {
	mockGetRequest,
	mockGetSession,
	mockGetAccountByBetterAuthUserId,
	mockGetAuthRequestState,
} = vi.hoisted(() => ({
	mockGetRequest: vi.fn(),
	mockGetSession: vi.fn(),
	mockGetAccountByBetterAuthUserId: vi.fn(),
	mockGetAuthRequestState: vi.fn(),
}));

vi.mock("@tanstack/react-start/server", () => ({
	getRequest: () => mockGetRequest(),
}));

vi.mock("@/lib/platform/auth/auth", () => ({
	getAuth: () => ({
		api: {
			getSession: (...args: unknown[]) => mockGetSession(...args),
		},
	}),
}));

vi.mock("@/lib/domains/library/accounts/queries", () => ({
	getAccountByBetterAuthUserId: (...args: unknown[]) =>
		mockGetAccountByBetterAuthUserId(...args),
}));

vi.mock("@/lib/platform/auth/auth-request-state", () => ({
	getAuthRequestState: () => mockGetAuthRequestState(),
}));

describe("getAuthSession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetRequest.mockReturnValue(
			new Request("https://hearted.music/dashboard"),
		);
		mockGetAuthRequestState.mockReturnValue(createMockAuthRequestState());
	});

	it("memoizes the full auth lookup per request", async () => {
		const account: Account = {
			better_auth_user_id: "user-1",
			created_at: "2026-05-25T00:00:00.000Z",
			display_name: "Hearted",
			email: "hello@hearted.music",
			handle: null,
			id: "acct-1",
			image_url: null,
			spotify_id: null,
			updated_at: "2026-05-25T00:00:00.000Z",
		};

		mockGetSession.mockResolvedValue({
			user: {
				id: "user-1",
				email: "hello@hearted.music",
				emailVerified: true,
			},
		});
		mockGetAccountByBetterAuthUserId.mockResolvedValue(Result.ok(account));

		const [first, second] = await Promise.all([
			getAuthSession(),
			getAuthSession(),
		]);

		expect(mockGetSession).toHaveBeenCalledTimes(1);
		expect(mockGetAccountByBetterAuthUserId).toHaveBeenCalledTimes(1);
		expect(first).toEqual(second);
		expect(first).toEqual({
			session: { accountId: "acct-1" },
			account,
			identity: {
				email: "hello@hearted.music",
				emailVerified: true,
			},
		});
	});

	it("returns null once when Better Auth has no session", async () => {
		mockGetSession.mockResolvedValue(null);

		const [first, second] = await Promise.all([
			getAuthSession(),
			getAuthSession(),
		]);

		expect(mockGetSession).toHaveBeenCalledTimes(1);
		expect(mockGetAccountByBetterAuthUserId).not.toHaveBeenCalled();
		expect(first).toBeNull();
		expect(second).toBeNull();
	});
});
