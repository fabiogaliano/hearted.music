import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@/lib/platform/jobs/repository";
import { DatabaseError } from "@/lib/shared/errors/database";

const {
	mockDownloadSyncPayload,
	mockDeleteSyncPayload,
	mockCreateAdminSupabaseClient,
	mockGetAll,
	mockGetPlaylists,
	mockGetTargetPlaylists,
	mockCompleteJob,
	mockFailJob,
	mockStartJob,
	mockRunPhase,
	mockInitialSync,
	mockIncrementalSync,
	mockSyncPlaylists,
	mockSyncPlaylistTracksFromData,
	mockApplyLibraryProcessingChange,
	mockLibrarySynced,
	mockMaybeGrant,
	mockMapWithConcurrency,
} = vi.hoisted(() => ({
	mockDownloadSyncPayload: vi.fn(),
	mockDeleteSyncPayload: vi.fn(),
	mockCreateAdminSupabaseClient: vi.fn(),
	mockGetAll: vi.fn(),
	mockGetPlaylists: vi.fn(),
	mockGetTargetPlaylists: vi.fn(),
	mockCompleteJob: vi.fn(),
	mockFailJob: vi.fn(),
	mockStartJob: vi.fn(),
	mockRunPhase: vi.fn(),
	mockInitialSync: vi.fn(),
	mockIncrementalSync: vi.fn(),
	mockSyncPlaylists: vi.fn(),
	mockSyncPlaylistTracksFromData: vi.fn(),
	mockApplyLibraryProcessingChange: vi.fn(),
	mockLibrarySynced: vi.fn(),
	mockMaybeGrant: vi.fn(),
	mockMapWithConcurrency: vi.fn(),
}));

vi.mock("@/lib/observability/logger", () => ({
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/workflows/extension-sync/payload-storage", () => ({
	downloadSyncPayload: (...a: unknown[]) => mockDownloadSyncPayload(...a),
	deleteSyncPayload: (...a: unknown[]) => mockDeleteSyncPayload(...a),
}));

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: (...a: unknown[]) =>
		mockCreateAdminSupabaseClient(...a),
}));

vi.mock("@/lib/domains/library/liked-songs/queries", () => ({
	getAll: (...a: unknown[]) => mockGetAll(...a),
}));

vi.mock("@/lib/domains/library/playlists/queries", () => ({
	getPlaylists: (...a: unknown[]) => mockGetPlaylists(...a),
	getTargetPlaylists: (...a: unknown[]) => mockGetTargetPlaylists(...a),
}));

vi.mock("@/lib/platform/jobs/lifecycle", () => ({
	completeJob: (...a: unknown[]) => mockCompleteJob(...a),
	failJob: (...a: unknown[]) => mockFailJob(...a),
	startJob: (...a: unknown[]) => mockStartJob(...a),
}));

vi.mock("@/lib/workflows/spotify-sync/sync-helpers", () => ({
	runPhase: (...a: unknown[]) => mockRunPhase(...a),
	initialSync: (...a: unknown[]) => mockInitialSync(...a),
	incrementalSync: (...a: unknown[]) => mockIncrementalSync(...a),
}));

vi.mock("@/lib/workflows/spotify-sync/playlist-sync", () => ({
	syncPlaylists: (...a: unknown[]) => mockSyncPlaylists(...a),
	syncPlaylistTracksFromData: (...a: unknown[]) =>
		mockSyncPlaylistTracksFromData(...a),
}));

vi.mock("@/lib/workflows/library-processing/service", () => ({
	applyLibraryProcessingChange: (...a: unknown[]) =>
		mockApplyLibraryProcessingChange(...a),
}));

vi.mock("@/lib/workflows/library-processing/changes", () => ({
	SyncChanges: { librarySynced: (...a: unknown[]) => mockLibrarySynced(...a) },
}));

vi.mock("@/lib/domains/billing/liked-song-access-grant", () => ({
	maybeGrantLikedSongAccessAfterSync: (...a: unknown[]) => mockMaybeGrant(...a),
}));

vi.mock("@/lib/shared/utils/concurrency", () => ({
	mapWithConcurrency: (...a: unknown[]) => mockMapWithConcurrency(...a),
}));

const { runExtensionSyncJob } = await import("../runner");

const ACCOUNT_ID = "acct-1";
const PARENT_ID = "parent-1";
const PAYLOAD_PATH = "acct-1/p.json";
const PHASE_JOB_IDS = {
	liked_songs: "11111111-1111-4111-8111-111111111111",
	playlists: "22222222-2222-4222-8222-222222222222",
	playlist_tracks: "33333333-3333-4333-8333-333333333333",
};

function parentJob(progress: unknown): Job {
	return {
		id: PARENT_ID,
		account_id: ACCOUNT_ID,
		type: "extension_sync",
		status: "running",
		progress,
		error: null,
		attempts: 1,
		max_attempts: 3,
		queue_priority: null,
		satisfies_requested_at: null,
		heartbeat_at: null,
		started_at: new Date().toISOString(),
		completed_at: null,
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
	} as Job;
}

