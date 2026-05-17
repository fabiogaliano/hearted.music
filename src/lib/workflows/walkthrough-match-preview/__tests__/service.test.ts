import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetTargetPlaylists = vi.fn();
vi.mock("@/lib/domains/library/playlists/queries", () => ({
	getTargetPlaylists: (...args: unknown[]) => mockGetTargetPlaylists(...args),
}));

const mockEnsureJob = vi.fn();
const mockGetActiveJob = vi.fn();
vi.mock("@/lib/platform/jobs/walkthrough-preview-queue", () => ({
	ensureWalkthroughPreviewJob: (...args: unknown[]) => mockEnsureJob(...args),
}));

vi.mock("@/lib/platform/jobs/repository", () => ({
	getActiveJob: (...args: unknown[]) => mockGetActiveJob(...args),
}));

const mockGetPreview = vi.fn();
const mockUpsertPending = vi.fn();
vi.mock("../queries", async () => {
	const actual =
		await vi.importActual<typeof import("../queries")>("../queries");
	return {
		...actual,
		getWalkthroughPreview: (...args: unknown[]) => mockGetPreview(...args),
		upsertPendingPreview: (...args: unknown[]) => mockUpsertPending(...args),
	};
});

const { ensureWalkthroughPreview } = await import("../service");
const { computePreviewFingerprint } = await import("../queries");

beforeEach(() => {
	vi.clearAllMocks();
});

function targetPlaylist(id: string) {
	return { id, name: `Pl ${id}`, is_target: true };
}

