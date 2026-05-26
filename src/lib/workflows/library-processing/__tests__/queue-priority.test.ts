import { describe, expect, it } from "vitest";
import { bandToNumeric } from "../queue-priority";

describe("bandToNumeric", () => {
	it("maps low to 0", () => {
		expect(bandToNumeric("low")).toBe(0);
	});

	it("maps standard to 50", () => {
		expect(bandToNumeric("standard")).toBe(50);
	});

	it("maps priority to 100", () => {
		expect(bandToNumeric("priority")).toBe(100);
	});
});
