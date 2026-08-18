import { gzipSync } from "node:zlib";
import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/shared/errors/database";
import {
	EXTENSION_SYNC_ALREADY_RUNNING,
	EXTENSION_SYNC_COOLDOWN,
	EXTENSION_SYNC_PAYLOAD_TOO_LARGE,
} from "../../../../../shared/extension-sync-contract";

type SyncRoute = {
	server: {
		handlers: {
			POST: (args: { request: Request }) => Promise<Response>;
		};
	};
};

function isSyncRoute(value: unknown): value is SyncRoute {
	if (typeof value !== "object" || value === null) return false;
	const server = Reflect.get(value, "server");
	if (typeof server !== "object" || server === null) return false;
	const handlers = Reflect.get(server, "handlers");
	if (typeof handlers !== "object" || handlers === null) return false;
	return typeof Reflect.get(handlers, "POST") === "function";
}

const {
	mockGetAuthSession,
	mockValidateExtensionApiToken,
	mockCreateAdminSupabaseClient,
	mockBuildSyncPayloadPath,
	mockUploadSyncPayload,
	mockDeleteSyncPayload,
	mockBeginExtensionSync,
	mockCaptureWithWaitUntil,
} = vi.hoisted(() => ({
	mockGetAuthSession: vi.fn(),
	mockValidateExtensionApiToken: vi.fn(),
	mockCreateAdminSupabaseClient: vi.fn(),
	mockBuildSyncPayloadPath: vi.fn(),
	mockUploadSyncPayload: vi.fn(),
	mockDeleteSyncPayload: vi.fn(),
	mockBeginExtensionSync: vi.fn(),
	mockCaptureWithWaitUntil: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (routeConfig: unknown) => routeConfig,
}));

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: (...args: unknown[]) =>
		mockCreateAdminSupabaseClient(...args),
}));

vi.mock("@/lib/platform/auth/auth.server", () => ({
	getAuthSession: (...args: unknown[]) => mockGetAuthSession(...args),
}));

vi.mock("@/lib/platform/auth/extension-api-tokens", () => ({
	validateExtensionApiToken: (...args: unknown[]) =>
		mockValidateExtensionApiToken(...args),
}));

vi.mock("@/lib/workflows/extension-sync/payload-storage", () => ({
	buildSyncPayloadPath: (...args: unknown[]) =>
		mockBuildSyncPayloadPath(...args),
	uploadSyncPayload: (...args: unknown[]) => mockUploadSyncPayload(...args),
	deleteSyncPayload: (...args: unknown[]) => mockDeleteSyncPayload(...args),
}));

vi.mock("@/lib/platform/jobs/extension-sync-jobs", () => ({
	beginExtensionSync: (...args: unknown[]) => mockBeginExtensionSync(...args),
}));

vi.mock("@/utils/posthog-server", () => ({
	captureWithWaitUntil: (...args: unknown[]) =>
		mockCaptureWithWaitUntil(...args),
}));

const { Route } = await import("../sync");
if (!isSyncRoute(Route)) {
	throw new Error("Expected Route to expose a POST handler");
}
const route = Route;

const ACCOUNT_ID = "acct-1";
const PAYLOAD_PATH = "acct-1/payload-uuid.json";
const PHASE_JOB_IDS = {
	liked_songs: "11111111-1111-4111-8111-111111111111",
	playlists: "22222222-2222-4222-8222-222222222222",
	playlist_tracks: "33333333-3333-4333-8333-333333333333",
};

function syncRequest(
	body: unknown,
	headerOverrides: Record<string, string> = {},
): Request {
	const serialized = JSON.stringify(body);
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"Content-Length": String(new TextEncoder().encode(serialized).length),
		Origin: "chrome-extension://test-extension-id",
		...headerOverrides,
	};
	return new Request("https://hearted.test/api/extension/sync", {
		method: "POST",
		headers,
		body: serialized,
	});
}