describe("ensureWalkthroughPreview", () => {
	it("skips when no target playlists are selected", async () => {
		mockGetTargetPlaylists.mockResolvedValue(Result.ok([]));

		const outcome = await ensureWalkthroughPreview({
			accountId: "acct-1",
			demoSongId: "song-1",
		});

		expect(outcome).toEqual({ status: "skipped", reason: "no_targets" });
		expect(mockEnsureJob).not.toHaveBeenCalled();
		expect(mockUpsertPending).not.toHaveBeenCalled();
	});

	it("ensures a preview job and upserts a pending row when no preview exists", async () => {
		mockGetTargetPlaylists.mockResolvedValue(
			Result.ok([targetPlaylist("p1"), targetPlaylist("p2")]),
		);
		mockGetPreview.mockResolvedValue(Result.ok(null));
		mockEnsureJob.mockResolvedValue(Result.ok({ id: "job-1" }));
		mockUpsertPending.mockResolvedValue(Result.ok({ fingerprint: "fp" }));

		const outcome = await ensureWalkthroughPreview({
			accountId: "acct-1",
			demoSongId: "song-1",
		});

		expect(outcome.status).toBe("ensured");
		expect(mockEnsureJob).toHaveBeenCalledWith("acct-1");
		expect(mockUpsertPending).toHaveBeenCalledTimes(1);

		const upsertArgs = mockUpsertPending.mock.calls[0][0];
		expect(upsertArgs.targetPlaylistIds).toEqual(["p1", "p2"]);
		expect(upsertArgs.fingerprint).toBe(
			computePreviewFingerprint("song-1", ["p1", "p2"]),
		);
	});

	it("is a no-op when fingerprint matches and the existing row is ready", async () => {
		const fingerprint = computePreviewFingerprint("song-1", ["p1"]);
		mockGetTargetPlaylists.mockResolvedValue(Result.ok([targetPlaylist("p1")]));
		mockGetPreview.mockResolvedValue(
			Result.ok({ fingerprint, status: "ready" }),
		);

		const outcome = await ensureWalkthroughPreview({
			accountId: "acct-1",
			demoSongId: "song-1",
		});

		expect(outcome).toEqual({ status: "noop", reason: "ready" });
		expect(mockGetActiveJob).not.toHaveBeenCalled();
		expect(mockEnsureJob).not.toHaveBeenCalled();
		expect(mockUpsertPending).not.toHaveBeenCalled();
	});

	it("is a no-op when pending row is backed by a live active job", async () => {
		const fingerprint = computePreviewFingerprint("song-1", ["p1"]);
		mockGetTargetPlaylists.mockResolvedValue(Result.ok([targetPlaylist("p1")]));
		mockGetPreview.mockResolvedValue(
			Result.ok({ fingerprint, status: "pending" }),
		);
		mockGetActiveJob.mockResolvedValue(Result.ok({ id: "job-active" }));

		const outcome = await ensureWalkthroughPreview({
			accountId: "acct-1",
			demoSongId: "song-1",
		});

		expect(outcome).toEqual({
			status: "noop",
			reason: "pending_job_alive",
		});
		expect(mockGetActiveJob).toHaveBeenCalledWith(
			"acct-1",
			"walkthrough_match_preview",
		);
		expect(mockEnsureJob).not.toHaveBeenCalled();
	});

	it("re-ensures when pending row exists but no active job is alive (stranded pending)", async () => {
		const fingerprint = computePreviewFingerprint("song-1", ["p1"]);
		mockGetTargetPlaylists.mockResolvedValue(Result.ok([targetPlaylist("p1")]));
		mockGetPreview.mockResolvedValue(
			Result.ok({ fingerprint, status: "pending" }),
		);
		mockGetActiveJob.mockResolvedValue(Result.ok(null));
		mockEnsureJob.mockResolvedValue(Result.ok({ id: "job-recover" }));
		mockUpsertPending.mockResolvedValue(Result.ok({ fingerprint }));

		const outcome = await ensureWalkthroughPreview({
			accountId: "acct-1",
			demoSongId: "song-1",
		});

		expect(outcome.status).toBe("ensured");
		expect(mockEnsureJob).toHaveBeenCalledWith("acct-1");
		expect(mockUpsertPending).toHaveBeenCalledTimes(1);
	});

	it("invalidates and re-ensures when target playlists change", async () => {
		const oldFingerprint = computePreviewFingerprint("song-1", ["p1"]);
		mockGetTargetPlaylists.mockResolvedValue(
			Result.ok([targetPlaylist("p1"), targetPlaylist("p2")]),
		);
		mockGetPreview.mockResolvedValue(
			Result.ok({ fingerprint: oldFingerprint, status: "ready" }),
		);
		mockEnsureJob.mockResolvedValue(Result.ok({ id: "job-2" }));
		mockUpsertPending.mockResolvedValue(Result.ok({ fingerprint: "new" }));

		const outcome = await ensureWalkthroughPreview({
			accountId: "acct-1",
			demoSongId: "song-1",
		});

		expect(outcome.status).toBe("ensured");
		expect(mockEnsureJob).toHaveBeenCalledTimes(1);
		const args = mockUpsertPending.mock.calls[0][0];
		expect(args.fingerprint).toBe(
			computePreviewFingerprint("song-1", ["p1", "p2"]),
		);
		expect(args.fingerprint).not.toBe(oldFingerprint);
	});

	it("re-ensures when an existing row failed and no live job covers it", async () => {
		const fingerprint = computePreviewFingerprint("song-1", ["p1"]);
		mockGetTargetPlaylists.mockResolvedValue(Result.ok([targetPlaylist("p1")]));
		mockGetPreview.mockResolvedValue(
			Result.ok({ fingerprint, status: "failed" }),
		);
		mockGetActiveJob.mockResolvedValue(Result.ok(null));
		mockEnsureJob.mockResolvedValue(Result.ok({ id: "job-3" }));
		mockUpsertPending.mockResolvedValue(Result.ok({ fingerprint }));

		const outcome = await ensureWalkthroughPreview({
			accountId: "acct-1",
			demoSongId: "song-1",
		});

		expect(outcome.status).toBe("ensured");
		expect(mockEnsureJob).toHaveBeenCalledWith("acct-1");
	});
});
