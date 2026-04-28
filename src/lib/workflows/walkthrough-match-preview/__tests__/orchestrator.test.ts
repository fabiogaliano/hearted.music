import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetPreview = vi.fn();
const mockMarkReady = vi.fn();
const mockMarkFailed = vi.fn();
vi.mock("../queries", async () => {
	const actual =
		await vi.importActual<typeof import("../queries")>("../queries");
	return {
		...actual,
		getWalkthroughPreview: (accountId: string) => mockGetPreview(accountId),
		markPreviewReady: (args: unknown) => mockMarkReady(args),
		markPreviewFailed: (args: unknown) => mockMarkFailed(args),
	};
});

const mockGetSong = vi.fn();
vi.mock("@/lib/domains/library/songs/queries", () => ({
	getById: (id: string) => mockGetSong(id),
}));

const mockGetAudioBatch = vi.fn();
vi.mock("@/lib/domains/enrichment/audio-features/queries", () => ({
	getBatch: (ids: string[]) => mockGetAudioBatch(ids),
}));

const mockGetEmbeddings = vi.fn();
class FakeEmbeddingService {
	getEmbeddings(songIds: string[]): unknown {
		return mockGetEmbeddings(songIds);
	}
}
vi.mock("@/lib/domains/enrichment/embeddings/service", () => ({
	EmbeddingService: FakeEmbeddingService,
}));

vi.mock("@/lib/integrations/llm/service", () => ({
	createLlmService: () => {
		throw new Error("llm unavailable in test");
	},
}));

const mockCreateProfilingService = vi.fn(() => ({}));
vi.mock("@/lib/domains/taste/playlist-profiling/service", () => ({
	createPlaylistProfilingService: () => mockCreateProfilingService(),
}));

const mockMatchSong = vi.fn();
const mockCreateMatchingService = vi.fn();
vi.mock("@/lib/domains/taste/song-matching/service", () => ({
	createMatchingService: (
		_emb: unknown,
		_prof: unknown,
		cfg: { minScoreThreshold: number; maxResultsPerSong?: number },
	) => {
		mockCreateMatchingService(cfg);
		return { matchSong: mockMatchSong };
	},
}));

const mockLightweightEnrichment = vi.fn().mockResolvedValue({});
vi.mock("@/lib/workflows/playlist-sync/lightweight-enrichment", () => ({
	runLightweightEnrichment: (args: unknown) => mockLightweightEnrichment(args),
}));

const mockLoadProfiles = vi.fn();
vi.mock("@/lib/workflows/match-snapshot-refresh/profiles", () => ({
	loadTargetPlaylistProfiles: (accountId: string, profilingService: unknown) =>
		mockLoadProfiles(accountId, profilingService),
}));

const { executeWalkthroughPreview } = await import("../orchestrator");
const { computePreviewFingerprint } = await import("../queries");

beforeEach(() => {
	vi.clearAllMocks();
});

function makePreview(overrides: Record<string, unknown> = {}) {
	return {
		account_id: "acct-1",
		demo_song_id: "song-1",
		target_playlist_ids: ["p1", "p2"],
		fingerprint: "song-1::p1,p2",
		status: "pending",
		matches: [],
		error: null,
		job_id: "job-1",
		created_at: "now",
		updated_at: "now",
		...overrides,
	};
}

function makeSong() {
	return {
		id: "song-1",
		spotify_id: "sp-1",
		name: "Demo",
		artists: ["Artist"],
		genres: ["pop"],
		audio_features: null,
	};
}

