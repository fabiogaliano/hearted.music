import { describe, expect, it } from "vitest";
import { bandToNumeric } from "../queue-priority";

describe("bandToNumeric", () => {
	it("orders bands strictly: low < standard < priority < interactive", () => {
		expect(bandToNumeric("low")).toBeLessThan(bandToNumeric("standard"));
		expect(bandToNumeric("standard")).toBeLessThan(bandToNumeric("priority"));
		expect(bandToNumeric("priority")).toBeLessThan(
			bandToNumeric("interactive"),
		);
	});
});
