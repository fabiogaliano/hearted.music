import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAuthSession = vi.fn();
const mockValidateApiToken = vi.fn();
const mockGetWithImagesBySpotifyIds = vi.fn();

type CheckRoute = {
	server: {
		handlers: {
			POST: (args: { request: Request }) => Promise<Response>;
		};
	};
};

function isCheckRoute(value: unknown): value is CheckRoute {
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

	return typeof Reflect.get(handlers, "POST") === "function";
}

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (routeConfig: unknown) => routeConfig,
}));

vi.mock("@/lib/platform/auth/auth.server", () => ({
	getAuthSession: (...args: unknown[]) => mockGetAuthSession(...args),
}));

vi.mock("@/lib/data/api-tokens", () => ({
	validateApiToken: (...args: unknown[]) => mockValidateApiToken(...args),
}));

vi.mock("@/lib/domains/library/artists/queries", () => ({
	getWithImagesBySpotifyIds: (...args: unknown[]) =>
		mockGetWithImagesBySpotifyIds(...args),
}));

const { Route } = await import("../check");
if (!isCheckRoute(Route)) {
	throw new Error("Expected Route to expose a POST handler");
}
const route = Route;

describe("/api/extension/artists/check", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetAuthSession.mockResolvedValue(null);
		mockValidateApiToken.mockResolvedValue(Result.ok(null));
		mockGetWithImagesBySpotifyIds.mockResolvedValue(Result.ok([]));
	});

	it("returns 401 when unauthenticated", async () => {
		const response = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/extension/artists/check", {
				method: "POST",
				body: JSON.stringify({ artistIds: ["artist-1"] }),
				headers: { "Content-Type": "application/json" },
			}),
		});

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "Not authenticated" });
	});

	it("returns 400 for invalid payloads", async () => {
		mockGetAuthSession.mockResolvedValue({
			session: { accountId: "acct-1" },
		});

		const response = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/extension/artists/check", {
				method: "POST",
				body: JSON.stringify({ artistIds: "artist-1" }),
				headers: { "Content-Type": "application/json" },
			}),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Invalid payload" });
	});

	it("returns cached artists with CORS headers for bearer-authenticated requests", async () => {
		mockValidateApiToken.mockResolvedValue(Result.ok("acct-1"));
		mockGetWithImagesBySpotifyIds.mockResolvedValue(
			Result.ok([{ spotify_id: "artist-1", image_url: "https://img/1.jpg" }]),
		);

		const origin = "chrome-extension://test-extension-id";
		const response = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/extension/artists/check", {
				method: "POST",
				body: JSON.stringify({ artistIds: ["artist-1", "artist-2"] }),
				headers: {
					Authorization: "Bearer test-token",
					"Content-Type": "application/json",
					Origin: origin,
				},
			}),
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
		expect(mockGetWithImagesBySpotifyIds).toHaveBeenCalledWith([
			"artist-1",
			"artist-2",
		]);
		expect(await response.json()).toEqual({
			artists: [{ spotify_id: "artist-1", image_url: "https://img/1.jpg" }],
		});
	});
});
