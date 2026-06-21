/**
 * Integration tests for CMHF-12 — effective exclusion set orchestration.
 *
 * Verifies that filter exclusions are unioned with base exclusions before
 * being passed to matchBatch and writeMatchSnapshot, and that degraded
 * paths (base load failure, filter metadata failure) behave correctly.
 *
 * All external collaborators are mocked at the module level so these tests
 * remain fully in-process with no DB or embedding calls.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchFiltersExclusionSummary } from "@/lib/domains/taste/match-filters/types";

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

// Reranker service — optional
vi.mock("@/lib/integrations/reranker/service", () => ({
	RerankerService: class {
		constructor() {
			throw new Error("Reranker unavailable");
		}
	},
	DEFAULT_RERANKER_CONFIG: {},
}));

// Base exclusion set
const mockLoadExclusionSet = vi.fn();
vi.mock("@/lib/workflows/enrichment-pipeline/stages/matching", () => ({
	loadExclusionSet: (...args: unknown[]) => mockLoadExclusionSet(...args),
}));

// Filter exclusions (CMHF-11)
const mockLoadMatchFilterExclusions = vi.fn();
vi.mock("../match-filter-exclusions", () => ({
	loadMatchFilterExclusions: (...args: unknown[]) =>
		mockLoadMatchFilterExclusions(...args),
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

// Re-ranking (not exercised in these tests — reranker is always unavailable)
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

/** Minimal playlist row with no filters active. */
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

