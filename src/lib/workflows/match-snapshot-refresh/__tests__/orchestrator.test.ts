/**
 * Slim orchestrator tests — the orchestrator is thin sequencing + progress/
 * error policy over the match-snapshot-refresh stages (target_song_enrichment,
 * playlist_profiling, candidate_loading, matching, publishing). Each stage's
 * real behavior is covered by its own test in stages/__tests__/*; these tests
 * only assert the orchestrator wires stage inputs/outputs correctly and
 * honors supersession/error policy — not the stages' internals.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRunTargetSongEnrichment = vi.fn();
vi.mock("../stages/target-song-enrichment", () => ({
	runTargetSongEnrichment: (...args: unknown[]) =>
		mockRunTargetSongEnrichment(...args),
}));

const mockLoadTargetPlaylistProfiles = vi.fn();
vi.mock("../stages/playlist-profiling", () => ({
	loadTargetPlaylistProfiles: (...args: unknown[]) =>
		mockLoadTargetPlaylistProfiles(...args),
}));

const mockLoadCandidateSongIds = vi.fn();
const mockLoadCandidateDetails = vi.fn();
const mockLoadSongEmbeddings = vi.fn();
vi.mock("../stages/candidate-loading", () => ({
	loadCandidateSongIds: (...args: unknown[]) =>
		mockLoadCandidateSongIds(...args),
	loadCandidateDetails: (...args: unknown[]) =>
		mockLoadCandidateDetails(...args),
	loadSongEmbeddings: (...args: unknown[]) => mockLoadSongEmbeddings(...args),
}));

const mockRunScoring = vi.fn();
vi.mock("../stages/matching", () => ({
	runScoring: (...args: unknown[]) => mockRunScoring(...args),
}));

const mockRunOrientedRanking = vi.fn();
vi.mock("../stages/ranking", () => ({
	runOrientedRanking: (...args: unknown[]) => mockRunOrientedRanking(...args),
}));

const mockWriteMatchSnapshot = vi.fn();
const mockWriteEmptySnapshot = vi.fn();
vi.mock("../write-match-snapshot", () => ({
	writeMatchSnapshot: (...args: unknown[]) => mockWriteMatchSnapshot(...args),
	writeEmptySnapshot: (...args: unknown[]) => mockWriteEmptySnapshot(...args),
}));

vi.mock("@/lib/domains/enrichment/embeddings/service", () => ({
	EmbeddingService: {
		create: () => Result.ok({ getEmbeddings: vi.fn(), getEmbedding: vi.fn() }),
	},
}));

vi.mock("@/lib/domains/taste/playlist-profiling/service", () => ({
	createPlaylistProfilingService: () => ({}),
}));

vi.mock("@/lib/integrations/llm/service", () => ({
	createLlmService: () => {
		throw new Error("LLM unavailable");
	},
}));

vi.mock("@/lib/integrations/reranker/service", () => ({
	RerankerService: class {},
}));

vi.mock("@/lib/platform/jobs/repository", () => ({
	updateJobProgress: vi.fn().mockResolvedValue(Result.ok(undefined)),
}));

vi.mock("@/lib/observability/account-label", () => ({
	resolveAccountLabel: vi.fn().mockResolvedValue("test-user"),
}));

const mockLoadLibraryProcessingState = vi.fn();
vi.mock("@/lib/workflows/library-processing/queries", () => ({
	loadLibraryProcessingState: (...args: unknown[]) =>
		mockLoadLibraryProcessingState(...args),
}));

const { executeMatchSnapshotRefresh } = await import("../orchestrator");

function makePlan() {
	return { needsTargetSongEnrichment: false };
}

function makePlaylist(id: string) {
	return { id, name: `Playlist ${id}`, match_intent: null, genre_pills: null };
}

function makeProfile(playlistId: string) {
	return {
		playlistId,
		embedding: [0.1],
		audioCentroid: { energy: 0.5 },
		genreDistribution: { pop: 1 },
		hasGenrePills: false,
	};
}

function makeMatchingSong(id: string) {
	return {
		id,
		spotifyId: `sp-${id}`,
		name: `Song ${id}`,
		artists: ["Artist"],
		genres: ["pop"],
		audioFeatures: null,
	};
}

function snapshotResult(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		published: true,
		snapshotId: "snap-1",
		matchedSongCount: 0,
		candidateCount: 1,
		playlistCount: 1,
		isEmpty: false,
		noOp: false,
		...overrides,
	};
}

/** Wires all stages to a minimal one-song/one-playlist happy path. */
function setupHappyPath({
	exclusionSet = new Set<string>(),
}: {
	exclusionSet?: Set<string>;
} = {}) {
	mockLoadTargetPlaylistProfiles.mockResolvedValue({
		playlists: [makePlaylist("pl-1")],
		profiles: [makeProfile("pl-1")],
	});
	mockLoadCandidateSongIds.mockResolvedValue(["song-1"]);
	mockLoadCandidateDetails.mockResolvedValue({
		matchingSongs: [makeMatchingSong("song-1")],
		baseExclusionSet: exclusionSet,
	});
	mockLoadSongEmbeddings.mockResolvedValue(new Map());
	mockRunScoring.mockResolvedValue(
		Result.ok({ matches: new Map(), storedPairs: [] }),
	);
	mockRunOrientedRanking.mockResolvedValue({
		status: "completed",
		resultEntries: [],
		rerankDocumentMode: "metadata",
	});
	mockWriteMatchSnapshot.mockResolvedValue(snapshotResult());
	mockLoadLibraryProcessingState.mockResolvedValue(Result.ok(null));
}

