import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

type StatusRoute = {
	server: {
		handlers: {
			GET: () => Promise<Response>;
		};
	};
};

function isStatusRoute(value: unknown): value is StatusRoute {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const server = Reflect.get(value, "server");
	if (typeof server !== "object" || server === null) {
		return false;
	}

	const handlers = Reflect.get(server, "handlers");
	if (typeof handlers !== "object" || handlers === null) {
		return false;
	}

	return typeof Reflect.get(handlers, "GET") === "function";
}

const {
	mockGetRequest,
	mockValidateApiToken,
	mockCreateAdminSupabaseClient,
	mockGetCount,
	mockGetPlaylistCount,
	mockSingle,
} = vi.hoisted(() => ({
	mockGetRequest: vi.fn<() => Request>(),
	mockValidateApiToken: vi.fn(),
	mockCreateAdminSupabaseClient: vi.fn(),
	mockGetCount: vi.fn(),
	mockGetPlaylistCount: vi.fn(),
	mockSingle: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (routeConfig: unknown) => routeConfig,
}));

vi.mock("@tanstack/react-start/server", () => ({
	getRequest: () => mockGetRequest(),
}));

vi.mock("@/lib/platform/auth/extension-api-tokens", () => ({
	validateExtensionApiToken: (...args: unknown[]) =>
		mockValidateApiToken(...args),
}));

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => mockCreateAdminSupabaseClient(),
}));

vi.mock("@/lib/domains/library/liked-songs/queries", () => ({
	getCount: (...args: unknown[]) => mockGetCount(...args),
}));

vi.mock("@/lib/domains/library/playlists/queries", () => ({
	getPlaylistCount: (...args: unknown[]) => mockGetPlaylistCount(...args),
}));

const { Route } = await import("../status");
if (!isStatusRoute(Route)) {
	throw new Error("Expected Route to expose a GET handler");
}
const route = Route;

describe("/api/extension/status", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetRequest.mockReturnValue(
			new Request("https://hearted.test/api/extension/status"),
		);
		mockValidateApiToken.mockResolvedValue(Result.ok(null));
		mockGetCount.mockResolvedValue(Result.ok(12));
		mockGetPlaylistCount.mockResolvedValue(Result.ok(3));

		const accountQuery = {
			select: vi.fn(() => accountQuery),
			eq: vi.fn(() => accountQuery),
			single: (...args: unknown[]) => mockSingle(...args),
		};

		mockSingle.mockResolvedValue({
			data: { display_name: "Hearted", email: "hello@hearted.test" },
		});
		mockCreateAdminSupabaseClient.mockReturnValue({
			from: vi.fn(() => accountQuery),
		});
	});

	it("redacts data and omits CORS headers without a bearer token", async () => {
		mockGetRequest.mockReturnValue(
			new Request("https://hearted.test/api/extension/status", {
				headers: { Origin: "https://evil.example" },
			}),
		);

		const response = await route.server.handlers.GET();

		expect(response.status).toBe(200);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
		expect(await response.json()).toEqual({
			authenticated: false,
			likedSongCount: 0,
			playlistCount: 0,
		});
		expect(mockValidateApiToken).not.toHaveBeenCalled();
		expect(mockGetCount).not.toHaveBeenCalled();
		expect(mockGetPlaylistCount).not.toHaveBeenCalled();
	});

	it("returns 401 for invalid bearer tokens and reflects extension origins", async () => {
		mockGetRequest.mockReturnValue(
			new Request("https://hearted.test/api/extension/status", {
				headers: {
					Authorization: "Bearer bad-token",
					Origin: "chrome-extension://test-extension-id",
				},
			}),
		);

		const response = await route.server.handlers.GET();

		expect(response.status).toBe(401);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
			"chrome-extension://test-extension-id",
		);
		expect(await response.json()).toEqual({
			error: "Invalid or revoked API token",
		});
	});

	it("returns account data for valid bearer tokens", async () => {
		mockValidateApiToken.mockResolvedValue(Result.ok("acct-1"));
		mockGetRequest.mockReturnValue(
			new Request("https://hearted.test/api/extension/status", {
				headers: {
					Authorization: "Bearer good-token",
					Origin: "chrome-extension://test-extension-id",
				},
			}),
		);

		const response = await route.server.handlers.GET();

		expect(response.status).toBe(200);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
			"chrome-extension://test-extension-id",
		);
		expect(mockGetCount).toHaveBeenCalledWith("acct-1");
		expect(mockGetPlaylistCount).toHaveBeenCalledWith("acct-1");
		expect(await response.json()).toEqual({
			authenticated: true,
			accountId: "acct-1",
			displayName: "Hearted",
			email: "hello@hearted.test",
			likedSongCount: 12,
			playlistCount: 3,
		});
	});
});
