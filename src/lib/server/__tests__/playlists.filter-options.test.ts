import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchFilterOptionAggregates } from "@/lib/domains/library/liked-songs/filter-options-queries";
import type { PlaylistMatchFilterOptions } from "@/lib/domains/taste/match-filters/types";
import { getPlaylistMatchFilterOptions } from "../playlists.functions";

// ============================================================================
// Shared mock state
// ============================================================================

const { mockAuthContext, mockReadMatchFilterOptions } = vi.hoisted(() => ({
	mockAuthContext: {
		session: { accountId: "acct-test" },
		account: null,
	},
	mockReadMatchFilterOptions: vi.fn<(accountId: string) => Promise<unknown>>(),
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

vi.mock("@/lib/domains/library/liked-songs/filter-options-queries", () => ({
	readMatchFilterOptions: (_supabase: unknown, accountId: string) =>
		mockReadMatchFilterOptions(accountId),
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

function aggregates(
	overrides: Partial<MatchFilterOptionAggregates> = {},
): MatchFilterOptionAggregates {
	return {
		languages: [],
		releaseYears: { min: 2010, max: 2024, counts: [{ year: 2020, count: 5 }] },
		likedAt: { oldest: "2020-01-15", yearCounts: [{ year: 2020, count: 10 }] },
		...overrides,
	};
}

function emptyLibrary(): MatchFilterOptionAggregates {
	return {
		languages: [],
		releaseYears: { min: null, max: null, counts: [] },
		likedAt: { oldest: null, yearCounts: [] },
	};
}

async function readOptions(
	value: MatchFilterOptionAggregates,
): Promise<PlaylistMatchFilterOptions> {
	mockReadMatchFilterOptions.mockResolvedValue(okResult(value));
	return (await getPlaylistMatchFilterOptions()) as PlaylistMatchFilterOptions;
}

// ============================================================================
// Tests
// ============================================================================

describe("getPlaylistMatchFilterOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("reads the aggregates for the signed-in account", async () => {
		await readOptions(aggregates());

		expect(mockReadMatchFilterOptions).toHaveBeenCalledWith("acct-test");
	});

	describe("empty library", () => {
		it("returns null release-year bounds and null oldest when no entitled songs exist", async () => {
			const result = await readOptions(emptyLibrary());

			expect(result.releaseYears.min).toBeNull();
			expect(result.releaseYears.max).toBeNull();
			expect(result.likedAt.oldest).toBeNull();
			expect(result.likedAt.yearCounts).toEqual([]);
		});

		it("still returns the full catalog as selectable language options with count 0", async () => {
			const result = await readOptions(emptyLibrary());

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

	describe("language options", () => {
		it("carries each detected code's song count", async () => {
			const result = await readOptions(
				aggregates({
					languages: [
						{ code: "en", count: 2 },
						{ code: "pt", count: 2 },
					],
				}),
			);

			const en = result.languages.find((l) => l.code === "en");
			const pt = result.languages.find((l) => l.code === "pt");
			expect(en?.count).toBe(2);
			expect(pt?.count).toBe(2);
		});

		it("orders detected languages before catalog-only entries", async () => {
			const result = await readOptions(
				aggregates({ languages: [{ code: "pt", count: 1 }] }),
			);

			const firstDetectedIndex = result.languages.findIndex(
				(l) => l.source === "detected",
			);
			const firstCatalogIndex = result.languages.findIndex(
				(l) => l.source === "catalog",
			);

			expect(firstDetectedIndex).toBeLessThan(firstCatalogIndex);
		});

		it("sorts detected entries by count descending", async () => {
			const result = await readOptions(
				aggregates({
					languages: [
						{ code: "en", count: 1 },
						{ code: "pt", count: 2 },
					],
				}),
			);

			const detected = result.languages.filter((l) => l.source === "detected");
			expect(detected[0].code).toBe("pt"); // count 2, first
			expect(detected[1].code).toBe("en"); // count 1, second
		});

		it("sets source=detected for library languages and source=catalog for non-detected catalog languages", async () => {
			const result = await readOptions(
				aggregates({ languages: [{ code: "en", count: 1 }] }),
			);

			const en = result.languages.find((l) => l.code === "en");
			expect(en?.source).toBe("detected");

			const af = result.languages.find((l) => l.code === "af");
			expect(af?.source).toBe("catalog");
			expect(af?.count).toBe(0);
		});

		it("excludes uncataloged detected codes from the returned options and logs a warning", async () => {
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			// "xx" is not a real catalog code
			const result = await readOptions(
				aggregates({ languages: [{ code: "xx", count: 2 }] }),
			);

			expect(result.languages.find((l) => l.code === "xx")).toBeUndefined();
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining("not in catalog"),
				"xx",
			);
			const xxWarnings = warnSpy.mock.calls.filter((args) =>
				String(args[0]).includes("not in catalog"),
			);
			expect(xxWarnings).toHaveLength(1);

			warnSpy.mockRestore();
		});

		it("catalog-only entries are sorted alphabetically by label", async () => {
			const result = await readOptions(emptyLibrary());

			const labels = result.languages.map((l) => l.label);
			const sorted = [...labels].sort((a, b) => a.localeCompare(b));
			expect(labels).toEqual(sorted);
		});
	});

	describe("release years", () => {
		it("returns min, max and per-year counts from the aggregate", async () => {
			const counts = [
				{ year: 2020, count: 3 },
				{ year: 2021, count: 7 },
			];
			const result = await readOptions(
				aggregates({ releaseYears: { min: 2020, max: 2021, counts } }),
			);

			expect(result.releaseYears).toEqual({ min: 2020, max: 2021, counts });
		});
	});

	describe("liked-at", () => {
		it("returns the oldest date and UTC year counts from the aggregate", async () => {
			const yearCounts = [
				{ year: 2022, count: 40 },
				{ year: 2023, count: 80 },
			];
			const result = await readOptions(
				aggregates({ likedAt: { oldest: "2022-06-01", yearCounts } }),
			);

			expect(result.likedAt.oldest).toBe("2022-06-01");
			expect(result.likedAt.yearCounts).toEqual(yearCounts);
		});

		it("returns today as current UTC YYYY-MM-DD string", async () => {
			const before = new Date().toISOString().slice(0, 10);
			const result = await readOptions(emptyLibrary());
			const after = new Date().toISOString().slice(0, 10);

			// today must be the current UTC date (stable across the ms of this test)
			expect(result.likedAt.today >= before).toBe(true);
			expect(result.likedAt.today <= after).toBe(true);
			expect(result.likedAt.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		});
	});

	describe("error propagation", () => {
		it("logs [filter-options] prefix and re-throws when the aggregate read fails", async () => {
			mockReadMatchFilterOptions.mockResolvedValue(errResult("db down"));

			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			await expect(getPlaylistMatchFilterOptions()).rejects.toThrow(
				"Failed to load filter options",
			);

			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("[filter-options]"),
				expect.objectContaining({ message: "db down" }),
			);

			errorSpy.mockRestore();
		});
	});
});