function validProgress(): unknown {
	return {
		payload_path: PAYLOAD_PATH,
		payload_bytes: 100,
		phase_job_ids: PHASE_JOB_IDS,
	};
}

// Builds a minimal supabase mock that returns preset results for two concurrent
// account SELECT queries inside applyUserProfile.
function makeSupabaseMock(
	opts: {
		conflictAccount?: { id: string } | null;
		currentAccount?: {
			spotify_id: string | null;
			better_auth_user_id: string | null;
		} | null;
		updateError?: { message: string } | null;
	} = {},
) {
	const conflictResult = {
		data: opts.conflictAccount ?? null,
		error: null,
	};
	const currentResult = {
		data: opts.currentAccount ?? {
			spotify_id: null,
			better_auth_user_id: null,
		},
		error: null,
	};
	const updateResult = { error: opts.updateError ?? null };

	// Tracks how many SELECT calls have been made to distinguish the two parallel
	// selects (conflict vs. current account) by call order.
	let selectCount = 0;

	const maybeSingle = vi.fn().mockResolvedValue(conflictResult);
	const single = vi.fn().mockResolvedValue(currentResult);

	const selectConflict = vi.fn().mockReturnValue({
		eq: vi
			.fn()
			.mockReturnValue({ neq: vi.fn().mockReturnValue({ maybeSingle }) }),
	});
	const selectCurrent = vi.fn().mockReturnValue({
		eq: vi.fn().mockReturnValue({ single }),
	});

	const updateChain = {
		eq: vi.fn().mockResolvedValue(updateResult),
	};
	const updateFn = vi.fn().mockReturnValue(updateChain);

	const fromFn = vi.fn().mockImplementation(() => {
		// applyUserProfile issues two parallel SELECTs then possibly one UPDATE.
		// Round-robin: first call = conflict select, second = current, third = update.
		const call = ++selectCount;
		if (call === 3) return { update: updateFn };
		return call === 1 ? { select: selectConflict } : { select: selectCurrent };
	});

	return { from: fromFn, updateFn, updateChain, _updateResult: updateResult };
}