/** A non-degraded summary with zero exclusions. */
function emptyFilterSummary(): MatchFiltersExclusionSummary {
	return {
		activeFilterPlaylistCount: 0,
		candidatePairCount: 0,
		excludedPairCount: 0,
		failedChecksByType: {
			languages: 0,
			releaseYear: 0,
			likedAt: 0,
			vocalGender: 0,
		},
		excludedPairsByPlaylist: {},
		invalidStoredFiltersByPlaylist: {},
		degraded: { baseExclusions: false, filterMetadata: false },
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
	filterExclusions = new Set<string>(),
	filterSummary = emptyFilterSummary(),
}: {
	baseSongIds?: string[];
	playlists?: ReturnType<typeof makePlaylist>[];
	profiles?: ReturnType<typeof makeProfile>[];
	baseExclusionSet?: Set<string>;
	filterExclusions?: Set<string>;
	filterSummary?: MatchFiltersExclusionSummary;
} = {}) {
	mockLoadTargetPlaylistProfiles.mockResolvedValue({ playlists, profiles });
	mockGetEntitledSongIds.mockResolvedValue(baseSongIds);
	mockGetByIds.mockResolvedValue(
		Result.ok(baseSongIds.map((id) => makeSongRow(id))),
	);
	mockGetBatch.mockResolvedValue(Result.ok(new Map()));
	mockGetEmbeddings.mockResolvedValue(Result.ok(new Map()));
	mockLoadExclusionSet.mockResolvedValue(baseExclusionSet);
	mockLoadMatchFilterExclusions.mockResolvedValue({
		exclusions: filterExclusions,
		summary: filterSummary,
	});
	mockMatchBatch.mockResolvedValue(emptyMatchResult());
	mockWriteMatchSnapshot.mockResolvedValue(snapshotResult());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeMatchSnapshotRefresh — effective exclusion set (CMHF-12)", () => {
	beforeEach(() => vi.clearAllMocks());

	it("passes union of base + filter exclusions to matchBatch", async () => {
		const baseSet = new Set(["song-1:pl-1"]);
		const filterSet = new Set(["song-2:pl-1"]);

		setupHappyPath({
			baseSongIds: ["song-1", "song-2"],
			baseExclusionSet: baseSet,
			filterExclusions: filterSet,
		});

		await executeMatchSnapshotRefresh("acc-1", makePlan());

		const [, , , opts] = mockMatchBatch.mock.calls[0] as [
			unknown,
			unknown,
			unknown,
			{ exclusionSet: Set<string> } | undefined,
		];
		expect(opts?.exclusionSet.has("song-1:pl-1")).toBe(true);
		expect(opts?.exclusionSet.has("song-2:pl-1")).toBe(true);
	});

	it("passes the same effective set to writeMatchSnapshot", async () => {
		const baseSet = new Set(["song-1:pl-1"]);
		const filterSet = new Set(["song-2:pl-1"]);

		setupHappyPath({
			baseSongIds: ["song-1", "song-2"],
			baseExclusionSet: baseSet,
			filterExclusions: filterSet,
		});

		await executeMatchSnapshotRefresh("acc-1", makePlan());

		const [writeOpts] = mockWriteMatchSnapshot.mock.calls[0] as [
			{ exclusionSet?: Set<string> },
		];
		expect(writeOpts.exclusionSet?.has("song-1:pl-1")).toBe(true);
		expect(writeOpts.exclusionSet?.has("song-2:pl-1")).toBe(true);
	});

	it("filter-only change alters the exclusion set passed to writeMatchSnapshot (hash participation)", async () => {
		// First call: no filter exclusions.
		const summaryA = emptyFilterSummary();
		setupHappyPath({
			baseSongIds: ["song-1"],
			baseExclusionSet: new Set(),
			filterExclusions: new Set(),
			filterSummary: summaryA,
		});
		await executeMatchSnapshotRefresh("acc-1", makePlan());

		const [optsA] = mockWriteMatchSnapshot.mock.calls[0] as [
			{ exclusionSet?: Set<string> },
		];

		vi.clearAllMocks();

		// Second call: same base, but now a filter excludes song-1:pl-1.
		const summaryB: MatchFiltersExclusionSummary = {
			...emptyFilterSummary(),
			activeFilterPlaylistCount: 1,
			candidatePairCount: 1,
			excludedPairCount: 1,
		};
		setupHappyPath({
			baseSongIds: ["song-1"],
			baseExclusionSet: new Set(),
			filterExclusions: new Set(["song-1:pl-1"]),
			filterSummary: summaryB,
		});
		await executeMatchSnapshotRefresh("acc-1", makePlan());

		const [optsB] = mockWriteMatchSnapshot.mock.calls[0] as [
			{ exclusionSet?: Set<string> },
		];

		// A: no exclusionSet (empty effective set → undefined).
		// B: exclusionSet includes the filter key.
		expect(optsA.exclusionSet).toBeUndefined();
		expect(optsB.exclusionSet?.has("song-1:pl-1")).toBe(true);
	});

	it("base-load failure → empty base, filter exclusions still applied, degraded.baseExclusions=true", async () => {
		const filterSet = new Set(["song-1:pl-1"]);
		const summary = emptyFilterSummary();

		setupHappyPath({
			baseSongIds: ["song-1"],
			filterExclusions: filterSet,
			filterSummary: summary,
		});
		// Make base load throw.
		mockLoadExclusionSet.mockRejectedValue(new Error("DB timeout"));

		await executeMatchSnapshotRefresh("acc-1", makePlan());

		// Filter exclusions still reach matchBatch.
		const [, , , matchOpts] = mockMatchBatch.mock.calls[0] as [
			unknown,
			unknown,
			unknown,
			{ exclusionSet: Set<string> } | undefined,
		];
		expect(matchOpts?.exclusionSet.has("song-1:pl-1")).toBe(true);

		// writeMatchSnapshot also receives the filter-only effective set.
		const [writeOpts] = mockWriteMatchSnapshot.mock.calls[0] as [
			{ exclusionSet?: Set<string> },
		];
		expect(writeOpts.exclusionSet?.has("song-1:pl-1")).toBe(true);

		// The summary passed to loadMatchFilterExclusions had degraded.baseExclusions
		// mutated to true by the orchestrator. Verify by checking what was logged
		// (indirectly through the mock return — the mock returns the same object that
		// gets mutated, so we can inspect it after the call).
		expect(summary.degraded.baseExclusions).toBe(true);
	});

	it("base-load failure is not fatal — refresh completes successfully", async () => {
		setupHappyPath({ baseSongIds: ["song-1"] });
		mockLoadExclusionSet.mockRejectedValue(new Error("transient failure"));

		const result = await executeMatchSnapshotRefresh("acc-1", makePlan());
		expect(result.published).toBe(true);
	});

	it("filter metadata failure → empty filter exclusions, base exclusions still applied", async () => {
		const baseSet = new Set(["song-1:pl-1"]);
		const degradedSummary: MatchFiltersExclusionSummary = {
			...emptyFilterSummary(),
			degraded: { baseExclusions: false, filterMetadata: true },
		};

		setupHappyPath({
			baseSongIds: ["song-1"],
			baseExclusionSet: baseSet,
			filterExclusions: new Set(),
			filterSummary: degradedSummary,
		});

		await executeMatchSnapshotRefresh("acc-1", makePlan());

		// Base exclusion still in the effective set.
		const [, , , matchOpts] = mockMatchBatch.mock.calls[0] as [
			unknown,
			unknown,
			unknown,
			{ exclusionSet: Set<string> } | undefined,
		];
		expect(matchOpts?.exclusionSet.has("song-1:pl-1")).toBe(true);
	});

	it("matchBatch and writeMatchSnapshot receive the EXACT SAME effective exclusion set reference", async () => {
		// Both call sites must consume the identical computed set so a future refactor
		// cannot silently diverge them (NIT-5 / MAJOR-2).
		const baseSet = new Set(["song-1:pl-1"]);
		const filterSet = new Set(["song-2:pl-1"]);

		setupHappyPath({
			baseSongIds: ["song-1", "song-2"],
			baseExclusionSet: baseSet,
			filterExclusions: filterSet,
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

		// Both must be the same object reference — not just deep-equal — proving
		// a single computed value is reused at both call sites.
		expect(matchOpts?.exclusionSet).toBe(writeOpts.exclusionSet);
		// And the contents are what we expect.
		expect(matchOpts?.exclusionSet.has("song-1:pl-1")).toBe(true);
		expect(matchOpts?.exclusionSet.has("song-2:pl-1")).toBe(true);
	});

	it("empty base and empty filter → no exclusionSet arg passed to matchBatch or writeMatchSnapshot", async () => {
		setupHappyPath({
			baseSongIds: ["song-1"],
			baseExclusionSet: new Set(),
			filterExclusions: new Set(),
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

	it("loadMatchFilterExclusions receives the target playlists loaded earlier", async () => {
		const playlists = [
			makePlaylist("pl-1", { version: 1, languages: { codes: ["pt"] } }),
			makePlaylist("pl-2"),
		];
		const profiles = [makeProfile("pl-1"), makeProfile("pl-2")];

		setupHappyPath({ baseSongIds: ["song-1"], playlists, profiles });

		await executeMatchSnapshotRefresh("acc-1", makePlan());

		const filterInput = mockLoadMatchFilterExclusions.mock.calls[0][0] as {
			accountId: string;
			playlists: unknown[];
			candidateSongIds: string[];
		};
		expect(filterInput.accountId).toBe("acc-1");
		expect(filterInput.playlists).toHaveLength(2);
		expect(filterInput.candidateSongIds).toEqual(["song-1"]);
	});
});

describe("executeMatchSnapshotRefresh — soft profile path unchanged (CMHF-12)", () => {
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
		expect(mockLoadMatchFilterExclusions).not.toHaveBeenCalled();
	});
});
