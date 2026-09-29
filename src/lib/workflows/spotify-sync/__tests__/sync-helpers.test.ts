import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { LikedSong } from "@/lib/domains/library/liked-songs/queries";
import type { Song } from "@/lib/domains/library/songs/queries";
import { DatabaseError } from "@/lib/shared/errors/database";
import { SyncFailedError } from "@/lib/shared/errors/domain/sync";
import { makeJob } from "@/test/fixtures";
import type { SpotifyTrackDTO } from "../types";

const mockStartJob = vi.fn();
const mockTakeOverJob = vi.fn();
const mockCompleteJob = vi.fn();
const mockSettleClaimedJob = vi.fn();
const mockGetJobById = vi.fn();

vi.mock("@/lib/platform/jobs/lifecycle", () => ({
	startJob: (...args: unknown[]) => mockStartJob(...args),
	takeOverJob: (...args: unknown[]) => mockTakeOverJob(...args),
	completeJob: (...args: unknown[]) => mockCompleteJob(...args),
	settleClaimedJob: (...args: unknown[]) => mockSettleClaimedJob(...args),
}));

vi.mock("@/lib/platform/jobs/repository", () => ({
	getJobById: (...args: unknown[]) => mockGetJobById(...args),
}));

const mockGetByIds = vi.fn();
const mockUpsertCatalog = vi.fn();
const mockUpsertArtists = vi.fn();
const mockUpsertLikedSongs = vi.fn();
const mockSoftDeleteBatch = vi.fn();

vi.mock("@/lib/domains/library/songs/queries", () => ({
	getByIds: (...args: unknown[]) => mockGetByIds(...args),
	upsertCatalog: (...args: unknown[]) => mockUpsertCatalog(...args),
}));

vi.mock("@/lib/domains/library/artists/queries", () => ({
	upsert: (...args: unknown[]) => mockUpsertArtists(...args),
}));

vi.mock("@/lib/domains/library/liked-songs/queries", () => ({
	upsert: (...args: unknown[]) => mockUpsertLikedSongs(...args),
	softDeleteBatch: (...args: unknown[]) => mockSoftDeleteBatch(...args),
}));

const { importSpotifyTracks, runPhase, incrementalSync } = await import(
	"../sync-helpers"
);

const ACCOUNT_ID = "acct-1";
const SONG_ID = "song-x";
const SPOTIFY_ID = "spotify-x";

function makeTrack(
	addedAt: string,
	artistOverrides?: Partial<SpotifyTrackDTO["track"]["artists"][number]>,
): SpotifyTrackDTO {
	return {
		added_at: addedAt,
		track: {
			id: SPOTIFY_ID,
			name: "Song X",
			artists: [{ id: "artist-1", name: "Artist X", ...artistOverrides }],
			album: {
				id: "album-1",
				name: "Album X",
				images: [{ url: "https://img/x.jpg", width: 300, height: 300 }],
			},
			duration_ms: 210_000,
			uri: `spotify:track:${SPOTIFY_ID}`,
		},
	} as SpotifyTrackDTO;
}

function makeSong(): Song {
	return { id: SONG_ID, spotify_id: SPOTIFY_ID } as Song;
}

function makeLikedSong(unlikedAt: string | null): LikedSong {
	return {
		account_id: ACCOUNT_ID,
		song_id: SONG_ID,
		liked_at: "2026-01-01T00:00:00.000Z",
		unliked_at: unlikedAt,
	} as LikedSong;
}