describe("/api/extension/sync", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetAuthSession.mockResolvedValue({
			session: { accountId: ACCOUNT_ID },
		});
		mockValidateExtensionApiToken.mockResolvedValue(Result.ok(null));
		mockCreateAdminSupabaseClient.mockReturnValue({ id: "admin-client" });
		mockBuildSyncPayloadPath.mockReturnValue(PAYLOAD_PATH);
		mockUploadSyncPayload.mockResolvedValue(Result.ok(undefined));
		mockDeleteSyncPayload.mockResolvedValue(Result.ok(undefined));
		mockBeginExtensionSync.mockResolvedValue(
			Result.ok({
				kind: "queued",
				jobId: "parent-1",
				phaseJobIds: PHASE_JOB_IDS,
			}),
		);
		mockCaptureWithWaitUntil.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns 401 when unauthenticated (no session, no valid token)", async () => {
		mockGetAuthSession.mockResolvedValue(null);
		const response = await route.server.handlers.POST({
			request: syncRequest({ likedSongs: [], playlists: [] }),
		});

		expect(response.status).toBe(401);
		expect(mockUploadSyncPayload).not.toHaveBeenCalled();
		expect(mockBeginExtensionSync).not.toHaveBeenCalled();
	});

	it("authenticates via bearer token when there is no session", async () => {
		mockGetAuthSession.mockResolvedValue(null);
		mockValidateExtensionApiToken.mockResolvedValue(Result.ok(ACCOUNT_ID));

		const response = await route.server.handlers.POST({
			request: syncRequest(
				{ likedSongs: [], playlists: [] },
				{ Authorization: "Bearer tok-123" },
			),
		});

		expect(mockValidateExtensionApiToken).toHaveBeenCalledWith("tok-123");
		expect(response.status).toBe(202);
	});

	it("returns 411 when Content-Length is absent", async () => {
		const response = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/extension/sync", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Origin: "chrome-extension://test-extension-id",
				},
				body: JSON.stringify({ likedSongs: [], playlists: [] }),
			}),
		});

		expect(response.status).toBe(411);
		expect(await response.json()).toEqual({ error: "Content-Length required" });
		expect(mockUploadSyncPayload).not.toHaveBeenCalled();
	});

	it("returns 411 when Content-Length is malformed", async () => {
		const response = await route.server.handlers.POST({
			request: syncRequest(
				{ likedSongs: [], playlists: [] },
				{ "Content-Length": "not-a-number" },
			),
		});

		expect(response.status).toBe(411);
		expect(mockUploadSyncPayload).not.toHaveBeenCalled();
	});

	it("returns 413 with the payload-too-large code when Content-Length exceeds the body cap", async () => {
		const response = await route.server.handlers.POST({
			request: syncRequest(
				{ likedSongs: [], playlists: [] },
				{ "Content-Length": String(20 * 1024 * 1024 + 1) },
			),
		});

		expect(response.status).toBe(413);
		// The code is the machine contract the extension keys on; the error copy
		// is display text and deliberately not pinned.
		const body = await response.json();
		expect(body).toMatchObject({ code: EXTENSION_SYNC_PAYLOAD_TOO_LARGE });
		expect(typeof body.error).toBe("string");
		expect(mockUploadSyncPayload).not.toHaveBeenCalled();
	});

	it("returns 413 with the payload-too-large code when a compressed body's declared length exceeds the cap", async () => {
		const response = await route.server.handlers.POST({
			request: syncRequest(
				{ likedSongs: [], playlists: [] },
				{
					"Content-Type": "application/gzip",
					"Content-Length": String(20 * 1024 * 1024 + 1),
				},
			),
		});

		expect(response.status).toBe(413);
		const body = await response.json();
		expect(body).toMatchObject({ code: EXTENSION_SYNC_PAYLOAD_TOO_LARGE });
		expect(typeof body.error).toBe("string");
		expect(mockUploadSyncPayload).not.toHaveBeenCalled();
	});

	it("stages the payload and returns 202 with phaseJobIds when queued", async () => {
		const response = await route.server.handlers.POST({
			request: syncRequest({ likedSongs: [], playlists: [] }),
		});

		expect(response.status).toBe(202);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
			"chrome-extension://test-extension-id",
		);
		expect(await response.json()).toEqual({
			ok: true,
			queued: true,
			phaseJobIds: PHASE_JOB_IDS,
		});

		// Uploaded the raw body as JSON-typed bytes, then enqueued with the same
		// path + byte size.
		expect(mockUploadSyncPayload).toHaveBeenCalledWith(
			{ id: "admin-client" },
			PAYLOAD_PATH,
			expect.any(Uint8Array),
			"application/json",
		);
		const [, pathArg, bytesArg] = mockBeginExtensionSync.mock.calls[0];
		expect(pathArg).toBe(PAYLOAD_PATH);
		expect(bytesArg).toBeGreaterThan(0);
		expect(mockCaptureWithWaitUntil).toHaveBeenCalledOnce();
		expect(mockCaptureWithWaitUntil).toHaveBeenCalledWith(
			expect.objectContaining({
				properties: expect.objectContaining({ payload_encoding: "json" }),
			}),
		);
		// Queued path keeps the staged object for the worker.
		expect(mockDeleteSyncPayload).not.toHaveBeenCalled();
	});

	it("stages a gzip body untouched with a .json.gz path and application/gzip content type", async () => {
		const compressed = gzipSync(
			Buffer.from(JSON.stringify({ likedSongs: [], playlists: [] })),
		);
		const request = new Request("https://hearted.test/api/extension/sync", {
			method: "POST",
			headers: {
				"Content-Type": "application/gzip",
				"Content-Length": String(compressed.byteLength),
				Origin: "chrome-extension://test-extension-id",
			},
			body: compressed,
		});
		mockBuildSyncPayloadPath.mockReturnValue("acct-1/payload-uuid.json.gz");

		const response = await route.server.handlers.POST({ request });

		expect(response.status).toBe(202);
		// Route builds the path with the gzip extension and uploads the exact
		// compressed bytes it received — no decompression, no re-encoding.
		expect(mockBuildSyncPayloadPath).toHaveBeenCalledWith(
			ACCOUNT_ID,
			"json.gz",
		);
		const [, , uploadedBytesArg, uploadedContentTypeArg] =
			mockUploadSyncPayload.mock.calls[0];
		expect(new Uint8Array(uploadedBytesArg as Uint8Array)).toEqual(
			new Uint8Array(compressed),
		);
		expect(uploadedContentTypeArg).toBe("application/gzip");
		expect(mockCaptureWithWaitUntil).toHaveBeenCalledWith(
			expect.objectContaining({
				properties: expect.objectContaining({ payload_encoding: "gzip" }),
			}),
		);
	});

	it("returns 429 already-running and drops the staged payload when gated", async () => {
		mockBeginExtensionSync.mockResolvedValue(
			Result.ok({ kind: "active", jobId: "parent-1" }),
		);

		const response = await route.server.handlers.POST({
			request: syncRequest({ likedSongs: [], playlists: [] }),
		});

		expect(response.status).toBe(429);
		expect(await response.json()).toEqual({
			code: EXTENSION_SYNC_ALREADY_RUNNING,
			error:
				"A library sync is already running for this account. Wait for it to finish before trying again.",
		});
		expect(mockDeleteSyncPayload).toHaveBeenCalledWith(
			{ id: "admin-client" },
			PAYLOAD_PATH,
		);
		expect(mockCaptureWithWaitUntil).not.toHaveBeenCalled();
	});

	it("returns 429 cooldown with Retry-After and drops the staged payload", async () => {
		mockBeginExtensionSync.mockResolvedValue(
			Result.ok({ kind: "cooldown", retryAfterSeconds: 42 }),
		);

		const response = await route.server.handlers.POST({
			request: syncRequest({ likedSongs: [], playlists: [] }),
		});

		expect(response.status).toBe(429);
		expect(response.headers.get("Retry-After")).toBe("42");
		expect(await response.json()).toEqual({
			code: EXTENSION_SYNC_COOLDOWN,
			error:
				"Library sync was run too recently for this account. Wait before trying again.",
			retryAfterSeconds: 42,
		});
		expect(mockDeleteSyncPayload).toHaveBeenCalledWith(
			{ id: "admin-client" },
			PAYLOAD_PATH,
		);
	});

	it("returns 500 when staging the payload fails (no enqueue)", async () => {
		mockUploadSyncPayload.mockResolvedValue(
			Result.err(new DatabaseError({ code: "storage", message: "nope" })),
		);

		const response = await route.server.handlers.POST({
			request: syncRequest({ likedSongs: [], playlists: [] }),
		});

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			error: "Failed to stage sync payload",
		});
		expect(mockBeginExtensionSync).not.toHaveBeenCalled();
	});

	it("returns 500 and drops the staged payload when enqueue fails", async () => {
		mockBeginExtensionSync.mockResolvedValue(
			Result.err(new DatabaseError({ code: "08006", message: "db down" })),
		);

		const response = await route.server.handlers.POST({
			request: syncRequest({ likedSongs: [], playlists: [] }),
		});

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: "Failed to enqueue sync" });
		expect(mockDeleteSyncPayload).toHaveBeenCalledWith(
			{ id: "admin-client" },
			PAYLOAD_PATH,
		);
	});
});
