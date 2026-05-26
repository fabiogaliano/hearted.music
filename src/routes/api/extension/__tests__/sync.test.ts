import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	SpotifyPlaylistDTO,
	SpotifyTrackDTO,
} from "@/lib/workflows/spotify-sync/types";
import {
	EXTENSION_SYNC_ALREADY_RUNNING,
	EXTENSION_SYNC_COOLDOWN,
} from "../../../../../shared/extension-sync-contract";

type SyncRoute = {
	server: {
		handlers: {
			POST: (args: { request: Request }) => Promise<Response>;
		};
	};
};

function isSyncRoute(value: unknown): value is SyncRoute {
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

const {
	mockGetAuthSession,
	mockValidateExtensionApiToken,
	mockMarkStaleSyncJobs,
	mockGetActiveSync,
	mockGetLastCompletedSync,
	mockCreateJob,
	mockCompleteJob,
	mockStartJob,
	mockFailJob,
	mockRunPhase,
	mockGetAll,
	mockGetPlaylists,
	mockGetTargetPlaylists,
	mockMapWithConcurrency,
	mockApplyLibraryProcessingChange,
	mockUpdatePhaseJobIds,
	mockLibrarySynced,
	mockCaptureWithWaitUntil,
} = vi.hoisted(() => ({
	mockGetAuthSession: vi.fn(),
	mockValidateExtensionApiToken: vi.fn(),
	mockMarkStaleSyncJobs: vi.fn(),
	mockGetActiveSync: vi.fn(),
	mockGetLastCompletedSync: vi.fn(),
	mockCreateJob: vi.fn(),
	mockCompleteJob: vi.fn(),
	mockStartJob: vi.fn(),
	mockFailJob: vi.fn(),
	mockRunPhase: vi.fn(),
	mockGetAll: vi.fn(),
	mockGetPlaylists: vi.fn(),
	mockGetTargetPlaylists: vi.fn(),
	mockMapWithConcurrency: vi.fn(),
	mockApplyLibraryProcessingChange: vi.fn(),
	mockUpdatePhaseJobIds: vi.fn(),
	mockLibrarySynced: vi.fn(),
	mockCaptureWithWaitUntil: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (routeConfig: unknown) => routeConfig,
}));

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/domains/library/accounts/preferences-queries", () => ({
	updatePhaseJobIds: (...args: unknown[]) => mockUpdatePhaseJobIds(...args),
}));

vi.mock("@/lib/domains/library/liked-songs/queries", () => ({
	getAll: (...args: unknown[]) => mockGetAll(...args),
}));

vi.mock("@/lib/domains/library/playlists/queries", () => ({
	getPlaylists: (...args: unknown[]) => mockGetPlaylists(...args),
	getTargetPlaylists: (...args: unknown[]) => mockGetTargetPlaylists(...args),
}));

vi.mock("@/lib/platform/auth/auth.server", () => ({
	getAuthSession: (...args: unknown[]) => mockGetAuthSession(...args),
}));

vi.mock("@/lib/platform/auth/extension-api-tokens", () => ({
	validateExtensionApiToken: (...args: unknown[]) =>
		mockValidateExtensionApiToken(...args),
}));

vi.mock("@/lib/platform/jobs/lifecycle", () => ({
	completeJob: (...args: unknown[]) => mockCompleteJob(...args),
	startJob: (...args: unknown[]) => mockStartJob(...args),
	failJob: (...args: unknown[]) => mockFailJob(...args),
}));

vi.mock("@/lib/platform/jobs/repository", () => ({
	createJob: (...args: unknown[]) => mockCreateJob(...args),
}));

vi.mock("@/lib/platform/jobs/sync-phase-jobs", () => ({
	getActiveSync: (...args: unknown[]) => mockGetActiveSync(...args),
	getLastCompletedSync: (...args: unknown[]) =>
		mockGetLastCompletedSync(...args),
	markStaleSyncJobs: (...args: unknown[]) => mockMarkStaleSyncJobs(...args),
}));

vi.mock("@/lib/shared/utils/concurrency", () => ({
	mapWithConcurrency: (...args: unknown[]) => mockMapWithConcurrency(...args),
}));

