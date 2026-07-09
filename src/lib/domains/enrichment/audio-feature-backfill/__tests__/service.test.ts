import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FfmpegError } from "@/lib/shared/errors/external/youtube-audio";

vi.mock("@/lib/integrations/youtube-audio/service");
// Keep the real summarizeYtDlpFailure (a pure helper the settle path uses to
// enrich stored error messages); only checkYtDlpAvailable needs stubbing.
vi.mock(
	"@/lib/integrations/youtube-audio/yt-dlp",
	async (importOriginal: <T>() => Promise<T>) => ({
		...(await importOriginal<
			typeof import("@/lib/integrations/youtube-audio/yt-dlp")
		>()),
		checkYtDlpAvailable: vi.fn(),
	}),
);
vi.mock("@/lib/integrations/reccobeats/file-analysis");
vi.mock("@/lib/data/client");
vi.mock("../jobs");
vi.mock("../wake");

import { createAdminSupabaseClient } from "@/lib/data/client";
import {
	aggregateClipFeatures,
	analyzeClipsAll,
} from "@/lib/integrations/reccobeats/file-analysis";
import { acquireSource } from "@/lib/integrations/youtube-audio/service";
import { checkYtDlpAvailable } from "@/lib/integrations/youtube-audio/yt-dlp";
import * as jobs from "../jobs";
import { processBackfillJob } from "../service";
import type { BackfillJob } from "../types";
import { wakeEnrichmentForSong } from "../wake";

const WORKER = "worker-1";

function makeJob(overrides: Partial<BackfillJob> = {}): BackfillJob {
	return {
		id: "job-1",
		song_id: "song-1",
		source_type: "youtube_search",
		source_url: null,
		status: "running",
		locked_by: WORKER,
		attempts: 1,
		max_attempts: 3,
		...overrides,
	} as unknown as BackfillJob;
}

const FEATURES = {
	acousticness: 0.5,
	danceability: 0.5,
	energy: 0.5,
	instrumentalness: 0.1,
	liveness: 0.1,
	loudness: -8,
	speechiness: 0.05,
	tempo: 120,
	valence: 0.5,
};

function acquiredSource() {
	return {
		kind: "acquired" as const,
		candidate: {
			videoId: "vid",
			url: "https://www.youtube.com/watch?v=vid",
			title: "Artist - Song (Official Audio)",
			channel: "Artist - Topic",
			durationSeconds: 200,
			thumbnailUrl: "thumb",
		},
		sourcePath: "/tmp/x/source.webm",
		durationSeconds: 200,
		clips: [
			{ path: "/tmp/x/clip_0.mp3", startSeconds: 0, durationSeconds: 30 },
		],
		searchQuery: "Artist Song",
		matchScore: 0.95,
		matchReasons: ["title contains full song title"],
		candidateRank: 1,
		scored: [
			{
				candidate: {
					videoId: "vid",
					url: "https://www.youtube.com/watch?v=vid",
					title: "Artist - Song (Official Audio)",
					channel: "Artist - Topic",
					durationSeconds: 200,
					thumbnailUrl: "thumb",
				},
				score: 0.95,
				reasons: ["title contains full song title"],
				rejected: false,
			},
			{
				candidate: {
					videoId: "rej",
					url: "https://www.youtube.com/watch?v=rej",
					title: "Artist - Song (Live)",
					channel: null,
					durationSeconds: 240,
					thumbnailUrl: null,
				},
				score: 0,
				reasons: [],
				rejected: true,
				rejectReason: 'contains "live"',
			},
		],
	};
}

/** Stub supports the song lookup and the job_item_failure resolution chain. */
function supabaseStub(songData: Record<string, unknown> | null = null) {
	const jif = {
		update: () => jif,
		eq: () => jif,
		is: () => Promise.resolve({ error: null }),
	};
	return {
		from: (table: string) => {
			if (table === "song") {
				return {
					select: () => ({
						eq: () => ({
							single: async () =>
								songData
									? { data: songData, error: null }
									: { data: null, error: { message: "not found" } },
						}),
					}),
				};
			}
			return jif;
		},
	};
}