describe("executeMatchSnapshotRefresh — sequencing", () => {
	beforeEach(() => vi.clearAllMocks());

	it("runs stages in order and publishes on the happy path", async () => {
		setupHappyPath();

		const outcome = await executeMatchSnapshotRefresh("acc-1", makePlan());

		expect(outcome.status).toBe("published");
		expect(mockRunTargetSongEnrichment).not.toHaveBeenCalled();
		expect(mockLoadTargetPlaylistProfiles).toHaveBeenCalled();
		expect(mockLoadCandidateSongIds).toHaveBeenCalled();
		expect(mockLoadCandidateDetails).toHaveBeenCalled();
		expect(mockRunScoring).toHaveBeenCalled();
		expect(mockRunOrientedRanking).toHaveBeenCalled();
		expect(mockWriteMatchSnapshot).toHaveBeenCalledOnce();
	});

	it("runs target_song_enrichment when the plan requests it", async () => {
		setupHappyPath();
		mockRunTargetSongEnrichment.mockResolvedValue({ succeeded: true });

		await executeMatchSnapshotRefresh("acc-1", {
			needsTargetSongEnrichment: true,
		});

		expect(mockRunTargetSongEnrichment).toHaveBeenCalledWith(
			"acc-1",
			"test-user",
		);
	});

	it("publishes an empty snapshot and skips candidate loading when there are no target playlists", async () => {
		mockLoadTargetPlaylistProfiles.mockResolvedValue({
			playlists: [],
			profiles: [],
		});
		mockWriteEmptySnapshot.mockResolvedValue(
			snapshotResult({ isEmpty: true, candidateCount: 0, playlistCount: 0 }),
		);
		mockLoadLibraryProcessingState.mockResolvedValue(Result.ok(null));

		const outcome = await executeMatchSnapshotRefresh("acc-1", makePlan());

		expect(outcome.status).toBe("published");
		expect(mockWriteEmptySnapshot).toHaveBeenCalledWith("acc-1");
		expect(mockLoadCandidateSongIds).not.toHaveBeenCalled();
	});

	it("writes an empty-candidates snapshot and skips scoring/ranking when no candidates exist", async () => {
		mockLoadTargetPlaylistProfiles.mockResolvedValue({
			playlists: [makePlaylist("pl-1")],
			profiles: [makeProfile("pl-1")],
		});
		mockLoadCandidateSongIds.mockResolvedValue([]);
		mockWriteMatchSnapshot.mockResolvedValue(snapshotResult());
		mockLoadLibraryProcessingState.mockResolvedValue(Result.ok(null));

		const outcome = await executeMatchSnapshotRefresh("acc-1", makePlan());

		expect(outcome.status).toBe("published");
		expect(mockRunScoring).not.toHaveBeenCalled();
		expect(mockRunOrientedRanking).not.toHaveBeenCalled();
		const [writeOpts] = mockWriteMatchSnapshot.mock.calls[0] as [
			{ songs: unknown[]; results: unknown[] },
		];
		expect(writeOpts.songs).toEqual([]);
		expect(writeOpts.results).toEqual([]);
	});

	it("throws when scoring fails, and never calls writeMatchSnapshot", async () => {
		setupHappyPath();
		mockRunScoring.mockResolvedValue(
			Result.err({ message: "scoring blew up" }),
		);

		await expect(
			executeMatchSnapshotRefresh("acc-1", makePlan()),
		).rejects.toThrow("[target-refresh] Matching failed");
		expect(mockWriteMatchSnapshot).not.toHaveBeenCalled();
	});

	it("returns superseded and never publishes when ranking reports superseded", async () => {
		setupHappyPath();
		mockRunOrientedRanking.mockResolvedValue({ status: "superseded" });

		const outcome = await executeMatchSnapshotRefresh("acc-1", makePlan());

		expect(outcome).toEqual({ status: "superseded" });
		expect(mockWriteMatchSnapshot).not.toHaveBeenCalled();
	});

	it("returns superseded right after playlist profiling when a newer request landed", async () => {
		mockLoadTargetPlaylistProfiles.mockResolvedValue({
			playlists: [makePlaylist("pl-1")],
			profiles: [makeProfile("pl-1")],
		});
		mockLoadLibraryProcessingState.mockResolvedValue(
			Result.ok({
				matchSnapshotRefresh: { requestedAt: "2030-01-01T00:00:00.000Z" },
			}),
		);

		const outcome = await executeMatchSnapshotRefresh(
			"acc-1",
			makePlan(),
			undefined,
			undefined,
			"2020-01-01T00:00:00.000Z",
		);

		expect(outcome).toEqual({ status: "superseded" });
		expect(mockLoadCandidateSongIds).not.toHaveBeenCalled();
	});
});

