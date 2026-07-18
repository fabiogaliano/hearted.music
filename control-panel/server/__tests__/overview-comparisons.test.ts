import { describe, expect, it } from "vitest";
import { comparison, parseOverviewRange } from "../metrics";

describe("parseOverviewRange", () => {
	it("accepts supported ranges", () => {
		expect(parseOverviewRange("24h")).toBe("24h");
		expect(parseOverviewRange("7d")).toBe("7d");
		expect(parseOverviewRange("30d")).toBe("30d");
	});

	it("defaults to 14d for missing or unknown values", () => {
		expect(parseOverviewRange(null)).toBe("14d");
		expect(parseOverviewRange("90d")).toBe("14d");
	});
});

describe("comparison", () => {
	it("computes signed absolute and percent deltas", () => {
		expect(comparison(15, 10)).toEqual({
			current: 15,
			previous: 10,
			deltaAbsolute: 5,
			deltaPercent: 50,
		});
		expect(comparison(5, 10)).toEqual({
			current: 5,
			previous: 10,
			deltaAbsolute: -5,
			deltaPercent: -50,
		});
	});

	it("falls back to an absolute delta when the previous period is zero", () => {
		expect(comparison(4, 0)).toEqual({
			current: 4,
			previous: 0,
			deltaAbsolute: 4,
			deltaPercent: null,
		});
	});

	it("reports no change when both periods are zero", () => {
		expect(comparison(0, 0)).toEqual({
			current: 0,
			previous: 0,
			deltaAbsolute: 0,
			deltaPercent: null,
		});
	});
});
