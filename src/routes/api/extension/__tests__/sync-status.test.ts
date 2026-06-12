import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

type StatusRoute = {
	server: { handlers: { GET: () => Promise<Response> } };
};

function isStatusRoute(value: unknown): value is StatusRoute {
	if (typeof value !== "object" || value === null) return false;
	const server = Reflect.get(value, "server");
	if (typeof server !== "object" || server === null) return false;
	const handlers = Reflect.get(server, "handlers");
	if (typeof handlers !== "object" || handlers === null) return false;
	return typeof Reflect.get(handlers, "GET") === "function";
}

const {
	mockGetRequest,
	mockGetAuthSession,
	mockValidateApiToken,
	mockCreateAdminSupabaseClient,
} = vi.hoisted(() => ({
	mockGetRequest: vi.fn<() => Request>(),
	mockGetAuthSession: vi.fn(),
	mockValidateApiToken: vi.fn(),
	mockCreateAdminSupabaseClient: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (routeConfig: unknown) => routeConfig,
}));

vi.mock("@tanstack/react-start/server", () => ({
	getRequest: () => mockGetRequest(),
}));

vi.mock("@/lib/platform/auth/auth.server", () => ({
	getAuthSession: (...a: unknown[]) => mockGetAuthSession(...a),
}));

vi.mock("@/lib/platform/auth/extension-api-tokens", () => ({
	validateExtensionApiToken: (...a: unknown[]) => mockValidateApiToken(...a),
}));

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => mockCreateAdminSupabaseClient(),
}));

const { Route } = await import("../sync/status");
if (!isStatusRoute(Route)) {
	throw new Error("Expected Route to expose a GET handler");
}
const route = Route;

const ACCOUNT_ID = "acct-1";
const PHASE_JOB_IDS = {
	liked_songs: "11111111-1111-4111-8111-111111111111",
	playlists: "22222222-2222-4222-8222-222222222222",
	playlist_tracks: "33333333-3333-4333-8333-333333333333",
};

function request(): Request {
	return new Request("https://hearted.test/api/extension/sync/status", {
		headers: { Origin: "chrome-extension://test-extension-id" },
	});
}

function fakeSupabase(prefs: unknown, jobRows: unknown[]) {
	return {
		from(table: string) {
			if (table === "user_preferences") {
				return {
					select: () => ({
						eq: () => ({ maybeSingle: async () => ({ data: prefs }) }),
					}),
				};
			}
			return {
				select: () => ({ in: async () => ({ data: jobRows, error: null }) }),
			};
		},
	};
}

describe("/api/extension/sync/status", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetRequest.mockReturnValue(request());
		mockGetAuthSession.mockResolvedValue({
			session: { accountId: ACCOUNT_ID },
		});
		mockValidateApiToken.mockResolvedValue(Result.ok(null));
	});

	it("returns 401 when unauthenticated", async () => {
		mockGetAuthSession.mockResolvedValue(null);
		const response = await route.server.handlers.GET();
		expect(response.status).toBe(401);
	});

	it("returns null phases when no sync is tracked", async () => {
		mockCreateAdminSupabaseClient.mockReturnValue(
			fakeSupabase({ phase_job_ids: null }, []),
		);

		const response = await route.server.handlers.GET();
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ phaseJobIds: null, phases: null });
	});

	it("returns the three phase rows mapped by phase name", async () => {
		mockCreateAdminSupabaseClient.mockReturnValue(
			fakeSupabase({ phase_job_ids: PHASE_JOB_IDS }, [
				{
					id: PHASE_JOB_IDS.liked_songs,
					status: "completed",
					progress: { done: 1 },
					error: null,
				},
				{
					id: PHASE_JOB_IDS.playlists,
					status: "running",
					progress: {},
					error: null,
				},
			]),
		);

		const response = await route.server.handlers.GET();
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.phaseJobIds).toEqual(PHASE_JOB_IDS);
		expect(body.phases.liked_songs).toEqual({
			status: "completed",
			progress: { done: 1 },
			error: null,
		});
		expect(body.phases.playlists.status).toBe("running");
		// No row returned for playlist_tracks → stays null.
		expect(body.phases.playlist_tracks).toBeNull();
	});
});
