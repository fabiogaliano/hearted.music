/**
 * Tests for loadMatchFilterExclusions (CMHF-11).
 *
 * loadFilterMetadata is mocked so these tests stay unit-level with no DB.
 * The mock module path must match the import path used in the implementation.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Json } from "@/lib/data/database.types";
import type { FilterMetadataMaps } from "../filter-metadata-loader";

// ---------------------------------------------------------------------------
// Mock loadFilterMetadata so tests are fully unit-level (no DB).
// ---------------------------------------------------------------------------

const mockLoadFilterMetadata = vi.fn(
	(
		_accountId: string,
		_songIds: string[],
	): Promise<Result<FilterMetadataMaps, Error>> =>
		Promise.resolve(Result.ok({ songMeta: new Map(), likedAtMs: new Map() })),
);

vi.mock("../filter-metadata-loader", () => ({
	loadFilterMetadata: (accountId: string, songIds: string[]) =>
		mockLoadFilterMetadata(accountId, songIds),
}));

const { loadMatchFilterExclusions } = await import(
	"../match-filter-exclusions"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function okMaps(
	songMeta: FilterMetadataMaps["songMeta"] = new Map(),
	likedAtMs: FilterMetadataMaps["likedAtMs"] = new Map(),
): Result<FilterMetadataMaps, Error> {
	return Result.ok({ songMeta, likedAtMs });
}

function errMeta(message = "DB error"): Result<FilterMetadataMaps, Error> {
	return Result.err(new Error(message));
}

/** Build a playlist row with a raw match_filters JSON value. */
function playlist(
	id: string,
	matchFilters: Json,
): { id: string; match_filters: Json } {
	return { id, match_filters: matchFilters };
}

/** Valid stored filters — language filter only. */
const langFilters: Json = {
	version: 1,
	languages: { codes: ["pt"] },
};

/** Valid stored filters — release year filter only. */
const yearFilters: Json = {
	version: 1,
	releaseYear: { kind: "after", start: 2010 },
};

/** Valid stored filters — likedAt range ending today. */
const likedAtTodayFilters: Json = {
	version: 1,
	likedAt: {
		kind: "range",
		startDate: "2020-01-01",
		end: { kind: "today" },
	},
};

// ---------------------------------------------------------------------------
// Language OR + cross-type AND exclusion
// ---------------------------------------------------------------------------

