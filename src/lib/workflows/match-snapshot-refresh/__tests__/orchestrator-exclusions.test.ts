/**
 * Integration tests for the match refresh orchestrator's exclusion handling.
 *
 * Safe metadata hard filters (language, vocal gender, release year, liked-at)
 * are read-time predicates (visible-suggestion-list.ts, Phase 9 / MSR-36/37) and
 * are NOT applied at snapshot/write time. The orchestrator therefore only folds
 * the BASE exclusion set (already-decided pairs + songs already in a target
 * playlist) into the set passed to matchBatch and writeMatchSnapshot. These tests
 * verify that base exclusions flow to both call sites as one shared set and that
 * a base-load failure degrades gracefully without aborting the refresh.
 *
 * All external collaborators are mocked at the module level so these tests
 * remain fully in-process with no DB or embedding calls.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — established before any dynamic imports so vi.mock hoisting works.
// ---------------------------------------------------------------------------

// Matches loaded from DB
const mockGetEntitledSongIds = vi.fn();
vi.mock("@/lib/workflows/enrichment-pipeline/batch", () => ({
	getEntitledDataEnrichedSongIds: (...args: unknown[]) =>
		mockGetEntitledSongIds(...args),
}));

// Song rows
const mockGetByIds = vi.fn();
vi.mock("@/lib/domains/library/songs/queries", () => ({
	getByIds: (...args: unknown[]) => mockGetByIds(...args),
}));

// Audio features
const mockGetBatch = vi.fn();
vi.mock("@/lib/domains/enrichment/audio-features/queries", () => ({
	getBatch: (...args: unknown[]) => mockGetBatch(...args),
}));

// Content analyses (reranker input)
const mockGetSongAnalyses = vi.fn();
vi.mock("@/lib/domains/enrichment/content-analysis/queries", () => ({
	get: (...args: unknown[]) => mockGetSongAnalyses(...args),
}));

// Embeddings
const mockGetEmbeddings = vi.fn();
vi.mock("@/lib/domains/enrichment/embeddings/service", () => ({
	EmbeddingService: {
		create: () =>
			Result.ok({
				getEmbeddings: (...args: unknown[]) => mockGetEmbeddings(...args),
				getEmbedding: vi.fn(),
			}),
	},
}));

// Profiling service (creates playlist profiles)
const mockLoadTargetPlaylistProfiles = vi.fn();
vi.mock("../profiles", () => ({
	loadTargetPlaylistProfiles: (...args: unknown[]) =>
		mockLoadTargetPlaylistProfiles(...args),
}));

// Playlist-profiling service (consumed by createMatchingService internally)
vi.mock("@/lib/domains/taste/playlist-profiling/service", () => ({
	createPlaylistProfilingService: () => ({}),
}));

// LLM service — optional, not needed in these tests
vi.mock("@/lib/integrations/llm/service", () => ({
	createLlmService: () => {
		throw new Error("LLM unavailable");
	},
}));

// Reranker service — the orchestrator constructs one up-front. The real no-arg
// constructor only validates static config and never throws; these tests produce
// no stored pairs, so rerank() is never reached. The method is stubbed to the
// provider-unavailable degradation (original order) to stay faithful regardless.
vi.mock("@/lib/integrations/reranker/service", () => ({
	RerankerService: class {
		rerank(_query: string, candidates: unknown[]) {
			return Promise.resolve(
				Result.ok({
					reranked: false,
					candidates,
					rerankedCount: 0,
					stats: { originalTopScore: 0, rerankTopScore: 0, scoreShift: 0 },
				}),
			);
		}
	},
	DEFAULT_RERANKER_CONFIG: {},
}));

// Base exclusion set
const mockLoadExclusionSet = vi.fn();
vi.mock("@/lib/workflows/enrichment-pipeline/stages/matching", () => ({
	loadExclusionSet: (...args: unknown[]) => mockLoadExclusionSet(...args),
}));

// matchBatch — capture the exclusion set it receives
const mockMatchBatch = vi.fn();
vi.mock("@/lib/domains/taste/song-matching/service", () => ({
	createMatchingService: () => ({
		matchBatch: (...args: unknown[]) => mockMatchBatch(...args),
	}),
}));

// writeMatchSnapshot — capture the exclusion set it receives
const mockWriteMatchSnapshot = vi.fn();
const mockWriteEmptySnapshot = vi.fn();
vi.mock("../write-match-snapshot", () => ({
	writeMatchSnapshot: (...args: unknown[]) => mockWriteMatchSnapshot(...args),
	writeEmptySnapshot: (...args: unknown[]) => mockWriteEmptySnapshot(...args),
}));

// Lightweight enrichment (target song enrichment — skip in tests)
vi.mock("@/lib/workflows/playlist-sync/lightweight-enrichment", () => ({
	runLightweightEnrichment: vi.fn().mockResolvedValue(undefined),
}));

// Progress persistence
vi.mock("@/lib/platform/jobs/repository", () => ({
	updateJobProgress: vi.fn().mockResolvedValue(Result.ok(undefined)),
}));

// Account label resolution
vi.mock("@/lib/observability/account-label", () => ({
	resolveAccountLabel: vi.fn().mockResolvedValue("test-user"),
}));

// Re-ranking (not exercised in these tests — no stored pairs are produced)
vi.mock("@/lib/workflows/enrichment-pipeline/reranking", () => ({
	rerankMatches: vi.fn().mockResolvedValue(undefined),
}));

// Embedding analysis text (not exercised)
vi.mock("@/lib/domains/enrichment/embeddings/analysis-text", () => ({
	flattenAnalysisText: vi.fn().mockReturnValue(""),
}));

// Dynamic import after all vi.mock calls
const { executeMatchSnapshotRefresh } = await import("../orchestrator");

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

function makePlan() {
	return { needsTargetSongEnrichment: false };
}

/**
 * Minimal playlist row. An active hard filter (e.g. languages) must NOT change
 * the write-time exclusion set, so fixtures can carry one to prove filters are
 * ignored at write time.
 */
