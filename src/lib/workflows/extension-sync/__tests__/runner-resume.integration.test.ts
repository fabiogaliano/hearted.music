/**
 * Extension-sync crash recovery against the real job table and liked-song
 * writes: a worker that dies after its phases committed must not cost the
 * reclaiming run the library change those phases produced.
 *
 * Only the edges outside the job/library tables are mocked: the Storage
 * payload, the billing grant, and applyLibraryProcessingChange (captured so
 * the emitted change can be asserted, and hung once to model the crash).
 * The liked-songs read, or the return from its write, can be hung once too,
 * to model a crash mid-phase before or after the songs were written.
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
import { z } from "zod";
import {
	claimExtensionSyncJob,
	sweepStaleExtensionSyncJobs,
} from "@/lib/platform/jobs/extension-sync-jobs";
import type { Job } from "@/lib/platform/jobs/repository";

const {
	mockDownloadSyncPayload,
	mockApplyLibraryProcessingChange,
	hangNextLikedSongsRead,
	hangAfterNextLikedSongsWrite,
} = vi.hoisted(() => ({
	mockDownloadSyncPayload: vi.fn(),
	mockApplyLibraryProcessingChange: vi.fn(),
	hangNextLikedSongsRead: { current: false },
	hangAfterNextLikedSongsWrite: { current: false },
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

vi.mock("@/lib/domains/library/liked-songs/queries", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("@/lib/domains/library/liked-songs/queries")
		>();
	return {
		...actual,
		getAll: (accountId: string) => {
			if (hangNextLikedSongsRead.current) {
				hangNextLikedSongsRead.current = false;
				return new Promise(() => {});
			}
			return actual.getAll(accountId);
		},
		upsert: async (...args: Parameters<typeof actual.upsert>) => {
			const written = await actual.upsert(...args);
			if (hangAfterNextLikedSongsWrite.current) {
				hangAfterNextLikedSongsWrite.current = false;
				return new Promise(() => {});
			}
			return written;
		},
	};
});

vi.mock("@/lib/domains/billing/liked-song-access-grant", () => ({
	maybeGrantLikedSongAccessAfterSync: async () => undefined,
}));

const { runExtensionSyncJob } = await import("../runner");
const { runPhase } = await import("@/lib/workflows/spotify-sync/sync-helpers");

// A lease the heartbeat never reports lost.
const LIVE_LEASE = new AbortController().signal;

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
	hangNextLikedSongsRead.current = false;
	hangAfterNextLikedSongsWrite.current = false;
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
			void runExtensionSyncJob(crashed, "actor", LIVE_LEASE);
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

			const outcome = await runExtensionSyncJob(retry, "actor", LIVE_LEASE);

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

type Finish = (total: number) => void;

async function readPhase(
	id: string,
): Promise<{ status: string; attempts: number; progress: unknown }> {
	const [row] = await db()<
		{ status: string; attempts: number; progress: unknown }[]
	>`SELECT status, attempts, progress FROM job WHERE id = ${id}`;
	if (!row) throw new Error(`job ${id} missing`);
	return row;
}

describe.skipIf(!IS_LOCAL)(
	"crash inside the liked-songs phase (regression: the phase stayed running, so every reclaimed retry stopped as superseded until the parent was dead-lettered; then, once taken over, a crash after the songs were written left the retry's diff empty and the added change unemitted)",
	() => {
		it.each([
			{
				crashPoint: "before the songs were written",
				hang: hangNextLikedSongsRead,
				retryAdded: 2,
			},
			{
				crashPoint: "after the songs were written",
				hang: hangAfterNextLikedSongsWrite,
				retryAdded: 0,
			},
		])("crash $crashPoint: the retry takes over the stranded phase, finishes the sync, and emits the liked-songs change", async ({
			hang,
			retryAdded,
		}) => {
			const phaseJobIds = {
				liked_songs: await seedJob("sync_liked_songs"),
				playlists: await seedJob("sync_playlists"),
				playlist_tracks: await seedJob("sync_playlist_tracks"),
			};
			const parentId = await seedJob("extension_sync", {
				payload_path: `${account()}/p.json`,
				phase_job_ids: phaseJobIds,
			});

			// First run: the worker dies inside the liked-songs phase (modelled as
			// a library call that never returns).
			const crashed = await claim();
			expect(crashed.id).toBe(parentId);
			hang.current = true;
			void runExtensionSyncJob(crashed, "actor", LIVE_LEASE);
			// The hang clears its flag once it fires, i.e. once the crashed run's
			// read was issued or its write committed.
			await vi.waitFor(() => expect(hang.current).toBe(false), {
				timeout: 10_000,
			});
			expect((await readPhase(phaseJobIds.liked_songs)).status).toBe("running");

			await db()`UPDATE job SET heartbeat_at = now() - interval '10 minutes' WHERE id = ${parentId}`;
			const swept = await sweepStaleExtensionSyncJobs("5 minutes");
			if (Result.isError(swept)) throw swept.error;
			expect(swept.value.map((j) => j.id)).toContain(parentId);

			const retry = await claim();
			expect(retry.id).toBe(parentId);
			expect(retry.attempts).toBe(2);
			mockApplyLibraryProcessingChange.mockResolvedValueOnce(Result.ok({}));

			const outcome = await runExtensionSyncJob(retry, "actor", LIVE_LEASE);

			expect(outcome).toEqual({ status: "completed" });
			expect(mockApplyLibraryProcessingChange).toHaveBeenCalledOnce();
			expect(mockApplyLibraryProcessingChange).toHaveBeenCalledWith({
				kind: "library_synced",
				accountId: account(),
				changes: {
					likedSongs: { added: true, removed: true },
					targetPlaylists: {
						trackMembershipChanged: false,
						profileTextChanged: false,
						removed: false,
					},
				},
			});
			const likedPhase = await readPhase(phaseJobIds.liked_songs);
			expect(likedPhase.status).toBe("completed");
			expect(likedPhase.progress).toEqual({
				result: { total: 2, added: retryAdded, removed: 0, tookOver: true },
			});
			const [parent] = await db()<{ status: string }[]>`
        SELECT status FROM job WHERE id = ${parentId}
      `;
			expect(parent?.status).toBe("completed");
		});
	},
);

describe.skipIf(!IS_LOCAL)(
	"a taken-over phase is fenced on the parent attempt",
	() => {
		it("the older attempt's late completion is rejected and the new holder's result lands", async () => {
			const phaseId = await seedJob("sync_liked_songs");
			const TotalSchema = z.object({ total: z.number() });
			// Each run's phase work blocks until the test finishes it with a total.
			const finishers: { stale?: Finish; taker?: Finish } = {};
			const gatedWork = (who: "stale" | "taker") => () =>
				new Promise<Result<{ total: number }, never>>((resolve) => {
					finishers[who] = (total) => resolve(Result.ok({ total }));
				});

			const stale = runPhase(
				{ id: phaseId, attempts: 1 },
				TotalSchema,
				gatedWork("stale"),
			);
			await vi.waitFor(() => expect(finishers.stale).toBeDefined());
			expect(await readPhase(phaseId)).toMatchObject({
				status: "running",
				attempts: 1,
			});

			const taker = runPhase(
				{ id: phaseId, attempts: 2 },
				TotalSchema,
				gatedWork("taker"),
			);
			await vi.waitFor(() => expect(finishers.taker).toBeDefined());
			expect(await readPhase(phaseId)).toMatchObject({
				status: "running",
				attempts: 2,
			});

			finishers.stale?.(1);
			expect(await stale).toHaveOkValue({ status: "superseded" });
			expect(await readPhase(phaseId)).toMatchObject({
				status: "running",
				attempts: 2,
			});

			finishers.taker?.(2);
			expect(await taker).toHaveOkValue({
				status: "completed",
				value: { total: 2 },
			});
			expect(await readPhase(phaseId)).toMatchObject({
				status: "completed",
				attempts: 2,
				progress: { result: { total: 2 } },
			});
		});
	},
);
