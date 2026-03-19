import { describe, it, expect } from "vitest";
import { getChunkSize } from "../batch-size";

describe("getChunkSize", () => {
	it("returns onboarding progression for sequences 0-4", () => {
		expect(getChunkSize(0)).toBe(1);
		expect(getChunkSize(1)).toBe(5);
		expect(getChunkSize(2)).toBe(10);
		expect(getChunkSize(3)).toBe(25);
		expect(getChunkSize(4)).toBe(50);
	});

	it("returns steady state size for sequences >= 5", () => {
		expect(getChunkSize(5)).toBe(50);
		expect(getChunkSize(10)).toBe(50);
		expect(getChunkSize(100)).toBe(50);
	});
});