describe("runPhase", () => {
	const TotalSchema = z.object({ total: z.number() });
	// The phase job leased under the parent's second claim attempt.
	const PHASE = { id: "job-1", attempts: 2 };

	beforeEach(() => {
		vi.clearAllMocks();
		mockStartJob.mockResolvedValue(Result.ok("applied"));
		mockTakeOverJob.mockResolvedValue(Result.ok("applied"));
		mockCompleteJob.mockResolvedValue(Result.ok("applied"));
		mockSettleClaimedJob.mockResolvedValue(Result.ok("applied"));
	});

	it("persists the phase result on the completing write so a retry can reuse it", async () => {
		const result = await runPhase(PHASE, TotalSchema, async () =>
			Result.ok({ total: 3 }),
		);

		expect(result).toHaveOkValue({ status: "completed", value: { total: 3 } });
		expect(mockCompleteJob).toHaveBeenCalledWith(PHASE, {
			result: { total: 3 },
		});
	});

	it("returns an error when completeJob fails instead of silently succeeding", async () => {
		const completeError = new DatabaseError({
			code: "db_error",
			message: "complete failed",
		});
		mockCompleteJob.mockResolvedValueOnce(Result.err(completeError));

		const result = await runPhase(PHASE, TotalSchema, async () =>
			Result.ok({ total: 1 }),
		);

		expect(result).toHaveErrValue(completeError);
	});

	describe("a phase job that already left pending (regression: a superseded startJob was ignored and the sync ran anyway; then a crash-resumed sync failed on its own completed phase)", () => {
		it("completed: reuses the persisted result without redoing the work", async () => {
			mockStartJob.mockResolvedValueOnce(Result.ok("superseded"));
			mockGetJobById.mockResolvedValueOnce(
				Result.ok(
					makeJob({
						id: "job-1",
						status: "completed",
						progress: { result: { total: 7 } },
					}),
				),
			);
			const syncFn = vi.fn(async () => Result.ok({ total: 1 }));

			const result = await runPhase(PHASE, TotalSchema, syncFn);

			expect(result).toHaveOkValue({
				status: "completed",
				value: { total: 7 },
			});
			expect(syncFn).not.toHaveBeenCalled();
			expect(mockCompleteJob).not.toHaveBeenCalled();
		});

		it.each([
			["the same", 2],
			["a newer", 3],
		])("running under %s parent attempt: that run owns it, so this one is superseded and touches nothing", async (_label, holder) => {
			mockStartJob.mockResolvedValueOnce(Result.ok("superseded"));
			mockGetJobById.mockResolvedValueOnce(
				Result.ok(
					makeJob({ id: "job-1", status: "running", attempts: holder }),
				),
			);
			const syncFn = vi.fn(async () => Result.ok({ total: 1 }));

			const result = await runPhase(PHASE, TotalSchema, syncFn);

			expect(result).toHaveOkValue({ status: "superseded" });
			expect(mockTakeOverJob).not.toHaveBeenCalled();
			expect(syncFn).not.toHaveBeenCalled();
			expect(mockCompleteJob).not.toHaveBeenCalled();
			expect(mockSettleClaimedJob).not.toHaveBeenCalled();
		});

		// 0 is a phase started before phases recorded their parent attempt.
		it.each([
			["an older", 1],
			["no recorded", 0],
		])("running under %s parent attempt (regression: a phase stranded by a crashed attempt stopped every retry as superseded): takes it over and re-runs the work", async (_label, holder) => {
			mockStartJob.mockResolvedValueOnce(Result.ok("superseded"));
			mockGetJobById.mockResolvedValueOnce(
				Result.ok(
					makeJob({ id: "job-1", status: "running", attempts: holder }),
				),
			);
			const syncFn = vi.fn(async () => Result.ok({ total: 4 }));

			const result = await runPhase(PHASE, TotalSchema, syncFn);

			expect(result).toHaveOkValue({
				status: "completed",
				value: { total: 4 },
			});
			expect(mockTakeOverJob).toHaveBeenCalledWith(PHASE);
			expect(mockCompleteJob).toHaveBeenCalledWith(PHASE, {
				result: { total: 4 },
			});
		});

		it("running under an older attempt that settles it before the takeover lands: reuses the settled result", async () => {
			mockStartJob.mockResolvedValueOnce(Result.ok("superseded"));
			mockGetJobById
				.mockResolvedValueOnce(
					Result.ok(makeJob({ id: "job-1", status: "running", attempts: 1 })),
				)
				.mockResolvedValueOnce(
					Result.ok(
						makeJob({
							id: "job-1",
							status: "completed",
							attempts: 1,
							progress: { result: { total: 7 } },
						}),
					),
				);
			mockTakeOverJob.mockResolvedValueOnce(Result.ok("superseded"));
			const syncFn = vi.fn(async () => Result.ok({ total: 1 }));

			const result = await runPhase(PHASE, TotalSchema, syncFn);

			expect(result).toHaveOkValue({
				status: "completed",
				value: { total: 7 },
			});
			expect(syncFn).not.toHaveBeenCalled();
			expect(mockCompleteJob).not.toHaveBeenCalled();
		});

		it("failed: cannot be re-run, so the phase's own error is returned", async () => {
			mockStartJob.mockResolvedValueOnce(Result.ok("superseded"));
			mockGetJobById.mockResolvedValueOnce(
				Result.ok(
					makeJob({ id: "job-1", status: "failed", error: "spotify exploded" }),
				),
			);
			const syncFn = vi.fn(async () => Result.ok({ total: 1 }));

			const result = await runPhase(PHASE, TotalSchema, syncFn);

			expect(result).toBeErr();
			if (Result.isOk(result)) throw new Error("expected an error");
			expect(result.error.message).toMatch(/spotify exploded/);
			expect(syncFn).not.toHaveBeenCalled();
		});
	});

	it("is superseded when its completing write loses the fence (regression: a lost phase completion was ignored and the run carried on)", async () => {
		mockCompleteJob.mockResolvedValueOnce(Result.ok("superseded"));

		const result = await runPhase(PHASE, TotalSchema, async () =>
			Result.ok({ total: 1 }),
		);

		expect(result).toHaveOkValue({ status: "superseded" });
	});

	it("is superseded when its failing write loses the fence", async () => {
		mockSettleClaimedJob.mockResolvedValueOnce(Result.ok("superseded"));

		const result = await runPhase(PHASE, TotalSchema, async () =>
			Result.err(new SyncFailedError("liked_songs", "acct-1", "boom")),
		);

		expect(result).toHaveOkValue({ status: "superseded" });
	});

	it("returns a lifecycle error when the failing write errors", async () => {
		const syncError = new SyncFailedError(
			"liked_songs",
			"acct-1",
			"spotify exploded",
		);
		const cleanupError = new DatabaseError({
			code: "db_error",
			message: "fail cleanup failed",
		});
		mockSettleClaimedJob.mockResolvedValueOnce(Result.err(cleanupError));

		const result = await runPhase(PHASE, TotalSchema, async () =>
			Result.err(syncError),
		);

		expect(result).toHaveErrValue(cleanupError);
		expect(mockSettleClaimedJob).toHaveBeenCalledWith(
			PHASE,
			"failed",
			syncError.message,
		);
	});
});