describe("executeWalkthroughPreview", () => {
	it("uses minScoreThreshold: 0 so the walkthrough always returns ranked scores", async () => {
		mockGetPreview.mockResolvedValue(Result.ok(makePreview()));
		mockGetSong.mockResolvedValue(Result.ok(makeSong()));
		mockGetAudioBatch.mockResolvedValue(Result.ok(new Map()));
		mockGetEmbeddings.mockResolvedValue(Result.ok(new Map()));
		mockLoadProfiles.mockResolvedValue({
			playlists: [{ id: "p1" }, { id: "p2" }],
			profiles: [
				{
					playlistId: "p1",
					embedding: [0.1],
					audioCentroid: {},
					genreDistribution: {},
				},
				{
					playlistId: "p2",
					embedding: [0.2],
					audioCentroid: {},
					genreDistribution: {},
				},
			],
		});
		mockMatchSong.mockResolvedValue(
			Result.ok([
				{
					playlistId: "p1",
					score: 0.12,
					rank: 1,
					factors: { embedding: 0.2, audio: 0.1, genre: 0 },
					confidence: 0.5,
					fromCache: false,
				},
				{
					playlistId: "p2",
					score: 0.05,
					rank: 2,
					factors: { embedding: 0.1, audio: 0, genre: 0 },
					confidence: 0.5,
					fromCache: false,
				},
			]),
		);
		mockMarkReady.mockResolvedValue(Result.ok({}));

		const outcome = await executeWalkthroughPreview("acct-1");

		expect(outcome.status).toBe("ready");
		expect(outcome.matchedPlaylists).toBe(2);

		// Threshold-0 invariant: the walkthrough must rank below-production
		// scores instead of returning empty. The factory call captures it.
		const cfg = mockCreateMatchingService.mock.calls[0][0] as {
			minScoreThreshold: number;
		};
		expect(cfg.minScoreThreshold).toBe(0);
	});

	it("does NOT write to match_snapshot or match_result", async () => {
		mockGetPreview.mockResolvedValue(Result.ok(makePreview()));
		mockGetSong.mockResolvedValue(Result.ok(makeSong()));
		mockGetAudioBatch.mockResolvedValue(Result.ok(new Map()));
		mockGetEmbeddings.mockResolvedValue(Result.ok(new Map()));
		mockLoadProfiles.mockResolvedValue({
			playlists: [{ id: "p1" }],
			profiles: [
				{
					playlistId: "p1",
					embedding: [0.1],
					audioCentroid: {},
					genreDistribution: {},
				},
			],
		});
		mockMatchSong.mockResolvedValue(
			Result.ok([
				{
					playlistId: "p1",
					score: 0.5,
					rank: 1,
					factors: { embedding: 0.5, audio: 0.5, genre: 0 },
					confidence: 1,
					fromCache: false,
				},
			]),
		);
		mockMarkReady.mockResolvedValue(Result.ok({}));

		// Spy on the snapshot writer module — if the orchestrator regresses and
		// pulls it in, the test should fail.
		const snapshotWriter = await import(
			"@/lib/workflows/match-snapshot-refresh/write-match-snapshot"
		);
		const writeSpy = vi.spyOn(snapshotWriter, "writeMatchSnapshot");
		const writeEmptySpy = vi.spyOn(snapshotWriter, "writeEmptySnapshot");

		await executeWalkthroughPreview("acct-1");

		expect(writeSpy).not.toHaveBeenCalled();
		expect(writeEmptySpy).not.toHaveBeenCalled();
	});

	it("scopes scoring to the captured target_playlist_ids snapshot", async () => {
		// Fingerprint must align with target_playlist_ids so the orchestrator
		// advances past its fingerprint guard. The captured set is ["p1"] —
		// even though the playlist-profiling cache hands back both p1 and p2
		// (e.g. background target-set drift after the job was queued), the
		// orchestrator must score only against the captured set.
		const fingerprint = computePreviewFingerprint("song-1", ["p1"]);
		mockGetPreview.mockResolvedValue(
			Result.ok(
				makePreview({
					target_playlist_ids: ["p1"],
					fingerprint,
				}),
			),
		);
		mockGetSong.mockResolvedValue(Result.ok(makeSong()));
		mockGetAudioBatch.mockResolvedValue(Result.ok(new Map()));
		mockGetEmbeddings.mockResolvedValue(Result.ok(new Map()));
		mockLoadProfiles.mockResolvedValue({
			playlists: [{ id: "p1" }, { id: "p2" }],
			profiles: [
				{
					playlistId: "p1",
					embedding: [0.1],
					audioCentroid: {},
					genreDistribution: {},
				},
				{
					playlistId: "p2",
					embedding: [0.2],
					audioCentroid: {},
					genreDistribution: {},
				},
			],
		});
		mockMatchSong.mockResolvedValue(Result.ok([]));
		mockMarkReady.mockResolvedValue(Result.ok({}));

		await executeWalkthroughPreview("acct-1");

		expect(mockMatchSong).toHaveBeenCalledTimes(1);
		const passedProfiles = mockMatchSong.mock.calls[0][1] as Array<{
			playlistId: string;
		}>;
		expect(passedProfiles.map((p) => p.playlistId)).toEqual(["p1"]);
	});

	it("skips when fingerprint has rotated since the job was queued", async () => {
		mockGetPreview.mockResolvedValue(
			Result.ok(makePreview({ fingerprint: "stale-fingerprint" })),
		);

		const outcome = await executeWalkthroughPreview("acct-1");

		expect(outcome.status).toBe("skipped");
		expect(mockMatchSong).not.toHaveBeenCalled();
		expect(mockMarkReady).not.toHaveBeenCalled();
	});

	it("skips when no preview row exists", async () => {
		mockGetPreview.mockResolvedValue(Result.ok(null));

		const outcome = await executeWalkthroughPreview("acct-1");

		expect(outcome.status).toBe("skipped");
		expect(mockMatchSong).not.toHaveBeenCalled();
	});

	it("marks the row failed when the demo song row is missing", async () => {
		mockGetPreview.mockResolvedValue(Result.ok(makePreview()));
		mockLoadProfiles.mockResolvedValue({
			playlists: [{ id: "p1" }, { id: "p2" }],
			profiles: [
				{
					playlistId: "p1",
					embedding: [0.1],
					audioCentroid: {},
					genreDistribution: {},
				},
				{
					playlistId: "p2",
					embedding: [0.2],
					audioCentroid: {},
					genreDistribution: {},
				},
			],
		});
		mockGetSong.mockResolvedValue(Result.ok(null));
		mockMarkFailed.mockResolvedValue(Result.ok({}));

		const outcome = await executeWalkthroughPreview("acct-1");

		expect(outcome.status).toBe("failed");
		expect(mockMarkFailed).toHaveBeenCalledTimes(1);
		expect(mockMarkReady).not.toHaveBeenCalled();
	});
});