describe("runExtensionSyncJob", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCreateAdminSupabaseClient.mockReturnValue({ id: "admin" });
		mockDeleteSyncPayload.mockResolvedValue(Result.ok(undefined));
		mockCompleteJob.mockResolvedValue(Result.ok({ id: "j" }));
		mockFailJob.mockResolvedValue(Result.ok({ id: "j" }));
		mockStartJob.mockResolvedValue(Result.ok({ id: "j" }));
		mockGetAll.mockResolvedValue(Result.ok([]));
		mockGetPlaylists.mockResolvedValue(Result.ok([]));
		mockGetTargetPlaylists.mockResolvedValue(Result.ok([]));
		mockApplyLibraryProcessingChange.mockResolvedValue(Result.ok({}));
		mockLibrarySynced.mockReturnValue({ kind: "library_synced" });
		mockMaybeGrant.mockResolvedValue(undefined);
		mockMapWithConcurrency.mockResolvedValue([]);
	});

	it("completes an empty-payload sync and deletes the staged object", async () => {
		mockDownloadSyncPayload.mockResolvedValue(
			Result.ok(JSON.stringify({ likedSongs: [], playlists: [] })),
		);

		const outcome = await runExtensionSyncJob(
			parentJob(validProgress()),
			"actor",
		);

		expect(outcome).toEqual({ status: "completed" });
		// All three phase jobs completed via their empty branches, then the parent.
		expect(mockCompleteJob).toHaveBeenCalledWith(PHASE_JOB_IDS.liked_songs);
		expect(mockCompleteJob).toHaveBeenCalledWith(PHASE_JOB_IDS.playlists);
		expect(mockCompleteJob).toHaveBeenCalledWith(PHASE_JOB_IDS.playlist_tracks);
		expect(mockCompleteJob).toHaveBeenCalledWith(PARENT_ID);
		expect(mockApplyLibraryProcessingChange).toHaveBeenCalledOnce();
		expect(mockMaybeGrant).toHaveBeenCalledWith({ id: "admin" }, ACCOUNT_ID, {
			onOperationalError: expect.any(Function),
		});
		expect(mockDeleteSyncPayload).toHaveBeenCalledWith(
			{ id: "admin" },
			PAYLOAD_PATH,
		);
		expect(mockFailJob).not.toHaveBeenCalled();
	});

	it("fails only the parent when the job progress is malformed", async () => {
		const outcome = await runExtensionSyncJob(
			parentJob({ nonsense: true }),
			"actor",
		);

		expect(outcome.status).toBe("failed");
		expect(mockFailJob).toHaveBeenCalledWith(PARENT_ID, expect.any(String));
		// No payload pointer recoverable → nothing downloaded or deleted.
		expect(mockDownloadSyncPayload).not.toHaveBeenCalled();
	});

	it("fails phases + parent and deletes the object when download fails", async () => {
		mockDownloadSyncPayload.mockResolvedValue(
			Result.err(new DatabaseError({ code: "storage", message: "missing" })),
		);

		const outcome = await runExtensionSyncJob(
			parentJob(validProgress()),
			"actor",
		);

		expect(outcome.status).toBe("failed");
		expect(mockFailJob).toHaveBeenCalledWith(
			PHASE_JOB_IDS.liked_songs,
			expect.any(String),
		);
		expect(mockFailJob).toHaveBeenCalledWith(
			PHASE_JOB_IDS.playlists,
			expect.any(String),
		);
		expect(mockFailJob).toHaveBeenCalledWith(
			PHASE_JOB_IDS.playlist_tracks,
			expect.any(String),
		);
		expect(mockFailJob).toHaveBeenCalledWith(PARENT_ID, expect.any(String));
		expect(mockDeleteSyncPayload).toHaveBeenCalledWith(
			{ id: "admin" },
			PAYLOAD_PATH,
		);
	});

	it("fails when the downloaded payload does not match the schema", async () => {
		mockDownloadSyncPayload.mockResolvedValue(
			Result.ok(JSON.stringify({ likedSongs: "not-an-array" })),
		);

		const outcome = await runExtensionSyncJob(
			parentJob(validProgress()),
			"actor",
		);

		expect(outcome.status).toBe("failed");
		expect(mockFailJob).toHaveBeenCalledWith(PARENT_ID, expect.any(String));
		expect(mockDeleteSyncPayload).toHaveBeenCalledWith(
			{ id: "admin" },
			PAYLOAD_PATH,
		);
		// Validation failed before any phase ran.
		expect(mockCompleteJob).not.toHaveBeenCalled();
	});

	it("fails unsettled phases + parent when a phase errors", async () => {
		mockDownloadSyncPayload.mockResolvedValue(
			Result.ok(
				JSON.stringify({
					likedSongs: [
						{
							added_at: "2026-01-01T00:00:00Z",
							track: {
								id: "t1",
								name: "n",
								artists: [{ id: "a1", name: "A" }],
								album: { id: "al1", name: "Al", images: [] },
								duration_ms: 1,
								uri: "spotify:track:t1",
							},
						},
					],
					playlists: [],
				}),
			),
		);
		mockRunPhase.mockResolvedValue(Result.err(new Error("liked blew up")));

		const outcome = await runExtensionSyncJob(
			parentJob(validProgress()),
			"actor",
		);

		expect(outcome).toEqual({
			status: "failed",
			error: "Liked songs sync failed: liked blew up",
		});
		// liked_songs phase was driven by runPhase (settles itself); the unsettled
		// siblings + parent are failed.
		expect(mockFailJob).toHaveBeenCalledWith(
			PHASE_JOB_IDS.playlists,
			expect.any(String),
		);
		expect(mockFailJob).toHaveBeenCalledWith(
			PHASE_JOB_IDS.playlist_tracks,
			expect.any(String),
		);
		expect(mockFailJob).toHaveBeenCalledWith(PARENT_ID, expect.any(String));
		expect(mockDeleteSyncPayload).toHaveBeenCalledWith(
			{ id: "admin" },
			PAYLOAD_PATH,
		);
	});

	it("fails the sync when the account profile DB update errors", async () => {
		const supabaseMock = makeSupabaseMock({
			currentAccount: { spotify_id: null, better_auth_user_id: null },
			updateError: { message: "db update failed" },
		});
		mockCreateAdminSupabaseClient.mockReturnValue(supabaseMock);

		const payloadWithProfile = JSON.stringify({
			likedSongs: [],
			playlists: [],
			userProfile: {
				spotifyId: "spotify-user-123",
				displayName: "Test User",
			},
		});
		mockDownloadSyncPayload.mockResolvedValue(Result.ok(payloadWithProfile));

		const outcome = await runExtensionSyncJob(
			parentJob(validProgress()),
			"actor",
		);

		expect(outcome.status).toBe("failed");
		expect(outcome).toMatchObject({
			status: "failed",
			error: expect.stringContaining("Failed to update account profile"),
		});
		expect(mockFailJob).toHaveBeenCalledWith(PARENT_ID, expect.any(String));
		expect(mockDeleteSyncPayload).toHaveBeenCalled();
	});

	it("completes normally when the account profile update succeeds", async () => {
		const supabaseMock = makeSupabaseMock({
			currentAccount: { spotify_id: null, better_auth_user_id: null },
			updateError: null,
		});
		mockCreateAdminSupabaseClient.mockReturnValue(supabaseMock);

		const payloadWithProfile = JSON.stringify({
			likedSongs: [],
			playlists: [],
			userProfile: {
				spotifyId: "spotify-user-456",
				displayName: "Another User",
			},
		});
		mockDownloadSyncPayload.mockResolvedValue(Result.ok(payloadWithProfile));

		const outcome = await runExtensionSyncJob(
			parentJob(validProgress()),
			"actor",
		);

		expect(outcome.status).toBe("completed");
		expect(mockCompleteJob).toHaveBeenCalledWith(PARENT_ID);
		expect(mockFailJob).not.toHaveBeenCalled();
	});
});