vi.mock("@/lib/workflows/library-processing/changes/sync", () => ({
	SyncChanges: {
		librarySynced: (...args: unknown[]) => mockLibrarySynced(...args),
	},
}));

vi.mock("@/lib/workflows/library-processing/service", () => ({
	applyLibraryProcessingChange: (...args: unknown[]) =>
		mockApplyLibraryProcessingChange(...args),
}));

vi.mock("@/lib/workflows/spotify-sync/playlist-sync", () => ({
	syncPlaylists: vi.fn(),
	syncPlaylistTracksFromData: vi.fn(),
}));

vi.mock("@/lib/workflows/spotify-sync/sync-helpers", () => ({
	incrementalSync: vi.fn(),
	initialSync: vi.fn(),
	runPhase: (...args: unknown[]) => mockRunPhase(...args),
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

// createJob is called once per phase type; returning the type as the id lets
// tests assert exactly which sibling jobs get finalized by their type name.
const SONGS_JOB = "sync_liked_songs";
const PLAYLISTS_JOB = "sync_playlists";
const TRACKS_JOB = "sync_playlist_tracks";

function aTrack(id: string): SpotifyTrackDTO {
	return {
		added_at: "2026-01-01T00:00:00.000Z",
		track: {
			id,
			name: `track-${id}`,
			artists: [{ id: `artist-${id}`, name: `Artist ${id}` }],
			album: { id: `album-${id}`, name: `Album ${id}`, images: [] },
			duration_ms: 180_000,
			uri: `spotify:track:${id}`,
		},
	};
}

function aPlaylist(id: string): SpotifyPlaylistDTO {
	return {
		id,
		name: `playlist-${id}`,
		description: null,
		owner: { id: `owner-${id}` },
		track_count: null,
		image_url: null,
	};
}

function syncRequest(body: unknown): Request {
	return new Request("https://hearted.test/api/extension/sync", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: "chrome-extension://test-extension-id",
		},
		body: JSON.stringify(body),
	});
}

function okPlaylistPhase() {
	return Result.ok({
		total: 1,
		created: 1,
		updated: 0,
		removed: 0,
		removedTargetPlaylistIds: [],
		updatedTargetMetadataPlaylistIds: [],
		updatedTargetProfileTextPlaylistIds: [],
	});
}

function okLikedSongsPhase() {
	return Result.ok({ total: 1, added: 1, removed: 0, newSongs: [] });
}

describe("/api/extension/sync", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-25T16:10:00.000Z"));
		vi.clearAllMocks();
		mockGetAuthSession.mockResolvedValue({
			session: { accountId: ACCOUNT_ID },
		});
		mockValidateExtensionApiToken.mockResolvedValue(Result.ok(null));
		mockMarkStaleSyncJobs.mockResolvedValue(Result.ok([]));
		mockGetActiveSync.mockResolvedValue(Result.ok(null));
		mockGetLastCompletedSync.mockResolvedValue(Result.ok(null));
		mockCreateJob.mockImplementation((_accountId: string, type: string) =>
			Promise.resolve(Result.ok({ id: type })),
		);
		mockCompleteJob.mockResolvedValue(Result.ok({ id: "job" }));
		mockStartJob.mockResolvedValue(Result.ok({ id: "job" }));
		mockFailJob.mockResolvedValue(Result.ok({ id: "job" }));
		mockRunPhase.mockResolvedValue(okPlaylistPhase());
		mockGetAll.mockResolvedValue(Result.ok([]));
		mockGetPlaylists.mockResolvedValue(Result.ok([]));
		mockGetTargetPlaylists.mockResolvedValue(Result.ok([]));
		mockMapWithConcurrency.mockResolvedValue([]);
		mockApplyLibraryProcessingChange.mockResolvedValue(Result.ok({}));
		mockUpdatePhaseJobIds.mockResolvedValue(Result.ok({}));
		mockLibrarySynced.mockReturnValue({});
		mockCaptureWithWaitUntil.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns 429 when a sync is already running for the account", async () => {
		mockGetActiveSync.mockResolvedValue(
			Result.ok({ id: "job-1", status: "running" }),
		);

		const response = await route.server.handlers.POST({
			request: syncRequest({ likedSongs: [], playlists: [] }),
		});

		expect(response.status).toBe(429);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
			"chrome-extension://test-extension-id",
		);
		expect(await response.json()).toEqual({
			code: EXTENSION_SYNC_ALREADY_RUNNING,
			error:
				"A library sync is already running for this account. Wait for it to finish before trying again.",
		});
		expect(mockCreateJob).not.toHaveBeenCalled();
	});

	it("returns 429 with retry-after when the last completed sync is too recent", async () => {
		mockGetLastCompletedSync.mockResolvedValue(
			Result.ok({
				id: "job-2",
				completed_at: new Date(Date.now() - 15_000).toISOString(),
			}),
		);

		const response = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/extension/sync", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ likedSongs: [], playlists: [] }),
			}),
		});

		expect(response.status).toBe(429);
		expect(response.headers.get("Retry-After")).toBe("45");
		expect(await response.json()).toEqual({
			code: EXTENSION_SYNC_COOLDOWN,
			error:
				"Library sync was run too recently for this account. Wait before trying again.",
			retryAfterSeconds: 45,
		});
		expect(mockCreateJob).not.toHaveBeenCalled();
	});

	it("runs stale sync-job cleanup before evaluating the active-sync gate", async () => {
		// Simulate an orphan that cleanup fails; the gate then sees a clean slate
		// instead of a permanent 429.
		mockMarkStaleSyncJobs.mockResolvedValue(
			Result.ok([{ id: "orphan", status: "failed" }]),
		);

		const response = await route.server.handlers.POST({
			request: syncRequest({ likedSongs: [], playlists: [] }),
		});

		expect(mockMarkStaleSyncJobs).toHaveBeenCalledWith(
			ACCOUNT_ID,
			"10 minutes",
		);
		expect(mockMarkStaleSyncJobs.mock.invocationCallOrder[0]).toBeLessThan(
			mockGetActiveSync.mock.invocationCallOrder[0],
		);
		// Orphan cleared → not locked out → the sync proceeds to create jobs.
		expect(mockCreateJob).toHaveBeenCalledTimes(3);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ ok: true });
	});

	it("still blocks job creation behind the active-sync gate after cleanup runs", async () => {
		mockGetActiveSync.mockResolvedValue(
			Result.ok({ id: "job-1", status: "running" }),
		);

		const response = await route.server.handlers.POST({
			request: syncRequest({ likedSongs: [], playlists: [] }),
		});

		expect(mockMarkStaleSyncJobs).toHaveBeenCalledWith(
			ACCOUNT_ID,
			"10 minutes",
		);
		expect(response.status).toBe(429);
		expect(mockCreateJob).not.toHaveBeenCalled();
	});

	it("fails sibling sync jobs when phase 1 (liked songs) fails", async () => {
		mockRunPhase.mockResolvedValueOnce(
			Result.err(new Error("liked songs blew up")),
		);

		const response = await route.server.handlers.POST({
			request: syncRequest({ likedSongs: [aTrack("t1")], playlists: [] }),
		});

		expect(response.status).toBe(500);
		expect(await response.json()).toMatchObject({
			error: "Liked songs sync failed: liked songs blew up",
		});
		// The route now only marks a phase settled after a confirmed terminal
		// lifecycle result, so it explicitly fails the current phase too if
		// runPhase returns an error.
		expect(mockFailJob).toHaveBeenCalledWith(SONGS_JOB, expect.any(String));
		expect(mockFailJob).toHaveBeenCalledWith(PLAYLISTS_JOB, expect.any(String));
		expect(mockFailJob).toHaveBeenCalledWith(TRACKS_JOB, expect.any(String));
	});

	it("fails the remaining sibling when phase 2 (playlists) fails", async () => {
		mockRunPhase
			.mockResolvedValueOnce(okLikedSongsPhase())
			.mockResolvedValueOnce(Result.err(new Error("playlist blew up")));

		const response = await route.server.handlers.POST({
			request: syncRequest({
				likedSongs: [aTrack("t1")],
				playlists: [aPlaylist("p1")],
			}),
		});

		expect(response.status).toBe(500);
		expect(await response.json()).toMatchObject({
			error: "Playlist sync failed: playlist blew up",
		});
		// Liked songs completed; playlists failed before reaching a confirmed
		// terminal success, so the route fails playlists + tracks.
		expect(mockFailJob).toHaveBeenCalledWith(PLAYLISTS_JOB, expect.any(String));
		expect(mockFailJob).toHaveBeenCalledWith(TRACKS_JOB, expect.any(String));
		expect(mockFailJob).not.toHaveBeenCalledWith(SONGS_JOB, expect.anything());
	});

	it("fails unsettled jobs when work throws after job creation", async () => {
		mockMapWithConcurrency.mockRejectedValue(new Error("unexpected explosion"));

		const response = await route.server.handlers.POST({
			request: syncRequest({
				likedSongs: [],
				playlists: [],
				playlistTracks: [{ playlistSpotifyId: "p1", tracks: [] }],
			}),
		});

		expect(response.status).toBe(500);
		expect(await response.json()).toMatchObject({
			ok: false,
			error: "sync_failed",
		});
		// Liked songs + playlists completed via their empty branches; phase 3
		// started but threw before completing, so only tracks is unsettled.
		expect(mockFailJob).toHaveBeenCalledWith(
			TRACKS_JOB,
			"unexpected explosion",
		);
	});

	it("surfaces a finalization failure instead of silently leaving jobs pending", async () => {
		mockCompleteJob.mockResolvedValueOnce(
			Result.err(new Error("db write failed")),
		);

		const response = await route.server.handlers.POST({
			request: syncRequest({ likedSongs: [], playlists: [] }),
		});

		expect(response.status).toBe(500);
		expect(await response.json()).toMatchObject({
			error: "Failed to finalize sync jobs",
		});
		// The liked-songs completion failed, so none of the three reached a
		// terminal state by the route's own hand — all get failed.
		expect(mockFailJob).toHaveBeenCalledWith(SONGS_JOB, expect.any(String));
		expect(mockFailJob).toHaveBeenCalledWith(PLAYLISTS_JOB, expect.any(String));
		expect(mockFailJob).toHaveBeenCalledWith(TRACKS_JOB, expect.any(String));
	});

	it("fails all created jobs when persisting phase ids throws after creation", async () => {
		mockUpdatePhaseJobIds.mockRejectedValueOnce(new Error("persist blew up"));

		const response = await route.server.handlers.POST({
			request: syncRequest({ likedSongs: [], playlists: [] }),
		});

		expect(response.status).toBe(500);
		expect(await response.json()).toMatchObject({
			ok: false,
			error: "sync_failed",
		});
		expect(mockFailJob).toHaveBeenCalledWith(SONGS_JOB, "persist blew up");
		expect(mockFailJob).toHaveBeenCalledWith(PLAYLISTS_JOB, "persist blew up");
		expect(mockFailJob).toHaveBeenCalledWith(TRACKS_JOB, "persist blew up");
	});

	it("fails already-created sibling jobs when the create batch is partial", async () => {
		mockCreateJob.mockImplementation((_accountId: string, type: string) =>
			type === PLAYLISTS_JOB
				? Promise.resolve(Result.err(new Error("insert failed")))
				: Promise.resolve(Result.ok({ id: type })),
		);

		const response = await route.server.handlers.POST({
			request: syncRequest({ likedSongs: [], playlists: [] }),
		});

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			error: "Failed to create sync jobs",
		});
		// The two jobs that did get created must be failed so they don't lock the
		// next attempt; the failed-to-create one has no row to clean up.
		expect(mockFailJob).toHaveBeenCalledWith(SONGS_JOB, expect.any(String));
		expect(mockFailJob).toHaveBeenCalledWith(TRACKS_JOB, expect.any(String));
		expect(mockFailJob).not.toHaveBeenCalledWith(
			PLAYLISTS_JOB,
			expect.anything(),
		);
	});
});
