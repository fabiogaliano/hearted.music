import { describe, expect, it } from "vitest";
import { deriveClaimHandleSeed } from "../claim-handle-seed";
import { derivePassiveHandlePrefill } from "../handle-prefill";

describe("derivePassiveHandlePrefill", () => {
	it("transliterates accented chars and lowercases", () => {
		expect(derivePassiveHandlePrefill("Fábio Galiano")).toBe("fabio_galiano");
	});

	it("collapses punctuation runs to a single underscore", () => {
		expect(derivePassiveHandlePrefill("John / Jane")).toBe("john_jane");
	});

	it("trims leading underscores", () => {
		// A display name that starts with a non-alphanumeric character after transliteration.
		expect(derivePassiveHandlePrefill("_leading")).toBe("leading");
	});

	it("trims trailing underscores", () => {
		expect(derivePassiveHandlePrefill("trailing_")).toBe("trailing");
	});

	it("returns blank string for empty input", () => {
		expect(derivePassiveHandlePrefill("")).toBe("");
	});

	it("returns blank string for whitespace-only input", () => {
		expect(derivePassiveHandlePrefill("   ")).toBe("");
	});

	it("truncates to 30 characters", () => {
		// 10-char word repeated 4 times = 40 chars after joining becomes "word_word_word_word" = 19 chars
		// Use a single long name instead.
		const longName = "abcdefghij".repeat(4); // 40-char all-ASCII name
		const result = derivePassiveHandlePrefill(longName);
		expect(result.length).toBeLessThanOrEqual(30);
	});

	it("30-char boundary: result is at most 30 chars long", () => {
		const name = "a".repeat(40);
		expect(derivePassiveHandlePrefill(name)).toBe("a".repeat(30));
	});
});

describe("deriveClaimHandleSeed", () => {
	it('returns kind "owned" when accountHandle is non-null', () => {
		const seed = deriveClaimHandleSeed({
			accountHandle: "existing_handle",
			displayName: "Fábio Galiano",
		});
		expect(seed).toEqual({ kind: "owned", handle: "existing_handle" });
	});

	it("existing handle wins over display-name-derived prefill", () => {
		const seed = deriveClaimHandleSeed({
			accountHandle: "my_handle",
			displayName: "Any Name",
		});
		expect(seed.kind).toBe("owned");
	});

	it('returns kind "suggested" from display name when accountHandle is null', () => {
		const seed = deriveClaimHandleSeed({
			accountHandle: null,
			displayName: "Fábio Galiano",
		});
		expect(seed).toEqual({ kind: "suggested", handle: "fabio_galiano" });
	});

	it('returns kind "blank" when accountHandle is null and display name yields empty prefill', () => {
		const seed = deriveClaimHandleSeed({
			accountHandle: null,
			displayName: "",
		});
		expect(seed).toEqual({ kind: "blank" });
	});
});