describe("importSpotifyTracks", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUpsertCatalog.mockResolvedValue(Result.ok([makeSong()]));
		mockUpsertArtists.mockResolvedValue(Result.ok([]));
	});

	it("ignores release_year_checked by default so playlist imports cannot stamp checked_at", async () => {
		const track = makeTrack("2026-03-01T00:00:00.000Z") as SpotifyTrackDTO;
		track.track.release_year_checked = true;

		const result = await importSpotifyTracks([track]);

		expect(Result.isOk(result)).toBe(true);
		expect(mockUpsertCatalog).toHaveBeenCalledWith([
			expect.not.objectContaining({
				release_year_checked_at: expect.any(String),
			}),
		]);
	});

	it("honors release_year_checked for liked-song imports that opt in", async () => {
		const track = makeTrack("2026-03-01T00:00:00.000Z") as SpotifyTrackDTO;
		track.track.release_year_checked = true;

		const result = await importSpotifyTracks([track], {
			honorReleaseYearChecked: true,
		});

		expect(Result.isOk(result)).toBe(true);
		expect(mockUpsertCatalog).toHaveBeenCalledWith([
			expect.objectContaining({
				release_year_checked_at: expect.any(String),
			}),
		]);
	});
});

describe("incrementalSync", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetByIds.mockResolvedValue(Result.ok([makeSong()]));
		mockUpsertCatalog.mockResolvedValue(Result.ok([makeSong()]));
		mockUpsertArtists.mockResolvedValue(Result.ok([]));
		mockUpsertLikedSongs.mockResolvedValue(Result.ok([]));
		mockSoftDeleteBatch.mockResolvedValue(Result.ok([]));
	});

	// Full lifecycle: like → sync → unlike → sync → re-like → sync. The third
	// sync is the regression: an unliked-then-re-liked song must be restored, not
	// silently lost from the library.
	it("restores a re-liked song that was previously unliked", async () => {
		const track = makeTrack("2026-03-01T00:00:00.000Z");

		const result = await incrementalSync(ACCOUNT_ID, {
			likedSongs: [track],
			// The row exists but is soft-deleted: the user unliked it on a prior
			// sync and has now re-liked it.
			existingLikedSongs: [makeLikedSong("2026-02-01T00:00:00.000Z")],
			likedSongsIds: new Set([SPOTIFY_ID]),
		});

		expect(Result.isOk(result)).toBe(true);
		if (Result.isError(result)) {
			throw new Error("expected ok");
		}

		expect(result.value.added).toBe(1);
		expect(result.value.removed).toBe(0);
		// Routed through the import path, so the self-healing upsert runs for it.
		expect(mockUpsertLikedSongs).toHaveBeenCalledWith(ACCOUNT_ID, [
			{ song_id: SONG_ID, liked_at: "2026-03-01T00:00:00.000Z" },
		]);
		// And it is not mistaken for a removal.
		expect(mockSoftDeleteBatch).not.toHaveBeenCalled();
	});

	it("does not re-add a song that is already actively liked", async () => {
		const track = makeTrack("2026-01-01T00:00:00.000Z");

		const result = await incrementalSync(ACCOUNT_ID, {
			likedSongs: [track],
			existingLikedSongs: [makeLikedSong(null)],
			likedSongsIds: new Set([SPOTIFY_ID]),
		});

		expect(Result.isOk(result)).toBe(true);
		if (Result.isError(result)) {
			throw new Error("expected ok");
		}

		expect(result.value.added).toBe(0);
		expect(result.value.removed).toBe(0);
		expect(mockUpsertLikedSongs).not.toHaveBeenCalled();
		expect(mockSoftDeleteBatch).not.toHaveBeenCalled();
	});

	it("omits null artist metadata so cached images and bios are preserved", async () => {
		const track = makeTrack("2026-03-02T00:00:00.000Z", {
			imageUrl: null,
			bio: null,
		});

		const result = await incrementalSync(ACCOUNT_ID, {
			likedSongs: [track],
			existingLikedSongs: [],
			likedSongsIds: new Set([SPOTIFY_ID]),
		});

		expect(Result.isOk(result)).toBe(true);
		expect(mockUpsertArtists).toHaveBeenCalledWith([
			{ spotify_id: "artist-1", name: "Artist X" },
		]);
	});

	it("soft-deletes a song the account actively liked but is no longer present", async () => {
		const result = await incrementalSync(ACCOUNT_ID, {
			likedSongs: [],
			existingLikedSongs: [makeLikedSong(null)],
			likedSongsIds: new Set<string>(),
		});

		expect(Result.isOk(result)).toBe(true);
		if (Result.isError(result)) {
			throw new Error("expected ok");
		}

		expect(result.value.removed).toBe(1);
		expect(mockSoftDeleteBatch).toHaveBeenCalledWith(ACCOUNT_ID, [SONG_ID]);
	});

	it("does not re-stamp an already-unliked song that is still absent", async () => {
		const result = await incrementalSync(ACCOUNT_ID, {
			likedSongs: [],
			existingLikedSongs: [makeLikedSong("2026-02-01T00:00:00.000Z")],
			likedSongsIds: new Set<string>(),
		});

		expect(Result.isOk(result)).toBe(true);
		if (Result.isError(result)) {
			throw new Error("expected ok");
		}

		expect(result.value.removed).toBe(0);
		expect(mockSoftDeleteBatch).not.toHaveBeenCalled();
	});
});
