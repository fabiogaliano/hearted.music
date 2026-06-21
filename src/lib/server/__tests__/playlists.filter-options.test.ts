import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistMatchFilterOptions } from "@/lib/domains/taste/match-filters/types";
import { getPlaylistMatchFilterOptions } from "../playlists.functions";

// ============================================================================
// Shared mock state
// ============================================================================

const {
	mockAuthContext,
	mockGetEntitledSongIds,
	mockGetLanguageColumns,
	mockGetReleaseYearAggregates,
	mockGetLikedAtAggregates,
} = vi.hoisted(() => ({
	mockAuthContext: {
		session: { accountId: "acct-test" },
		account: null,
	},
	mockGetEntitledSongIds: vi.fn<(accountId: string) => Promise<string[]>>(),
	mockGetLanguageColumns: vi.fn<(ids: string[]) => Promise<unknown>>(),
	mockGetReleaseYearAggregates: vi.fn<(ids: string[]) => Promise<unknown>>(),
	mockGetLikedAtAggregates:
		vi.fn<(accountId: string, ids: string[]) => Promise<unknown>>(),
}));

// ============================================================================
// Module mocks
// ============================================================================

vi.mock("@tanstack/react-start", () => {
	const builder = (): Record<string, unknown> => ({
		middleware: () => builder(),
		inputValidator: () => builder(),
		handler:
			(
				fn: (args: {
					context: typeof mockAuthContext;
					data: unknown;
				}) => unknown,
			) =>
			(input?: { data?: unknown }) =>
				fn({ context: mockAuthContext, data: input?.data }),
	});
	return {
		createServerFn: builder,
		createMiddleware: () => ({
			server: () => ({}),
			type: () => ({ server: () => ({}) }),
		}),
	};
});

vi.mock("@/lib/platform/auth/auth.middleware", () => ({
	authMiddleware: {},
}));

vi.mock("@/lib/workflows/enrichment-pipeline/batch", () => ({
	getEntitledDataEnrichedSongIds: (accountId: string) =>
		mockGetEntitledSongIds(accountId),
}));

vi.mock("@/lib/domains/library/liked-songs/filter-options-queries", () => ({
	getLanguageColumnsForSongs: (ids: string[]) => mockGetLanguageColumns(ids),
	getReleaseYearAggregates: (ids: string[]) =>
		mockGetReleaseYearAggregates(ids),
	getLikedAtAggregates: (accountId: string, ids: string[]) =>
		mockGetLikedAtAggregates(accountId, ids),
}));

// ============================================================================
// Helpers
// ============================================================================

function okResult<T>(value: T) {
	return { status: "ok" as const, value };
}

function errResult(message: string) {
	return { status: "error" as const, error: { message } };
}

function defaultAggregates() {
	mockGetReleaseYearAggregates.mockResolvedValue(
		okResult({ min: 2010, max: 2024, counts: [{ year: 2020, count: 5 }] }),
	);
	mockGetLikedAtAggregates.mockResolvedValue(
		okResult({
			oldest: "2020-01-15",
			yearCounts: [{ year: 2020, count: 10 }],
		}),
	);
}

// ============================================================================
// Tests
// ============================================================================

describe("getPlaylistMatchFilterOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("eligibility population", () => {
		it("uses getEntitledDataEnrichedSongIds — not all songs — as the candidate population", async () => {
			mockGetEntitledSongIds.mockResolvedValue(["song-entitled"]);
			mockGetLanguageColumns.mockResolvedValue(okResult([]));
			defaultAggregates();

			await getPlaylistMatchFilterOptions();

			expect(mockGetEntitledSongIds).toHaveBeenCalledWith("acct-test");
			expect(mockGetLanguageColumns).toHaveBeenCalledWith(["song-entitled"]);
			expect(mockGetLikedAtAggregates).toHaveBeenCalledWith("acct-test", [
				"song-entitled",
			]);
		});

		it("passes the full entitled song id list to all three aggregations", async () => {
			const ids = ["s1", "s2", "s3"];
			mockGetEntitledSongIds.mockResolvedValue(ids);
			mockGetLanguageColumns.mockResolvedValue(okResult([]));
			defaultAggregates();

			await getPlaylistMatchFilterOptions();

			expect(mockGetLanguageColumns).toHaveBeenCalledWith(ids);
			expect(mockGetReleaseYearAggregates).toHaveBeenCalledWith(ids);
			expect(mockGetLikedAtAggregates).toHaveBeenCalledWith("acct-test", ids);
		});
	});

	describe("empty library", () => {
		it("returns null release-year bounds and null oldest when no entitled songs exist", async () => {
			mockGetEntitledSongIds.mockResolvedValue([]);
			mockGetLanguageColumns.mockResolvedValue(okResult([]));
			mockGetReleaseYearAggregates.mockResolvedValue(
				okResult({ min: null, max: null, counts: [] }),
			);
			mockGetLikedAtAggregates.mockResolvedValue(
				okResult({ oldest: null, yearCounts: [] }),
			);

			const result =
				(await getPlaylistMatchFilterOptions()) as PlaylistMatchFilterOptions;

			expect(result.releaseYears.min).toBeNull();
			expect(result.releaseYears.max).toBeNull();
			expect(result.likedAt.oldest).toBeNull();
			expect(result.likedAt.yearCounts).toEqual([]);
		});

		it("still returns the full catalog as selectable language options with count 0", async () => {
			mockGetEntitledSongIds.mockResolvedValue([]);
			mockGetLanguageColumns.mockResolvedValue(okResult([]));
			mockGetReleaseYearAggregates.mockResolvedValue(
				okResult({ min: null, max: null, counts: [] }),
			);
			mockGetLikedAtAggregates.mockResolvedValue(
				okResult({ oldest: null, yearCounts: [] }),
			);

			const result =
				(await getPlaylistMatchFilterOptions()) as PlaylistMatchFilterOptions;

			// No detected entries → all catalog-only
			expect(result.languages.length).toBeGreaterThan(0);
			for (const lang of result.languages) {
				expect(lang.count).toBe(0);
				expect(lang.source).toBe("catalog");
			}

			// English must be present
			const en = result.languages.find((l) => l.code === "en");
			expect(en).toBeDefined();
			expect(en?.label).toBe("English");
		});
	});

	describe("language aggregation", () => {
		it("counts primary and secondary language separately per song", async () => {
			mockGetEntitledSongIds.mockResolvedValue(["s1"]);
			mockGetLanguageColumns.mockResolvedValue(
				okResult([
					{
						song_id: "s1",
						language: "en",
						language_secondary: "pt",
					},
				]),
			);
			defaultAggregates();

			const result =
				(await getPlaylistMatchFilterOptions()) as PlaylistMatchFilterOptions;

			const en = result.languages.find((l) => l.code === "en");
			const pt = result.languages.find((l) => l.code === "pt");
			expect(en?.count).toBe(1);
			expect(pt?.count).toBe(1);
		});

		it("never counts the same code more than once per song when primary equals secondary", async () => {
			mockGetEntitledSongIds.mockResolvedValue(["s1"]);
			// Both columns hold the same code — deduped per-song
			mockGetLanguageColumns.mockResolvedValue(
				okResult([
					{
						song_id: "s1",
						language: "en",
						language_secondary: "en",
					},
				]),
			);
			defaultAggregates();

			const result =
				(await getPlaylistMatchFilterOptions()) as PlaylistMatchFilterOptions;

			const en = result.languages.find((l) => l.code === "en");
			expect(en?.count).toBe(1);
		});

		it("accumulates counts across multiple songs correctly", async () => {
			mockGetEntitledSongIds.mockResolvedValue(["s1", "s2", "s3"]);
			mockGetLanguageColumns.mockResolvedValue(
				okResult([
					{ song_id: "s1", language: "en", language_secondary: null },
					{ song_id: "s2", language: "en", language_secondary: "pt" },
					{ song_id: "s3", language: "pt", language_secondary: null },
				]),
			);
			defaultAggregates();

			const result =
				(await getPlaylistMatchFilterOptions()) as PlaylistMatchFilterOptions;

			const en = result.languages.find((l) => l.code === "en");
			const pt = result.languages.find((l) => l.code === "pt");
			expect(en?.count).toBe(2); // s1 + s2
			expect(pt?.count).toBe(2); // s2 + s3
		});

		it("orders detected languages before catalog-only entries", async () => {
			mockGetEntitledSongIds.mockResolvedValue(["s1"]);
			mockGetLanguageColumns.mockResolvedValue(
				okResult([{ song_id: "s1", language: "pt", language_secondary: null }]),
			);
			defaultAggregates();

			const result =
				(await getPlaylistMatchFilterOptions()) as PlaylistMatchFilterOptions;

			const firstDetectedIndex = result.languages.findIndex(
				(l) => l.source === "detected",
			);
			const firstCatalogIndex = result.languages.findIndex(
				(l) => l.source === "catalog",
			);

			expect(firstDetectedIndex).toBeLessThan(firstCatalogIndex);
		});

		it("sorts detected entries by count descending", async () => {
			mockGetEntitledSongIds.mockResolvedValue(["s1", "s2", "s3"]);
			mockGetLanguageColumns.mockResolvedValue(
				okResult([
					{ song_id: "s1", language: "pt", language_secondary: null },
					{ song_id: "s2", language: "pt", language_secondary: null },
					{ song_id: "s3", language: "en", language_secondary: null },
				]),
			);
			defaultAggregates();

			const result =
				(await getPlaylistMatchFilterOptions()) as PlaylistMatchFilterOptions;

			const detected = result.languages.filter((l) => l.source === "detected");
			expect(detected[0].code).toBe("pt"); // count 2, first
			expect(detected[1].code).toBe("en"); // count 1, second
		});

		it("sets source=detected for library languages and source=catalog for non-detected catalog languages", async () => {
			mockGetEntitledSongIds.mockResolvedValue(["s1"]);
			mockGetLanguageColumns.mockResolvedValue(
				okResult([{ song_id: "s1", language: "en", language_secondary: null }]),
			);
			defaultAggregates();

			const result =
				(await getPlaylistMatchFilterOptions()) as PlaylistMatchFilterOptions;

			const en = result.languages.find((l) => l.code === "en");
			expect(en?.source).toBe("detected");

			const af = result.languages.find((l) => l.code === "af");
			expect(af?.source).toBe("catalog");
			expect(af?.count).toBe(0);
		});

		it("excludes uncataloged detected codes from the returned options and logs a warning", async () => {
			mockGetEntitledSongIds.mockResolvedValue(["s1"]);
			// "xx" is not a real catalog code
			mockGetLanguageColumns.mockResolvedValue(
				okResult([{ song_id: "s1", language: "xx", language_secondary: null }]),
			);
			defaultAggregates();

			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			const result =
				(await getPlaylistMatchFilterOptions()) as PlaylistMatchFilterOptions;

			expect(result.languages.find((l) => l.code === "xx")).toBeUndefined();
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining("not in catalog"),
				"xx",
			);

			warnSpy.mockRestore();
		});

		it("logs each uncataloged code only once even when multiple songs share it", async () => {
			mockGetEntitledSongIds.mockResolvedValue(["s1", "s2"]);
			mockGetLanguageColumns.mockResolvedValue(
				okResult([
					{ song_id: "s1", language: "xx", language_secondary: null },
					{ song_id: "s2", language: "xx", language_secondary: null },
				]),
			);
			defaultAggregates();

			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			await getPlaylistMatchFilterOptions();

			const xxWarnings = warnSpy.mock.calls.filter((args) =>
				String(args[0]).includes("not in catalog"),
			);
			expect(xxWarnings).toHaveLength(1);

			warnSpy.mockRestore();
		});

		it("catalog-only entries are sorted alphabetically by label", async () => {
			mockGetEntitledSongIds.mockResolvedValue([]);
			mockGetLanguageColumns.mockResolvedValue(okResult([]));
			mockGetReleaseYearAggregates.mockResolvedValue(
				okResult({ min: null, max: null, counts: [] }),
			);
			mockGetLikedAtAggregates.mockResolvedValue(
				okResult({ oldest: null, yearCounts: [] }),
			);

			const result =
				(await getPlaylistMatchFilterOptions()) as PlaylistMatchFilterOptions;

			const labels = result.languages.map((l) => l.label);
			const sorted = [...labels].sort((a, b) => a.localeCompare(b));
			expect(labels).toEqual(sorted);
		});
	});

	describe("release year aggregation", () => {
		it("returns min and max from the aggregate", async () => {
			mockGetEntitledSongIds.mockResolvedValue(["s1"]);
			mockGetLanguageColumns.mockResolvedValue(okResult([]));
			mockGetReleaseYearAggregates.mockResolvedValue(
				okResult({ min: 1990, max: 2023, counts: [] }),
			);
			mockGetLikedAtAggregates.mockResolvedValue(
				okResult({ oldest: "2020-01-01", yearCounts: [] }),
			);

			const result =
				(await getPlaylistMatchFilterOptions()) as PlaylistMatchFilterOptions;

			expect(result.releaseYears.min).toBe(1990);
			expect(result.releaseYears.max).toBe(2023);
		});

		it("returns null min/max when no songs have a release year", async () => {
			mockGetEntitledSongIds.mockResolvedValue(["s1"]);
			mockGetLanguageColumns.mockResolvedValue(okResult([]));
			mockGetReleaseYearAggregates.mockResolvedValue(
				okResult({ min: null, max: null, counts: [] }),
			);
			mockGetLikedAtAggregates.mockResolvedValue(
				okResult({ oldest: "2020-01-01", yearCounts: [] }),
			);

			const result =
				(await getPlaylistMatchFilterOptions()) as PlaylistMatchFilterOptions;

			expect(result.releaseYears.min).toBeNull();
			expect(result.releaseYears.max).toBeNull();
		});

		it("includes per-year counts in the response", async () => {
			mockGetEntitledSongIds.mockResolvedValue(["s1"]);
			mockGetLanguageColumns.mockResolvedValue(okResult([]));
			const counts = [
				{ year: 2020, count: 3 },
				{ year: 2021, count: 7 },
			];
			mockGetReleaseYearAggregates.mockResolvedValue(
				okResult({ min: 2020, max: 2021, counts }),
			);
			mockGetLikedAtAggregates.mockResolvedValue(
				okResult({ oldest: "2020-01-01", yearCounts: [] }),
			);

			const result =
				(await getPlaylistMatchFilterOptions()) as PlaylistMatchFilterOptions;

			expect(result.releaseYears.counts).toEqual(counts);
		});
	});

	describe("liked-at aggregation", () => {
		it("returns oldest as YYYY-MM-DD UTC string", async () => {
			mockGetEntitledSongIds.mockResolvedValue(["s1"]);
			mockGetLanguageColumns.mockResolvedValue(okResult([]));
			defaultAggregates();
			mockGetLikedAtAggregates.mockResolvedValue(
				okResult({ oldest: "2019-03-14", yearCounts: [] }),
			);

			const result =
				(await getPlaylistMatchFilterOptions()) as PlaylistMatchFilterOptions;

			expect(result.likedAt.oldest).toBe("2019-03-14");
		});

		it("returns today as current UTC YYYY-MM-DD string", async () => {
			mockGetEntitledSongIds.mockResolvedValue([]);
			mockGetLanguageColumns.mockResolvedValue(okResult([]));
			mockGetReleaseYearAggregates.mockResolvedValue(
				okResult({ min: null, max: null, counts: [] }),
			);
			mockGetLikedAtAggregates.mockResolvedValue(
				okResult({ oldest: null, yearCounts: [] }),
			);

			const before = new Date().toISOString().slice(0, 10);
			const result =
				(await getPlaylistMatchFilterOptions()) as PlaylistMatchFilterOptions;
			const after = new Date().toISOString().slice(0, 10);

			// today must be the current UTC date (stable across the ms of this test)
			expect(result.likedAt.today >= before).toBe(true);
			expect(result.likedAt.today <= after).toBe(true);
			expect(result.likedAt.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		});

		it("returns UTC year counts from the aggregate", async () => {
			mockGetEntitledSongIds.mockResolvedValue(["s1"]);
			mockGetLanguageColumns.mockResolvedValue(okResult([]));
			defaultAggregates();
			const yearCounts = [
				{ year: 2022, count: 40 },
				{ year: 2023, count: 80 },
			];
			mockGetLikedAtAggregates.mockResolvedValue(
				okResult({ oldest: "2022-06-01", yearCounts }),
			);

			const result =
				(await getPlaylistMatchFilterOptions()) as PlaylistMatchFilterOptions;

			expect(result.likedAt.yearCounts).toEqual(yearCounts);
		});
	});

	describe("return shape", () => {
		it("response shape matches PlaylistMatchFilterOptions exactly", async () => {
			mockGetEntitledSongIds.mockResolvedValue(["s1"]);
			mockGetLanguageColumns.mockResolvedValue(
				okResult([{ song_id: "s1", language: "en", language_secondary: null }]),
			);
			mockGetReleaseYearAggregates.mockResolvedValue(
				okResult({ min: 2010, max: 2024, counts: [{ year: 2020, count: 5 }] }),
			);
			mockGetLikedAtAggregates.mockResolvedValue(
				okResult({
					oldest: "2020-01-01",
					yearCounts: [{ year: 2020, count: 10 }],
				}),
			);

			const result =
				(await getPlaylistMatchFilterOptions()) as PlaylistMatchFilterOptions;

			// Top-level keys
			expect(result).toHaveProperty("languages");
			expect(result).toHaveProperty("releaseYears");
			expect(result).toHaveProperty("likedAt");

			// Language entry shape
			const lang = result.languages[0];
			expect(lang).toHaveProperty("code");
			expect(lang).toHaveProperty("label");
			expect(lang).toHaveProperty("count");
			expect(lang).toHaveProperty("source");
			expect(["detected", "catalog"]).toContain(lang.source);

			// releaseYears shape
			expect(
				typeof result.releaseYears.min === "number" ||
					result.releaseYears.min === null,
			).toBe(true);
			expect(
				typeof result.releaseYears.max === "number" ||
					result.releaseYears.max === null,
			).toBe(true);
			expect(Array.isArray(result.releaseYears.counts)).toBe(true);

			// likedAt shape
			expect(
				typeof result.likedAt.oldest === "string" ||
					result.likedAt.oldest === null,
			).toBe(true);
			expect(typeof result.likedAt.today).toBe("string");
			expect(Array.isArray(result.likedAt.yearCounts)).toBe(true);
		});
	});

	describe("error propagation", () => {
		it("logs [filter-options] prefix and re-throws when eligibility fetch rejects", async () => {
			mockGetEntitledSongIds.mockRejectedValue(
				new Error("entitlement db down"),
			);

			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			await expect(getPlaylistMatchFilterOptions()).rejects.toThrow(
				"Failed to load filter options",
			);

			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("[filter-options]"),
				expect.any(Error),
			);

			errorSpy.mockRestore();
		});

		it("throws when language aggregation fails", async () => {
			mockGetEntitledSongIds.mockResolvedValue(["s1"]);
			mockGetLanguageColumns.mockResolvedValue(errResult("db error"));
			defaultAggregates();

			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			await expect(getPlaylistMatchFilterOptions()).rejects.toThrow(
				"Failed to load filter options",
			);

			errorSpy.mockRestore();
		});

		it("throws when release-year aggregation fails", async () => {
			mockGetEntitledSongIds.mockResolvedValue(["s1"]);
			mockGetLanguageColumns.mockResolvedValue(okResult([]));
			mockGetReleaseYearAggregates.mockResolvedValue(errResult("db error"));
			mockGetLikedAtAggregates.mockResolvedValue(
				okResult({ oldest: null, yearCounts: [] }),
			);

			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			await expect(getPlaylistMatchFilterOptions()).rejects.toThrow(
				"Failed to load filter options",
			);

			errorSpy.mockRestore();
		});

		it("throws when liked-at aggregation fails", async () => {
			mockGetEntitledSongIds.mockResolvedValue(["s1"]);
			mockGetLanguageColumns.mockResolvedValue(okResult([]));
			mockGetReleaseYearAggregates.mockResolvedValue(
				okResult({ min: null, max: null, counts: [] }),
			);
			mockGetLikedAtAggregates.mockResolvedValue(errResult("db error"));

			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			await expect(getPlaylistMatchFilterOptions()).rejects.toThrow(
				"Failed to load filter options",
			);

			errorSpy.mockRestore();
		});
	});
});