function makePlaylist(id: string, matchFilters: unknown = { version: 1 }) {
	return { id, name: `Playlist ${id}`, match_filters: matchFilters };
}

function makeProfile(playlistId: string) {
	return {
		playlistId,
		embedding: [0.1, 0.2],
		audioCentroid: { energy: 0.5 },
		genreDistribution: { pop: 1.0 },
		hasGenrePills: false,
		matchIntent: null,
		genrePills: [],
	};
}

function makeSongRow(id: string) {
	return {
		id,
		spotify_id: `sp-${id}`,
		name: `Song ${id}`,
		artists: ["Artist"],
		genres: ["pop"],
	};
}

/** A successful matchBatch result with no matches. */
function emptyMatchResult() {
	return Result.ok({ matches: new Map() });
}

/** A successful writeMatchSnapshot result. */
function snapshotResult() {
	return {
		published: true,
		snapshotId: "snap-1",
		matchedSongCount: 0,
		candidateCount: 1,
		playlistCount: 1,
		isEmpty: false,
		noOp: false,
	};
}

// ---------------------------------------------------------------------------
// Helpers to set up default happy-path mocks for tests that focus on a single
// aspect.
// ---------------------------------------------------------------------------

function setupHappyPath({
	baseSongIds = ["song-1"],
	playlists = [makePlaylist("pl-1")],
	profiles = [makeProfile("pl-1")],
	baseExclusionSet = new Set<string>(),
}: {
	baseSongIds?: string[];
	playlists?: ReturnType<typeof makePlaylist>[];
	profiles?: ReturnType<typeof makeProfile>[];
	baseExclusionSet?: Set<string>;
} = {}) {
	mockLoadTargetPlaylistProfiles.mockResolvedValue({ playlists, profiles });
	mockGetEntitledSongIds.mockResolvedValue(baseSongIds);
	mockGetByIds.mockResolvedValue(
		Result.ok(baseSongIds.map((id) => makeSongRow(id))),
	);
	mockGetBatch.mockResolvedValue(Result.ok(new Map()));
	mockGetEmbeddings.mockResolvedValue(Result.ok(new Map()));
	mockLoadExclusionSet.mockResolvedValue(baseExclusionSet);
	mockMatchBatch.mockResolvedValue(emptyMatchResult());
	mockWriteMatchSnapshot.mockResolvedValue(snapshotResult());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeMatchSnapshotRefresh — base exclusion set", () => {
	beforeEach(() => vi.clearAllMocks());

	it("passes base exclusions to matchBatch", async () => {
		setupHappyPath({
			baseSongIds: ["song-1", "song-2"],
			baseExclusionSet: new Set(["song-1:pl-1"]),
		});

		await executeMatchSnapshotRefresh("acc-1", makePlan());

		const [, , , opts] = mockMatchBatch.mock.calls[0] as [
			unknown,
			unknown,
			unknown,
			{ exclusionSet: Set<string> } | undefined,
		];
		expect(opts?.exclusionSet.has("song-1:pl-1")).toBe(true);
	});

	it("passes the same base set to writeMatchSnapshot", async () => {
		setupHappyPath({
			baseSongIds: ["song-1"],
			baseExclusionSet: new Set(["song-1:pl-1"]),
		});

		await executeMatchSnapshotRefresh("acc-1", makePlan());

		const [writeOpts] = mockWriteMatchSnapshot.mock.calls[0] as [
			{ exclusionSet?: Set<string> },
		];
		expect(writeOpts.exclusionSet?.has("song-1:pl-1")).toBe(true);
	});

	it("does not apply metadata hard filters at write time — an active filter does not alter the exclusion set", async () => {
		// A playlist with an active language filter must not exclude any pair at
		// write time; filters are read-time only, so the stored set is base-only.
		setupHappyPath({
			baseSongIds: ["song-1"],
			playlists: [
				makePlaylist("pl-1", { version: 1, languages: { codes: ["pt"] } }),
			],
			profiles: [makeProfile("pl-1")],
			baseExclusionSet: new Set(),
		});

		await executeMatchSnapshotRefresh("acc-1", makePlan());

		// Empty base + no write-time filters → no exclusionSet arg at all.
		const [, , , matchOpts] = mockMatchBatch.mock.calls[0] as [
			unknown,
			unknown,
			unknown,
			{ exclusionSet: Set<string> } | undefined,
		];
		expect(matchOpts).toBeUndefined();

		const [writeOpts] = mockWriteMatchSnapshot.mock.calls[0] as [
			{ exclusionSet?: Set<string> },
		];
		expect(writeOpts.exclusionSet).toBeUndefined();
	});

	it("base-load failure → empty exclusions, refresh still completes", async () => {
		setupHappyPath({ baseSongIds: ["song-1"] });
		mockLoadExclusionSet.mockRejectedValue(new Error("DB timeout"));

		const outcome = await executeMatchSnapshotRefresh("acc-1", makePlan());

		expect(outcome.status).toBe("published");
		if (outcome.status === "published") {
			expect(outcome.result.published).toBe(true);
		}

		// No exclusionSet arg when the only source (base) failed to load.
		const [, , , matchOpts] = mockMatchBatch.mock.calls[0] as [
			unknown,
			unknown,
			unknown,
			{ exclusionSet: Set<string> } | undefined,
		];
		expect(matchOpts).toBeUndefined();
	});

	it("matchBatch and writeMatchSnapshot receive the EXACT SAME exclusion set reference", async () => {
		// Both call sites must consume the identical computed set so a future
		// refactor cannot silently diverge them.
		setupHappyPath({
			baseSongIds: ["song-1", "song-2"],
			baseExclusionSet: new Set(["song-1:pl-1", "song-2:pl-1"]),
		});

		await executeMatchSnapshotRefresh("acc-1", makePlan());

		const [, , , matchOpts] = mockMatchBatch.mock.calls[0] as [
			unknown,
			unknown,
			unknown,
			{ exclusionSet: Set<string> } | undefined,
		];
		const [writeOpts] = mockWriteMatchSnapshot.mock.calls[0] as [
			{ exclusionSet?: Set<string> },
		];

		// Same object reference — not just deep-equal.
		expect(matchOpts?.exclusionSet).toBe(writeOpts.exclusionSet);
		expect(matchOpts?.exclusionSet.has("song-1:pl-1")).toBe(true);
		expect(matchOpts?.exclusionSet.has("song-2:pl-1")).toBe(true);
	});

	it("empty base → no exclusionSet arg passed to matchBatch or writeMatchSnapshot", async () => {
		setupHappyPath({
			baseSongIds: ["song-1"],
			baseExclusionSet: new Set(),
		});

		await executeMatchSnapshotRefresh("acc-1", makePlan());

		const [, , , matchOpts] = mockMatchBatch.mock.calls[0] as [
			unknown,
			unknown,
			unknown,
			{ exclusionSet: Set<string> } | undefined,
		];
		expect(matchOpts).toBeUndefined();

		const [writeOpts] = mockWriteMatchSnapshot.mock.calls[0] as [
			{ exclusionSet?: Set<string> },
		];
		expect(writeOpts.exclusionSet).toBeUndefined();
	});
});

describe("executeMatchSnapshotRefresh — soft profile path unchanged", () => {
	beforeEach(() => vi.clearAllMocks());

	it("still invokes matchBatch with matchingSongs and profiles", async () => {
		setupHappyPath({ baseSongIds: ["song-1"] });

		await executeMatchSnapshotRefresh("acc-1", makePlan());

		const [songs, profiles] = mockMatchBatch.mock.calls[0] as [
			Array<{ id: string }>,
			Array<{ playlistId: string }>,
		];
		expect(songs[0].id).toBe("song-1");
		expect(profiles[0].playlistId).toBe("pl-1");
	});

	it("does not call matchBatch when candidate set is empty (early-return path)", async () => {
		mockLoadTargetPlaylistProfiles.mockResolvedValue({
			playlists: [makePlaylist("pl-1")],
			profiles: [makeProfile("pl-1")],
		});
		mockGetEntitledSongIds.mockResolvedValue([]);
		mockWriteMatchSnapshot.mockResolvedValue(snapshotResult());

		await executeMatchSnapshotRefresh("acc-1", makePlan());

		expect(mockMatchBatch).not.toHaveBeenCalled();
	});
});
