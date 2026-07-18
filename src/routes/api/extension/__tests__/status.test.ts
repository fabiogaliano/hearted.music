import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

type StatusRoute = {
	server: {
		handlers: {
			GET: () => Promise<Response>;
			POST: (args: { request: Request }) => Promise<Response>;
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
	mockUpsert,
} = vi.hoisted(() => ({
	mockGetRequest: vi.fn<() => Request>(),
	mockValidateApiToken: vi.fn(),
	mockCreateAdminSupabaseClient: vi.fn(),
	mockGetCount: vi.fn(),
	mockGetPlaylistCount: vi.fn(),
	mockSingle: vi.fn(),
	mockUpsert: vi.fn(),
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
		const diagnosticQuery = {
			upsert: (...args: unknown[]) => mockUpsert(...args),
		};

		mockSingle.mockResolvedValue({
			data: {
				display_name: "Hearted",
				email: "hello@hearted.test",
				spotify_id: "spotify-user-1",
				image_url: "https://i.scdn.co/image/avatar",
			},
		});
		mockUpsert.mockResolvedValue({ error: null });
		mockCreateAdminSupabaseClient.mockReturnValue({
			from: vi.fn((table: string) =>
				table === "extension_sync_diagnostic" ? diagnosticQuery : accountQuery,
			),
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
			spotifyId: "spotify-user-1",
			imageUrl: "https://i.scdn.co/image/avatar",
			likedSongCount: 12,
			playlistCount: 3,
		});
	});

	it("stores a sync diagnostic summary for valid bearer tokens", async () => {
		mockValidateApiToken.mockResolvedValue(Result.ok("acct-1"));

		const response = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/extension/status", {
				method: "POST",
				headers: {
					Authorization: "Bearer good-token",
					Origin: "chrome-extension://test-extension-id",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					id: "11111111-1111-4111-8111-111111111111",
					clientCreatedAt: "2026-06-12T21:00:00.000Z",
					extensionVersion: "0.1.1",
					outcome: "backend_failure",
					phase: "uploading",
					backendStatus: 429,
					backendFailureCode: "sync_cooldown",
					retryAfterSeconds: 42,
					errorMessage: "Cooldown active",
					durationMs: 12345,
					likedSongsCount: 15000,
					playlistCount: 300,
					playlistsWithTracksCount: 280,
					playlistTracksCount: 15000,
					failedPlaylistTrackFetchCount: 2,
					skippedEmptyPlaylistsCount: 20,
					requestStats: {
						started: 410,
						succeeded: 409,
						failed: 1,
						rateLimitedResponses: 1,
						retryAttempts: 1,
						retryAfterSecondsTotal: 42,
						wallTimeMs: 95000,
					},
					requestPolicy: {
						maxConcurrentRequests: 2,
						minRequestIntervalMs: 200,
						maxRequestIntervalMs: 300,
					},
				}),
			}),
		});

		expect(response.status).toBe(200);
		expect(mockUpsert).toHaveBeenCalledWith(
			expect.objectContaining({
				account_id: "acct-1",
				backend_failure_code: "sync_cooldown",
				failed_playlist_track_fetch_count: 2,
				request_policy: {
					maxConcurrentRequests: 2,
					minRequestIntervalMs: 200,
					maxRequestIntervalMs: 300,
				},
			}),
			{ onConflict: "id" },
		);
		expect(await response.json()).toEqual({ ok: true });
	});

	it("rejects invalid diagnostic payloads", async () => {
		mockValidateApiToken.mockResolvedValue(Result.ok("acct-1"));

		const response = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/extension/status", {
				method: "POST",
				headers: {
					Authorization: "Bearer good-token",
					Origin: "chrome-extension://test-extension-id",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ outcome: "success" }),
			}),
		});

		expect(response.status).toBe(400);
		expect(mockUpsert).not.toHaveBeenCalled();
	});
});