const SONG = {
	id: "song-1",
	name: "Song",
	artists: ["Artist"],
	album_name: "Album",
	duration_ms: 200_000,
	spotify_id: "sp",
	image_url: null,
};

beforeEach(() => {
	vi.mocked(createAdminSupabaseClient).mockReturnValue(
		supabaseStub(SONG) as never,
	);
	vi.mocked(checkYtDlpAvailable).mockResolvedValue(Result.ok("2025.01.01"));
	vi.mocked(acquireSource).mockResolvedValue(Result.ok(acquiredSource()));
	vi.mocked(analyzeClipsAll).mockResolvedValue(
		Result.ok([{ features: FEATURES, durationSeconds: 30 }]),
	);
	vi.mocked(aggregateClipFeatures).mockReturnValue({
		features: FEATURES,
		metadata: {
			method: "duration_weighted_feature_aware_v1",
			clipDurationsSeconds: [30],
			tempoStrategy: "weighted_median_half_double_normalized",
			tempoConfidence: "high",
			featureStdDev: {},
		},
	});
	vi.mocked(jobs.acquireProviderLease).mockResolvedValue(Result.ok(true));
	vi.mocked(jobs.releaseProviderLease).mockResolvedValue(Result.ok(undefined));
	vi.mocked(jobs.settleBackfillJob).mockResolvedValue(
		Result.ok({
			jobId: "job-1",
			audioFeatureId: "feat-1",
			reviewId: "rev-1",
			didSkip: false,
		}),
	);
	// deferJob defaults to a still-pending job (attempts remain); override per test.
	vi.mocked(jobs.deferJob).mockResolvedValue(
		Result.ok(makeJob({ status: "pending" })),
	);
	vi.mocked(jobs.rependBackfillJob).mockResolvedValue(
		Result.ok(makeJob({ status: "pending" })),
	);
	vi.mocked(jobs.failJob).mockResolvedValue(
		Result.ok(makeJob({ status: "failed" })),
	);
	vi.mocked(jobs.markJobManualNeeded).mockResolvedValue(
		Result.ok(makeJob({ status: "manual_needed" })),
	);
	vi.mocked(wakeEnrichmentForSong).mockResolvedValue([]);
});

afterEach(() => vi.clearAllMocks());

