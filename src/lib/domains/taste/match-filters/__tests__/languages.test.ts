import { describe, expect, it } from "vitest";
import {
	isLanguageCatalogCode,
	lookupLanguage,
	orderLanguageOptions,
	SUPPORTED_LANGUAGE_CODES,
	searchLanguages,
} from "../languages";

describe("lookupLanguage", () => {
	it("returns code and label for a known code", () => {
		const result = lookupLanguage("en");
		expect(result).toEqual({ code: "en", label: "English" });
	});

	it("returns undefined for an unknown code", () => {
		expect(lookupLanguage("xx-invented")).toBeUndefined();
	});

	it("looks up all 60 eld-emitted ISO 639-1 codes", () => {
		const eldCodes = [
			"am",
			"ar",
			"az",
			"be",
			"bg",
			"bn",
			"ca",
			"cs",
			"da",
			"de",
			"el",
			"en",
			"es",
			"et",
			"eu",
			"fa",
			"fi",
			"fr",
			"gu",
			"he",
			"hi",
			"hr",
			"hu",
			"hy",
			"is",
			"it",
			"ja",
			"ka",
			"kn",
			"ko",
			"ku",
			"lo",
			"lt",
			"lv",
			"ml",
			"mr",
			"ms",
			"nl",
			"no",
			"or",
			"pa",
			"pl",
			"pt",
			"ro",
			"ru",
			"sk",
			"sl",
			"sq",
			"sr",
			"sv",
			"ta",
			"te",
			"th",
			"tl",
			"tr",
			"uk",
			"ur",
			"vi",
			"yo",
			"zh",
		];
		for (const code of eldCodes) {
			expect(
				lookupLanguage(code),
				`expected code "${code}" in catalog`,
			).toBeDefined();
		}
	});
});

describe("isLanguageCatalogCode", () => {
	it("returns true for a cataloged code", () => {
		expect(isLanguageCatalogCode("pt")).toBe(true);
		expect(isLanguageCatalogCode("zh")).toBe(true);
	});

	it("returns false for an uncataloged code", () => {
		expect(isLanguageCatalogCode("xx-invented")).toBe(false);
		expect(isLanguageCatalogCode("")).toBe(false);
	});
});

describe("SUPPORTED_LANGUAGE_CODES", () => {
	it("is a set containing known codes", () => {
		expect(SUPPORTED_LANGUAGE_CODES.has("en")).toBe(true);
		expect(SUPPORTED_LANGUAGE_CODES.has("ko")).toBe(true);
		expect(SUPPORTED_LANGUAGE_CODES.has("xx-invented")).toBe(false);
	});
});

describe("searchLanguages", () => {
	it("returns all catalog entries for empty query", () => {
		const all = searchLanguages("");
		expect(all.length).toBeGreaterThan(50);
	});

	it("matches by code (case-insensitive)", () => {
		const result = searchLanguages("pt");
		expect(result.some((r) => r.code === "pt")).toBe(true);
	});

	it("matches by canonical English label", () => {
		const result = searchLanguages("German");
		expect(result.some((r) => r.code === "de")).toBe(true);
	});

	it("matches by alias/endonym", () => {
		const result = searchLanguages("Deutsch");
		expect(result.some((r) => r.code === "de")).toBe(true);
	});

	it("matches by partial label", () => {
		const result = searchLanguages("Port");
		expect(result.some((r) => r.code === "pt")).toBe(true);
	});

	it("returns empty array for no matches", () => {
		const result = searchLanguages("zzzznotexists");
		expect(result).toEqual([]);
	});

	it("finds Japanese by endonym 日本語", () => {
		const result = searchLanguages("日本語");
		expect(result.some((r) => r.code === "ja")).toBe(true);
	});

	it("finds Chinese by alias 中文", () => {
		const result = searchLanguages("中文");
		expect(result.some((r) => r.code === "zh")).toBe(true);
	});

	it("finds Tagalog by alias Filipino", () => {
		const result = searchLanguages("Filipino");
		expect(result.some((r) => r.code === "tl")).toBe(true);
	});

	it("returns results sorted alphabetically by label", () => {
		const result = searchLanguages("an");
		expect(result.length).toBeGreaterThan(1);
		const labels = result.map((r) => r.label);
		const sorted = [...labels].sort((a, b) => a.localeCompare(b));
		expect(labels).toEqual(sorted);
	});
});

describe("orderLanguageOptions", () => {
	it("places selected codes first in selection order", () => {
		const result = orderLanguageOptions(["pt", "fr"], new Map());
		expect(result[0]?.code).toBe("pt");
		expect(result[1]?.code).toBe("fr");
	});

	it("places detected-but-not-selected next, sorted by count descending", () => {
		const detected = new Map([
			["en", 10],
			["de", 50],
			["ko", 5],
		]);
		const result = orderLanguageOptions([], detected);
		const detectedCodes = result.map((r) => r.code);
		expect(detectedCodes.indexOf("de")).toBeLessThan(
			detectedCodes.indexOf("en"),
		);
		expect(detectedCodes.indexOf("en")).toBeLessThan(
			detectedCodes.indexOf("ko"),
		);
	});

	it("excludes selected codes from the detected section", () => {
		const detected = new Map([
			["en", 20],
			["de", 10],
		]);
		const result = orderLanguageOptions(["en"], detected);
		const codes = result.map((r) => r.code);
		expect(codes[0]).toBe("en");
		const deIdx = codes.indexOf("de");
		const enOccurrences = codes.filter((c) => c === "en").length;
		expect(enOccurrences).toBe(1);
		expect(deIdx).toBeGreaterThan(0);
	});

	it("places catalog-only languages alphabetically after detected", () => {
		const selected = ["pt"];
		const detected = new Map([["fr", 5]]);
		const result = orderLanguageOptions(selected, detected);
		const codes = result.map((r) => r.code);
		expect(codes[0]).toBe("pt");
		expect(codes[1]).toBe("fr");
		const remainderStart = 2;
		const remainder = result.slice(remainderStart);
		const labels = remainder.map((r) => r.label);
		const sortedLabels = [...labels].sort((a, b) => a.localeCompare(b));
		expect(labels).toEqual(sortedLabels);
	});

	it("returns only catalog entries (ignores uncataloged detected codes)", () => {
		const detected = new Map([["xx-invented", 999]]);
		const result = orderLanguageOptions([], detected);
		expect(result.every((r) => isLanguageCatalogCode(r.code))).toBe(true);
	});
});
