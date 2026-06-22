/**
 * CMHF-09: Read-path match_filters parsing for PlaylistSummary.
 *
 * The toSummary mapper in PlaylistsCoverFlowScreen runs parseStoredMatchFilters
 * on the raw DB Json before handing data to any React component. These tests
 * exercise the contract: valid filters pass through, invalid known fields
 * normalize to { version: 1 } with a console.warn, and the function never
 * throws regardless of the raw stored shape.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseStoredMatchFilters } from "@/lib/domains/taste/match-filters/schemas";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { parseSummaryMatchFilters } from "../PlaylistsCoverFlowScreen";

// ============================================================================
// parseStoredMatchFilters — forgiving read-path parser
// ============================================================================

describe("parseStoredMatchFilters — valid stored shapes", () => {
	it("accepts the no-filter default shape", () => {
		const result = parseStoredMatchFilters({ version: 1 });
		expect(result.value).toEqual({ version: 1 });
		expect(result.wasNormalized).toBe(false);
	});

	it("passes through a valid languages filter", () => {
		const raw: PlaylistMatchFiltersV1 = {
			version: 1,
			languages: { codes: ["en"] },
		};
		const result = parseStoredMatchFilters(raw);
		expect(result.value.languages?.codes).toEqual(["en"]);
		expect(result.wasNormalized).toBe(false);
	});

	it("passes through a valid vocalGender filter", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			vocalGender: "female",
		});
		expect(result.value.vocalGender).toBe("female");
		expect(result.wasNormalized).toBe(false);
	});

	it("passes through a valid releaseYear exact filter", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			releaseYear: { kind: "exact", year: 2010 },
		});
		expect(result.value.releaseYear).toEqual({ kind: "exact", year: 2010 });
		expect(result.wasNormalized).toBe(false);
	});

	it("passes through a valid likedAt range filter", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			likedAt: {
				kind: "range",
				startDate: "2024-01-01",
				end: { kind: "date", date: "2024-12-31" },
			},
		});
		expect(result.value.likedAt).toBeDefined();
		expect(result.wasNormalized).toBe(false);
	});

	it("silently ignores unknown stored keys (forgiving read semantics)", () => {
		// Future schema versions may add keys the current app does not know about.
		// The read parser must not invalidate the object for unknown keys alone.
		const result = parseStoredMatchFilters({
			version: 1,
			vocalGender: "male",
			unknownFutureField: "some-value",
		});
		expect(result.wasNormalized).toBe(false);
		expect(result.value.vocalGender).toBe("male");
	});
});

describe("parseStoredMatchFilters — invalid stored shapes normalize to { version: 1 }", () => {
	it("normalizes null to default", () => {
		const result = parseStoredMatchFilters(null);
		expect(result.value).toEqual({ version: 1 });
		expect(result.wasNormalized).toBe(true);
	});

	it("normalizes an empty object to default (missing version)", () => {
		const result = parseStoredMatchFilters({});
		expect(result.value).toEqual({ version: 1 });
		expect(result.wasNormalized).toBe(true);
	});

	it("normalizes wrong version number to default", () => {
		const result = parseStoredMatchFilters({ version: 99 });
		expect(result.value).toEqual({ version: 1 });
		expect(result.wasNormalized).toBe(true);
	});

	it("normalizes invalid vocalGender value to default (whole-object invalidation)", () => {
		// A known field with invalid data invalidates the entire object per Decisions §6.
		const result = parseStoredMatchFilters({
			version: 1,
			vocalGender: "mixed",
		});
		expect(result.value).toEqual({ version: 1 });
		expect(result.wasNormalized).toBe(true);
	});

	it("normalizes empty languages.codes to default (non-empty required)", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			languages: { codes: [] },
		});
		expect(result.value).toEqual({ version: 1 });
		expect(result.wasNormalized).toBe(true);
	});

	it("normalizes invalid releaseYear kind to default", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			releaseYear: { kind: "unknown-kind", year: 2010 },
		});
		expect(result.value).toEqual({ version: 1 });
		expect(result.wasNormalized).toBe(true);
	});

	it("normalizes a releaseYear range with start > end to default", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			releaseYear: { kind: "range", start: 2020, end: 2010 },
		});
		expect(result.value).toEqual({ version: 1 });
		expect(result.wasNormalized).toBe(true);
	});

	it("normalizes an invalid likedAt date string to default", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			likedAt: { kind: "before", endDate: "not-a-date" },
		});
		expect(result.value).toEqual({ version: 1 });
		expect(result.wasNormalized).toBe(true);
	});

	it("normalizes a plain string to default", () => {
		const result = parseStoredMatchFilters("corrupted string data");
		expect(result.value).toEqual({ version: 1 });
		expect(result.wasNormalized).toBe(true);
	});

	it("normalizes an array to default", () => {
		const result = parseStoredMatchFilters([{ version: 1 }]);
		expect(result.value).toEqual({ version: 1 });
		expect(result.wasNormalized).toBe(true);
	});
});

// ============================================================================
// toSummary warning logging behavior (via parseSummaryMatchFilters)
// ============================================================================

describe("read-path warning contract (wasNormalized flag)", () => {
	let warnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		warnSpy.mockRestore();
	});

	it("does NOT warn for valid stored filters", () => {
		parseSummaryMatchFilters("acc-1", "pl-1", {
			version: 1,
			vocalGender: "female",
		});
		// Clean input must not produce a warning.
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("emits console.warn with accountId + playlistId when wasNormalized is true", () => {
		parseSummaryMatchFilters("acc-1", "pl-1", {
			version: 1,
			vocalGender: "unknown",
		});
		expect(warnSpy).toHaveBeenCalledOnce();
		expect(warnSpy).toHaveBeenCalledWith(
			"[playlists] invalid stored match_filters normalized",
			expect.objectContaining({ accountId: "acc-1", playlistId: "pl-1" }),
		);
	});

	it("does NOT warn for unknown-key-only stored data (forgiving read, no warn needed)", () => {
		// Unknown keys alone do not trigger normalization per Decisions §6, so no warn.
		parseSummaryMatchFilters("acc-1", "pl-1", {
			version: 1,
			undocumentedExtraKey: true,
		});
		expect(warnSpy).not.toHaveBeenCalled();
	});
});

// ============================================================================
// Sibling-field invalidation: no salvaging valid siblings (Decisions §6)
// ============================================================================

describe("parseStoredMatchFilters — no-salvaging-siblings rule", () => {
	it("invalidates the whole object when one known field is invalid, discarding valid siblings", () => {
		// vocalGender:"mixed" is not a valid enum value — the whole object must
		// normalize to { version: 1 } even though languages is itself valid.
		const result = parseStoredMatchFilters({
			version: 1,
			vocalGender: "mixed",
			languages: { codes: ["en"] },
		});
		expect(result.value).toEqual({ version: 1 });
		expect(result.wasNormalized).toBe(true);
	});
});