describe("executeMatchSnapshotRefresh — exclusion set threading", () => {
	beforeEach(() => vi.clearAllMocks());

	it("passes the exact same exclusion-set reference to scoring and publishing", async () => {
		const exclusionSet = new Set(["song-1:pl-1"]);
		setupHappyPath({ exclusionSet });

		await executeMatchSnapshotRefresh("acc-1", makePlan());

		const scoringArgs = mockRunScoring.mock.calls[0] as unknown[];
		const writeArgs = mockWriteMatchSnapshot.mock.calls[0] as [
			{ exclusionSet?: Set<string> },
		];
		// exclusionSetArg is the 6th positional arg to runScoring.
		expect(scoringArgs[5]).toBe(exclusionSet);
		expect(writeArgs[0].exclusionSet).toBe(exclusionSet);
	});

	it("passes undefined (not an empty Set) when the base exclusion set is empty", async () => {
		setupHappyPath({ exclusionSet: new Set() });

		await executeMatchSnapshotRefresh("acc-1", makePlan());

		const scoringArgs = mockRunScoring.mock.calls[0] as unknown[];
		const writeArgs = mockWriteMatchSnapshot.mock.calls[0] as [
			{ exclusionSet?: Set<string> },
		];
		expect(scoringArgs[5]).toBeUndefined();
		expect(writeArgs[0].exclusionSet).toBeUndefined();
	});
});
