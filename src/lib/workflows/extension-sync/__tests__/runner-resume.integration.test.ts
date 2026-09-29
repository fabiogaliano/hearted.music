/**
 * Extension-sync crash recovery against the real job table and liked-song
 * writes: a worker that dies after its phases committed must not cost the
 * reclaiming run the library change those phases produced.
 *
 * Only the edges outside the job/library tables are mocked: the Storage
 * payload, the billing grant, and applyLibraryProcessingChange (captured so
 * the emitted change can be asserted, and hung once to model the crash).
 * Auto-skipped unless DATABASE_URL and SUPABASE_URL point at the local stack.
 */

import { Result } from "better-result";
import postgres from "postgres";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	claimExtensionSyncJob,
	sweepStaleExtensionSyncJobs,
} from "@/lib/platform/jobs/extension-sync-jobs";
import type { Job } from "@/lib/platform/jobs/repository";

const { mockDownloadSyncPayload, mockApplyLibraryProcessingChange } =
	vi.hoisted(() => ({
		mockDownloadSyncPayload: vi.fn(),
		mockApplyLibraryProcessingChange: vi.fn(),
	}));

vi.mock("@sentry/bun", () => ({ captureException: vi.fn() }));

vi.mock("@/lib/workflows/extension-sync/payload-storage", () => ({
	downloadSyncPayload: (...a: unknown[]) => mockDownloadSyncPayload(...a),
	deleteSyncPayload: async () => Result.ok(undefined),
}));

vi.mock("@/lib/workflows/library-processing/service", () => ({
	applyLibraryProcessingChange: (...a: unknown[]) =>
		mockApplyLibraryProcessingChange(...a),
}));

vi.mock("@/lib/domains/billing/liked-song-access-grant", () => ({
	maybeGrantLikedSongAccessAfterSync: async () => undefined,
}));

const { runExtensionSyncJob } = await import("../runner");

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const IS_LOCAL =
	(DATABASE_URL.includes("127.0.0.1") || DATABASE_URL.includes("localhost")) &&
	SUPABASE_URL.startsWith("http://127.0.0.1");

const sql = IS_LOCAL
	? postgres(DATABASE_URL, { prepare: false, max: 2, fetch_types: false })
	: null;

function db() {
	if (!sql) throw new Error("postgres client not initialised");
	return sql;
}

let accountId: string | null = null;
let trackIds: string[] = [];

function account(): string {
	if (!accountId) throw new Error("fixture not seeded");
	return accountId;
}

async function seedJob(
	type:
		| "extension_sync"
		| "sync_liked_songs"
		| "sync_playlists"
		| "sync_playlist_tracks",
	progress: object = {},
): Promise<string> {
	const id = crypto.randomUUID();
	// Ancient created_at so the global claim picks this parent over unrelated rows.
	await db()`
    INSERT INTO job(id, account_id, type, status, attempts, max_attempts, created_at, progress)
    VALUES (${id}, ${account()}, ${type}, 'pending', 0, 3, '2000-01-01T00:00:00Z', ${db().json(progress as never)})
  `;
	return id;
}

async function claim(): Promise<Job> {
	const claimed = await claimExtensionSyncJob();
	if (Result.isError(claimed)) throw claimed.error;
	if (!claimed.value) throw new Error("nothing claimable");
	return claimed.value;
}

function likedTrack(id: string) {
	return {
		added_at: "2026-01-01T00:00:00Z",
		track: {
			id,
			name: `Song ${id}`,
			artists: [{ id: `artist-${id}`, name: "Artist" }],
			album: { id: `album-${id}`, name: "Album", images: [] },
			duration_ms: 1000,
			uri: `spotify:track:${id}`,
		},
	};
}

beforeEach(async () => {
	if (!IS_LOCAL) return;
	accountId = crypto.randomUUID();
	trackIds = [crypto.randomUUID(), crypto.randomUUID()].map((u) => `test-${u}`);
	await db()`INSERT INTO account(id, spotify_id) VALUES (${accountId}, ${`test-${accountId}`})`;
	mockDownloadSyncPayload.mockResolvedValue(
		Result.ok(
			new TextEncoder().encode(
				JSON.stringify({
					likedSongs: trackIds.map(likedTrack),
					playlists: [],
				}),
			),
		),
	);
});

afterEach(async () => {
	vi.clearAllMocks();
	if (!IS_LOCAL || !accountId) return;
	await db()`DELETE FROM account WHERE id = ${accountId}`;
	await db()`DELETE FROM song WHERE spotify_id IN ${db()(trackIds)}`;
	await db()`DELETE FROM artist WHERE spotify_id IN ${db()(trackIds.map((t) => `artist-${t}`))}`;
	accountId = null;
});

afterAll(async () => {
	await sql?.end();
});

describe.skipIf(!IS_LOCAL)(
	"crash after the liked-songs phase (regression: the reclaimed retry found the phase completed and failed the sync, dropping the added-songs change)",
	() => {
		it("retry resumes from the completed phases and still emits the added change", async () => {
			const phaseJobIds = {
				liked_songs: await seedJob("sync_liked_songs"),
				playlists: await seedJob("sync_playlists"),
				playlist_tracks: await seedJob("sync_playlist_tracks"),
			};
			const parentId = await seedJob("extension_sync", {
				payload_path: `${account()}/p.json`,
				phase_job_ids: phaseJobIds,
			});

			// First run: every phase commits, then the worker dies inside the
			// library-processing apply (modelled as a call that never returns).
			const crashed = await claim();
			expect(crashed.id).toBe(parentId);
			mockApplyLibraryProcessingChange.mockReturnValueOnce(
				new Promise(() => {}),
			);
			void runExtensionSyncJob(crashed, "actor");
			await vi.waitFor(
				() => expect(mockApplyLibraryProcessingChange).toHaveBeenCalledOnce(),
				{ timeout: 10_000 },
			);

			await db()`UPDATE job SET heartbeat_at = now() - interval '10 minutes' WHERE id = ${parentId}`;
			const swept = await sweepStaleExtensionSyncJobs("5 minutes");
			if (Result.isError(swept)) throw swept.error;
			expect(swept.value.map((j) => j.id)).toContain(parentId);

			const retry = await claim();
			expect(retry.id).toBe(parentId);
			expect(retry.attempts).toBe(2);
			mockApplyLibraryProcessingChange.mockResolvedValueOnce(Result.ok({}));

			const outcome = await runExtensionSyncJob(retry, "actor");

			expect(outcome).toEqual({ status: "completed" });
			expect(mockApplyLibraryProcessingChange).toHaveBeenCalledTimes(2);
			expect(mockApplyLibraryProcessingChange).toHaveBeenLastCalledWith({
				kind: "library_synced",
				accountId: account(),
				changes: {
					likedSongs: { added: true, removed: false },
					targetPlaylists: {
						trackMembershipChanged: false,
						profileTextChanged: false,
						removed: false,
					},
				},
			});
			const [parent] = await db()<{ status: string }[]>`
        SELECT status FROM job WHERE id = ${parentId}
      `;
			expect(parent?.status).toBe("completed");
		});
	},
);