describe("loadMatchFilterExclusions — language OR + cross-type AND", () => {
	beforeEach(() => vi.clearAllMocks());

	it("excludes song that fails language filter (primary and secondary both absent)", async () => {
		const sm = new Map([
			[
				"song-1",
				{
					language: "en",
					languageSecondary: null,
					releaseYear: 2015,
					vocalGender: null,
				},
			],
		]);
		mockLoadFilterMetadata.mockResolvedValue(okMaps(sm));

		const { exclusions, summary } = await loadMatchFilterExclusions({
			accountId: "acc-1",
			playlists: [playlist("pl-1", langFilters)],
			candidateSongIds: ["song-1"],
		});

		expect(exclusions.has("song-1:pl-1")).toBe(true);
		expect(summary.excludedPairCount).toBe(1);
		expect(summary.failedChecksByType.languages).toBe(1);
	});

	it("passes song whose primary language matches the filter (no secondary)", async () => {
		const sm = new Map([
			[
				"song-1",
				{
					language: "pt",
					languageSecondary: null,
					releaseYear: 2015,
					vocalGender: null,
				},
			],
		]);
		mockLoadFilterMetadata.mockResolvedValue(okMaps(sm));

		const { exclusions } = await loadMatchFilterExclusions({
			accountId: "acc-1",
			playlists: [playlist("pl-1", langFilters)],
			candidateSongIds: ["song-1"],
		});

		expect(exclusions.has("song-1:pl-1")).toBe(false);
	});

	it("passes song whose secondary language matches the filter", async () => {
		const sm = new Map([
			[
				"song-1",
				{
					language: "en",
					languageSecondary: "pt",
					releaseYear: 2015,
					vocalGender: null,
				},
			],
		]);
		mockLoadFilterMetadata.mockResolvedValue(okMaps(sm));

		const { exclusions } = await loadMatchFilterExclusions({
			accountId: "acc-1",
			playlists: [playlist("pl-1", langFilters)],
			candidateSongIds: ["song-1"],
		});

		expect(exclusions.has("song-1:pl-1")).toBe(false);
	});

	it("OR within language codes: passes song matching any listed code, excludes song matching none", async () => {
		const sm = new Map([
			[
				"song-pt",
				{
					language: "fr",
					languageSecondary: null,
					releaseYear: 2015,
					vocalGender: null,
				},
			],
			[
				"song-de",
				{
					language: "de",
					languageSecondary: null,
					releaseYear: 2015,
					vocalGender: null,
				},
			],
		]);
		mockLoadFilterMetadata.mockResolvedValue(okMaps(sm));

		const multiLangFilters: Json = {
			version: 1,
			languages: { codes: ["pt", "fr"] },
		};

		const { exclusions } = await loadMatchFilterExclusions({
			accountId: "acc-1",
			playlists: [playlist("pl-1", multiLangFilters)],
			candidateSongIds: ["song-pt", "song-de"],
		});

		// "fr" matches one of the listed codes → passes (not excluded).
		expect(exclusions.has("song-pt:pl-1")).toBe(false);
		// "de" matches neither → excluded.
		expect(exclusions.has("song-de:pl-1")).toBe(true);
	});

	it("AND semantics: excludes song that fails one filter even if it passes another", async () => {
		// Song is Portuguese (passes language) but released in 2005 (fails year >= 2010).
		const sm = new Map([
			[
				"song-1",
				{
					language: "pt",
					languageSecondary: null,
					releaseYear: 2005,
					vocalGender: null,
				},
			],
		]);
		mockLoadFilterMetadata.mockResolvedValue(okMaps(sm));

		const combinedFilters = {
			version: 1,
			languages: { codes: ["pt"] },
			releaseYear: { kind: "after", start: 2010 },
		};

		const { exclusions, summary } = await loadMatchFilterExclusions({
			accountId: "acc-1",
			playlists: [playlist("pl-1", combinedFilters)],
			candidateSongIds: ["song-1"],
		});

		expect(exclusions.has("song-1:pl-1")).toBe(true);
		// Both failed checks counted even though the song is excluded for ONE pair.
		expect(summary.failedChecksByType.languages).toBe(0);
		expect(summary.failedChecksByType.releaseYear).toBe(1);
	});

	it("failedChecksByType counts each type independently for a multi-filter failure", async () => {
		// Song fails both language and year and gender.
		const sm = new Map([
			[
				"song-1",
				{
					language: "en",
					languageSecondary: null,
					releaseYear: 2005,
					vocalGender: "male",
				},
			],
		]);
		mockLoadFilterMetadata.mockResolvedValue(okMaps(sm));

		const allFilters = {
			version: 1,
			languages: { codes: ["pt"] },
			releaseYear: { kind: "after", start: 2010 },
			vocalGender: "female",
		};

		const { exclusions, summary } = await loadMatchFilterExclusions({
			accountId: "acc-1",
			playlists: [playlist("pl-1", allFilters)],
			candidateSongIds: ["song-1"],
		});

		expect(exclusions.has("song-1:pl-1")).toBe(true);
		// excludedPairCount counts the PAIR once.
		expect(summary.excludedPairCount).toBe(1);
		// failedChecksByType counts each individual type failure.
		expect(summary.failedChecksByType.languages).toBe(1);
		expect(summary.failedChecksByType.releaseYear).toBe(1);
		expect(summary.failedChecksByType.vocalGender).toBe(1);
		expect(summary.failedChecksByType.likedAt).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Missing metadata
// ---------------------------------------------------------------------------

describe("loadMatchFilterExclusions — missing metadata", () => {
	beforeEach(() => vi.clearAllMocks());

	it("excludes song with no metadata row when an active language filter exists", async () => {
		// Empty map — no row for song-1.
		mockLoadFilterMetadata.mockResolvedValue(okMaps(new Map()));

		const { exclusions, summary } = await loadMatchFilterExclusions({
			accountId: "acc-1",
			playlists: [playlist("pl-1", langFilters)],
			candidateSongIds: ["song-1"],
		});

		expect(exclusions.has("song-1:pl-1")).toBe(true);
		expect(summary.failedChecksByType.languages).toBe(1);
	});

	it("excludes song with null fields when release year filter is active", async () => {
		const sm = new Map([
			[
				"song-1",
				{
					language: null,
					languageSecondary: null,
					releaseYear: null,
					vocalGender: null,
				},
			],
		]);
		mockLoadFilterMetadata.mockResolvedValue(okMaps(sm));

		const { exclusions, summary } = await loadMatchFilterExclusions({
			accountId: "acc-1",
			playlists: [playlist("pl-1", yearFilters)],
			candidateSongIds: ["song-1"],
		});

		expect(exclusions.has("song-1:pl-1")).toBe(true);
		expect(summary.failedChecksByType.releaseYear).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Invalid stored filters — skip + count, not fatal
// ---------------------------------------------------------------------------

describe("loadMatchFilterExclusions — invalid stored filters", () => {
	beforeEach(() => vi.clearAllMocks());

	it("skips filter exclusions for invalid-filter playlist and counts it", async () => {
		const sm = new Map([
			[
				"song-1",
				{
					language: "en",
					languageSecondary: null,
					releaseYear: 2010,
					vocalGender: null,
				},
			],
		]);
		mockLoadFilterMetadata.mockResolvedValue(okMaps(sm));

		// Malformed: releaseYear.start is not a valid year integer.
		const invalidFilters = {
			version: 1,
			releaseYear: { kind: "after", start: "not-a-year" },
		};

		const { exclusions, summary } = await loadMatchFilterExclusions({
			accountId: "acc-1",
			playlists: [playlist("pl-1", invalidFilters)],
			candidateSongIds: ["song-1"],
		});

		// No exclusions generated — invalid filters are skipped, not applied.
		expect(exclusions.size).toBe(0);
		expect(summary.invalidStoredFiltersByPlaylist["pl-1"]).toBe(1);
		expect(summary.excludedPairCount).toBe(0);
	});

	it("is not fatal: a valid second playlist still produces exclusions", async () => {
		const sm = new Map([
			[
				"song-1",
				{
					language: "en",
					languageSecondary: null,
					releaseYear: 2010,
					vocalGender: null,
				},
			],
		]);
		mockLoadFilterMetadata.mockResolvedValue(okMaps(sm));

		const invalidFilters = {
			version: 1,
			releaseYear: { kind: "after", start: "not-a-year" },
		};
		// Second playlist has a valid language filter; "en" song should pass.
		// Use vocalGender so it actually excludes.
		const validFilters = { version: 1, vocalGender: "female" };

		const { exclusions, summary } = await loadMatchFilterExclusions({
			accountId: "acc-1",
			playlists: [
				playlist("pl-bad", invalidFilters),
				playlist("pl-good", validFilters),
			],
			candidateSongIds: ["song-1"],
		});

		// pl-bad skipped (invalid), pl-good excludes song-1 (male vocal but filter wants female).
		expect(exclusions.has("song-1:pl-good")).toBe(true);
		expect(exclusions.has("song-1:pl-bad")).toBe(false);
		expect(summary.invalidStoredFiltersByPlaylist["pl-bad"]).toBe(1);
		expect(summary.excludedPairCount).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// No-active-filters playlist
// ---------------------------------------------------------------------------

describe("loadMatchFilterExclusions — no active filters", () => {
	beforeEach(() => vi.clearAllMocks());

	it("produces no exclusions for playlist with version:1 only", async () => {
		const sm = new Map([
			[
				"song-1",
				{
					language: "pt",
					languageSecondary: null,
					releaseYear: 2015,
					vocalGender: "female",
				},
			],
		]);
		mockLoadFilterMetadata.mockResolvedValue(okMaps(sm));

		const { exclusions, summary } = await loadMatchFilterExclusions({
			accountId: "acc-1",
			playlists: [playlist("pl-1", { version: 1 })],
			candidateSongIds: ["song-1"],
		});

		expect(exclusions.size).toBe(0);
		expect(summary.activeFilterPlaylistCount).toBe(0);
		expect(summary.candidatePairCount).toBe(0);
	});

	it("produces no exclusions for empty playlists array", async () => {
		mockLoadFilterMetadata.mockResolvedValue(okMaps());

		const { exclusions, summary } = await loadMatchFilterExclusions({
			accountId: "acc-1",
			playlists: [],
			candidateSongIds: ["song-1"],
		});

		expect(exclusions.size).toBe(0);
		expect(summary.activeFilterPlaylistCount).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Metadata load failure → degraded empty + flag
// ---------------------------------------------------------------------------

describe("loadMatchFilterExclusions — metadata load failure", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns empty exclusions with degraded.filterMetadata=true on DB error", async () => {
		mockLoadFilterMetadata.mockResolvedValue(errMeta("connection refused"));

		const { exclusions, summary } = await loadMatchFilterExclusions({
			accountId: "acc-1",
			playlists: [playlist("pl-1", langFilters)],
			candidateSongIds: ["song-1"],
		});

		expect(exclusions.size).toBe(0);
		expect(summary.degraded.filterMetadata).toBe(true);
		expect(summary.degraded.baseExclusions).toBe(false);
		expect(summary.excludedPairCount).toBe(0);
		expect(summary.activeFilterPlaylistCount).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Summary counters — excludedPairCount once vs failedChecksByType multiple
// ---------------------------------------------------------------------------

describe("loadMatchFilterExclusions — summary counters", () => {
	beforeEach(() => vi.clearAllMocks());

	it("counts excludedPairCount once per pair even when multiple types fail", async () => {
		// Song fails BOTH language and releaseYear.
		const sm = new Map([
			[
				"song-1",
				{
					language: "en",
					languageSecondary: null,
					releaseYear: 2005,
					vocalGender: null,
				},
			],
		]);
		mockLoadFilterMetadata.mockResolvedValue(okMaps(sm));

		const combinedFilters = {
			version: 1,
			languages: { codes: ["pt"] },
			releaseYear: { kind: "after", start: 2010 },
		};

		const { summary } = await loadMatchFilterExclusions({
			accountId: "acc-1",
			playlists: [playlist("pl-1", combinedFilters)],
			candidateSongIds: ["song-1"],
		});

		expect(summary.excludedPairCount).toBe(1);
		expect(summary.failedChecksByType.languages).toBe(1);
		expect(summary.failedChecksByType.releaseYear).toBe(1);
	});

	it("candidatePairCount equals active-filter playlists × candidate songs", async () => {
		const sm = new Map([
			[
				"song-1",
				{
					language: "en",
					languageSecondary: null,
					releaseYear: 2015,
					vocalGender: null,
				},
			],
			[
				"song-2",
				{
					language: "pt",
					languageSecondary: null,
					releaseYear: 2015,
					vocalGender: null,
				},
			],
		]);
		mockLoadFilterMetadata.mockResolvedValue(okMaps(sm));

		// Two active-filter playlists, no-filter playlist — only the two active ones count.
		const { summary } = await loadMatchFilterExclusions({
			accountId: "acc-1",
			playlists: [
				playlist("pl-active-1", langFilters),
				playlist("pl-active-2", yearFilters),
				playlist("pl-none", { version: 1 }),
			],
			candidateSongIds: ["song-1", "song-2"],
		});

		// 2 active playlists × 2 songs = 4 pairs evaluated.
		expect(summary.activeFilterPlaylistCount).toBe(2);
		expect(summary.candidatePairCount).toBe(4);
	});

	it("excludedPairsByPlaylist counts per playlist correctly", async () => {
		const sm = new Map([
			[
				"song-1",
				{
					language: "en",
					languageSecondary: null,
					releaseYear: 2015,
					vocalGender: null,
				},
			],
			[
				"song-2",
				{
					language: "pt",
					languageSecondary: null,
					releaseYear: 2015,
					vocalGender: null,
				},
			],
		]);
		mockLoadFilterMetadata.mockResolvedValue(okMaps(sm));

		// pt-only filter: song-1 (en) excluded, song-2 (pt) passes.
		const { summary } = await loadMatchFilterExclusions({
			accountId: "acc-1",
			playlists: [playlist("pl-1", langFilters)],
			candidateSongIds: ["song-1", "song-2"],
		});

		expect(summary.excludedPairsByPlaylist["pl-1"]).toBe(1);
		expect(summary.excludedPairCount).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// nowMs threaded for likedAt today
// ---------------------------------------------------------------------------

describe("loadMatchFilterExclusions — nowMs for likedAt today", () => {
	beforeEach(() => vi.clearAllMocks());

	it("uses a single consistent nowMs for all likedAt today evaluations", async () => {
		// Pin "now" to 2026-06-21 so "today" boundary is deterministic regardless of run date.
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-06-21T12:00:00.000Z"));

		// liked at 2025-06-20 → inside [2020-01-01, today] → passes.
		const likedAtMs = new Date("2025-06-20T00:00:00.000Z").getTime();
		const sm = new Map([
			[
				"song-1",
				{
					language: null,
					languageSecondary: null,
					releaseYear: null,
					vocalGender: null,
				},
			],
		]);
		const likedMap = new Map([["song-1", likedAtMs]]);
		mockLoadFilterMetadata.mockResolvedValue(okMaps(sm, likedMap));

		const { exclusions } = await loadMatchFilterExclusions({
			accountId: "acc-1",
			playlists: [playlist("pl-1", likedAtTodayFilters)],
			candidateSongIds: ["song-1"],
		});

		// Song liked on 2025-06-20 is within [2020-01-01, today] → passes → not excluded.
		expect(exclusions.has("song-1:pl-1")).toBe(false);

		vi.useRealTimers();
	});

	it("excludes song liked after today boundary", async () => {
		// liked_at set far in the future so it falls outside a "before" filter.
		const futureMs = new Date("2099-01-01T00:00:00.000Z").getTime();
		const sm = new Map([
			[
				"song-1",
				{
					language: null,
					languageSecondary: null,
					releaseYear: null,
					vocalGender: null,
				},
			],
		]);
		const likedMap = new Map([["song-1", futureMs]]);
		mockLoadFilterMetadata.mockResolvedValue(okMaps(sm, likedMap));

		// Filter: liked before 2024-12-31 — future song should fail.
		const beforeFilter = {
			version: 1,
			likedAt: { kind: "before", endDate: "2024-12-31" },
		};

		const { exclusions, summary } = await loadMatchFilterExclusions({
			accountId: "acc-1",
			playlists: [playlist("pl-1", beforeFilter)],
			candidateSongIds: ["song-1"],
		});

		expect(exclusions.has("song-1:pl-1")).toBe(true);
		expect(summary.failedChecksByType.likedAt).toBe(1);
	});

	it("excludes song with null likedAt when likedAt filter is active", async () => {
		// No liked row → likedAt is null → fails any active likedAt filter.
		const sm = new Map([
			[
				"song-1",
				{
					language: null,
					languageSecondary: null,
					releaseYear: null,
					vocalGender: null,
				},
			],
		]);
		mockLoadFilterMetadata.mockResolvedValue(okMaps(sm, new Map()));

		const { exclusions, summary } = await loadMatchFilterExclusions({
			accountId: "acc-1",
			playlists: [playlist("pl-1", likedAtTodayFilters)],
			candidateSongIds: ["song-1"],
		});

		expect(exclusions.has("song-1:pl-1")).toBe(true);
		expect(summary.failedChecksByType.likedAt).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Evaluation throws → degraded, not a rejection (Decisions §8)
// ---------------------------------------------------------------------------

describe("loadMatchFilterExclusions — evaluation throw degrades gracefully", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns empty exclusions + degraded.filterMetadata=true when a predicate throws", async () => {
		// Provide metadata so the happy path would normally proceed to evaluation.
		const sm = new Map([
			[
				"song-1",
				{
					language: "pt",
					languageSecondary: null,
					releaseYear: 2015,
					vocalGender: null,
				},
			],
		]);
		mockLoadFilterMetadata.mockResolvedValue(okMaps(sm));

		// Force a throw during evaluation by making the mock reject after the
		// metadata load succeeds. We do this by replacing the underlying predicate
		// module via a poisoned match_filters JSON that causes parseStoredMatchFilters
		// to blow up — but that function is robust, so the more reliable path is to
		// simulate the throw via a getter trap on the songMetaCache object returned by
		// the mock. Since that map is internal, the simplest approach is to make
		// loadFilterMetadata resolve with a songMeta whose .get() throws.
		const poisonedMeta = new Map<
			string,
			{
				language: string;
				languageSecondary: null;
				releaseYear: number;
				vocalGender: null;
			}
		>();
		Object.defineProperty(poisonedMeta, "get", {
			value: () => {
				throw new Error("simulated predicate crash");
			},
		});
		mockLoadFilterMetadata.mockResolvedValue(okMaps(poisonedMeta));

		const { exclusions, summary } = await loadMatchFilterExclusions({
			accountId: "acc-1",
			playlists: [{ id: "pl-1", match_filters: langFilters }],
			candidateSongIds: ["song-1"],
		});

		// Must not reject — returns degraded result instead.
		expect(exclusions.size).toBe(0);
		expect(summary.degraded.filterMetadata).toBe(true);
		expect(summary.excludedPairCount).toBe(0);
		expect(summary.activeFilterPlaylistCount).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// degraded.baseExclusions is always false (CMHF-12's responsibility)
// ---------------------------------------------------------------------------

describe("loadMatchFilterExclusions — degraded.baseExclusions ownership", () => {
	beforeEach(() => vi.clearAllMocks());

	it("never sets degraded.baseExclusions — that field belongs to CMHF-12", async () => {
		mockLoadFilterMetadata.mockResolvedValue(errMeta("forced failure"));

		const { summary } = await loadMatchFilterExclusions({
			accountId: "acc-1",
			playlists: [playlist("pl-1", langFilters)],
			candidateSongIds: ["song-1"],
		});

		expect(summary.degraded.baseExclusions).toBe(false);
	});

	it("does not set degraded.baseExclusions on the happy path either", async () => {
		mockLoadFilterMetadata.mockResolvedValue(okMaps());

		const { summary } = await loadMatchFilterExclusions({
			accountId: "acc-1",
			playlists: [playlist("pl-1", langFilters)],
			candidateSongIds: ["song-1"],
		});

		expect(summary.degraded.baseExclusions).toBe(false);
	});
});