describe("processBackfillJob", () => {
	it("high-confidence search auto-approves (score ≥ autoApproveScore), then wakes", async () => {
		const outcome = await processBackfillJob(makeJob(), WORKER);

		expect(outcome).toBe("completed");
		expect(jobs.acquireProviderLease).toHaveBeenCalledTimes(1);
		expect(jobs.releaseProviderLease).toHaveBeenCalledTimes(1);
		expect(jobs.settleBackfillJob).toHaveBeenCalledTimes(1);
		expect(
			vi.mocked(jobs.settleBackfillJob).mock.calls[0]?.[0].reviewStatus,
		).toBe("approved");
		expect(
			vi.mocked(jobs.settleBackfillJob).mock.calls[0]?.[0].reviewedBy,
		).toBe("auto-approve");
		// The full scored set is persisted on the review: viable-first (ranked),
		// then rejected — so an accepted match carries the alternatives it beat.
		const settleInput = vi.mocked(jobs.settleBackfillJob).mock.calls[0]?.[0];
		expect(settleInput?.candidates).toHaveLength(2);
		expect(settleInput?.candidates[0]).toMatchObject({
			videoId: "vid",
			rank: 1,
			rejected: false,
		});
		expect(settleInput?.candidates[1]).toMatchObject({
			videoId: "rej",
			rank: null,
			rejected: true,
		});
		expect(wakeEnrichmentForSong).toHaveBeenCalledWith("song-1");
	});

	it("manual URL job settles as an approved review", async () => {
		const outcome = await processBackfillJob(
			makeJob({
				source_type: "youtube_url",
				source_url: "https://youtu.be/vid",
			}),
			WORKER,
		);

		expect(outcome).toBe("completed");
		const input = vi.mocked(jobs.settleBackfillJob).mock.calls[0]?.[0];
		expect(input?.reviewStatus).toBe("approved");
		expect(input?.reviewedBy).toBe("control-panel");
	});

	it("a search match below autoApproveScore stays pending for review", async () => {
		// Can't occur while autoApproveScore == minScore (nothing below the 0.75
		// floor is selected), but the gate must still route a weak match to manual
		// review if the knob is later raised above the selection floor.
		vi.mocked(acquireSource).mockResolvedValue(
			Result.ok({ ...acquiredSource(), matchScore: 0.7 }),
		);

		const outcome = await processBackfillJob(makeJob(), WORKER);

		expect(outcome).toBe("completed");
		const input = vi.mocked(jobs.settleBackfillJob).mock.calls[0]?.[0];
		expect(input?.reviewStatus).toBe("pending");
		expect(input?.reviewedBy).toBeNull();
	});

	it("low-confidence: marks manual_needed with the scored candidates and never settles", async () => {
		vi.mocked(acquireSource).mockResolvedValue(
			Result.ok({
				kind: "manual_needed",
				code: "yt_search_low_confidence",
				reason: "best score 0.63 below 0.75",
				scored: [
					{
						candidate: {
							videoId: "cand",
							url: "https://www.youtube.com/watch?v=cand",
							title: "Los Enanitos Verdes - Tequila (En Vivo)",
							channel: "Fan Uploads",
							durationSeconds: 246,
							thumbnailUrl: null,
						},
						score: 0.63,
						reasons: ["title partially matches song title"],
						rejected: false,
					},
				],
			}),
		);

		const outcome = await processBackfillJob(makeJob(), WORKER);

		expect(outcome).toBe("manual_needed");
		expect(jobs.settleBackfillJob).not.toHaveBeenCalled();
		expect(wakeEnrichmentForSong).toHaveBeenCalledWith("song-1");
		// The candidate the search actually found is persisted onto the stuck job,
		// as the 5th arg — the operator can now see the 0.63 link, not just the number.
		const call = vi.mocked(jobs.markJobManualNeeded).mock.calls[0];
		expect(call?.[4]).toHaveLength(1);
		expect(call?.[4]?.[0]).toMatchObject({
			videoId: "cand",
			score: 0.63,
			rank: 1,
			rejected: false,
		});
	});

	it("auto-search skips when a feature already existed, but still wakes (now ready)", async () => {
		vi.mocked(jobs.settleBackfillJob).mockResolvedValue(
			Result.ok({
				jobId: "job-1",
				audioFeatureId: "existing",
				reviewId: null,
				didSkip: true,
			}),
		);

		const outcome = await processBackfillJob(makeJob(), WORKER);

		expect(outcome).toBe("skipped");
		// The job left backfill_active and the song is ready, so analysis can run.
		expect(wakeEnrichmentForSong).toHaveBeenCalledWith("song-1");
	});

	it("a rejected fence (RPC returns null) skips without writing or waking", async () => {
		vi.mocked(jobs.settleBackfillJob).mockResolvedValue(Result.ok(null));

		const outcome = await processBackfillJob(makeJob(), WORKER);

		expect(outcome).toBe("skipped");
		// Nothing transitioned for us (another worker owns the job), so no wake.
		expect(wakeEnrichmentForSong).not.toHaveBeenCalled();
	});

	it("settlement DB failure defers as db_write_failed and does NOT complete or wake", async () => {
		const { DatabaseError } = await import("@/lib/shared/errors/database");
		vi.mocked(jobs.settleBackfillJob).mockResolvedValue(
			Result.err(new DatabaseError({ code: "rpc_error", message: "boom" })),
		);

		const outcome = await processBackfillJob(makeJob(), WORKER);

		expect(outcome).toBe("deferred");
		expect(jobs.deferJob).toHaveBeenCalledWith(
			"job-1",
			WORKER,
			expect.any(Number),
			"db_write_failed",
			expect.any(String),
		);
		// Still-pending defer (attempts remain) means no terminal wake.
		expect(wakeEnrichmentForSong).not.toHaveBeenCalled();
	});

	it("defers (with backoff) on a transient ffmpeg failure", async () => {
		vi.mocked(acquireSource).mockResolvedValue(
			Result.err(
				new FfmpegError({ message: "clip 0 failed", code: "clip_failed" }),
			),
		);

		const outcome = await processBackfillJob(makeJob(), WORKER);

		expect(outcome).toBe("deferred");
		expect(jobs.deferJob).toHaveBeenCalled();
		expect(jobs.settleBackfillJob).not.toHaveBeenCalled();
	});

	it("provider lease unavailable re-queues without a retry penalty (never terminal)", async () => {
		vi.mocked(jobs.acquireProviderLease).mockResolvedValue(Result.ok(false));

		const outcome = await processBackfillJob(makeJob(), WORKER);

		expect(outcome).toBe("deferred");
		expect(jobs.rependBackfillJob).toHaveBeenCalledWith(
			"job-1",
			WORKER,
			expect.any(Number),
			"provider_busy",
			expect.any(String),
		);
		// Not the penalizing defer path, and no terminal transition to wake for.
		expect(jobs.deferJob).not.toHaveBeenCalled();
		expect(jobs.settleBackfillJob).not.toHaveBeenCalled();
		expect(wakeEnrichmentForSong).not.toHaveBeenCalled();
	});

	it("persists the yt-dlp stderr summary on a download failure", async () => {
		const { YtDlpError } = await import(
			"@/lib/shared/errors/external/youtube-audio"
		);
		vi.mocked(acquireSource).mockResolvedValue(
			Result.err(
				new YtDlpError({
					message: "yt-dlp download failed",
					code: "download_failed",
					stderr:
						"WARNING: noise\nERROR: [youtube] abc: Sign in to confirm you’re not a bot.",
				}),
			),
		);

		const outcome = await processBackfillJob(makeJob(), WORKER);

		expect(outcome).toBe("deferred");
		const [, , , errorCode, errorMessage] =
			vi.mocked(jobs.deferJob).mock.calls[0] ?? [];
		expect(errorCode).toBe("yt_download_failed");
		expect(errorMessage).toContain("Sign in to confirm");
	});

	it("ffprobe-invalid audio goes to manual_needed, not retry", async () => {
		vi.mocked(acquireSource).mockResolvedValue(
			Result.err(
				new FfmpegError({ message: "no audio", code: "no_audio_stream" }),
			),
		);

		const outcome = await processBackfillJob(makeJob(), WORKER);

		expect(outcome).toBe("manual_needed");
		expect(jobs.markJobManualNeeded).toHaveBeenCalled();
	});

	it("wakes enrichment when a defer terminalizes to failed (attempts exhausted)", async () => {
		vi.mocked(acquireSource).mockResolvedValue(
			Result.err(
				new FfmpegError({ message: "clip 0 failed", code: "clip_failed" }),
			),
		);
		vi.mocked(jobs.deferJob).mockResolvedValue(
			Result.ok(makeJob({ status: "failed" })),
		);

		const outcome = await processBackfillJob(makeJob(), WORKER);

		expect(outcome).toBe("failed");
		expect(wakeEnrichmentForSong).toHaveBeenCalledWith("song-1");
	});

	it("missing yt-dlp binary marks manual_needed and never acquires a source", async () => {
		const { YtDlpError } = await import(
			"@/lib/shared/errors/external/youtube-audio"
		);
		vi.mocked(checkYtDlpAvailable).mockResolvedValue(
			Result.err(
				new YtDlpError({
					message: "yt-dlp not available",
					code: "unavailable",
				}),
			),
		);

		const outcome = await processBackfillJob(makeJob(), WORKER);

		expect(outcome).toBe("manual_needed");
		expect(jobs.markJobManualNeeded).toHaveBeenCalledWith(
			"job-1",
			WORKER,
			"yt_dlp_unavailable",
			expect.any(String),
		);
		expect(acquireSource).not.toHaveBeenCalled();
		expect(wakeEnrichmentForSong).toHaveBeenCalledWith("song-1");
	});

	it("missing song row fails terminally and wakes enrichment", async () => {
		vi.mocked(createAdminSupabaseClient).mockReturnValue(
			supabaseStub(null) as never,
		);

		const outcome = await processBackfillJob(makeJob(), WORKER);

		expect(outcome).toBe("failed");
		expect(jobs.failJob).toHaveBeenCalledWith(
			"job-1",
			WORKER,
			"source_missing",
			expect.any(String),
		);
		expect(wakeEnrichmentForSong).toHaveBeenCalledWith("song-1");
	});
});
