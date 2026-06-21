import { describe, expect, it } from "vitest";
import { isValidDateOnly } from "../dates";

describe("isValidDateOnly", () => {
	it("accepts a well-formed real calendar date", () => {
		expect(isValidDateOnly("2024-01-15")).toBe(true);
	});

	it("accepts a valid leap day", () => {
		expect(isValidDateOnly("2024-02-29")).toBe(true);
	});

	it("rejects Feb 29 in a non-leap year", () => {
		expect(isValidDateOnly("2023-02-29")).toBe(false);
	});

	it("rejects a day that does not exist in the month", () => {
		expect(isValidDateOnly("2024-02-31")).toBe(false);
		expect(isValidDateOnly("2024-04-31")).toBe(false);
	});

	it("rejects an out-of-range month", () => {
		expect(isValidDateOnly("2024-13-01")).toBe(false);
		expect(isValidDateOnly("2024-00-10")).toBe(false);
	});

	it("rejects an out-of-range day", () => {
		expect(isValidDateOnly("2024-01-32")).toBe(false);
		expect(isValidDateOnly("2024-01-00")).toBe(false);
	});

	it("rejects non-YYYY-MM-DD formats", () => {
		expect(isValidDateOnly("2024/01/15")).toBe(false);
		expect(isValidDateOnly("2024-1-5")).toBe(false);
		expect(isValidDateOnly("15-01-2024")).toBe(false);
		expect(isValidDateOnly("not-a-date")).toBe(false);
		expect(isValidDateOnly("")).toBe(false);
	});

	it("rejects a date carrying extra time/zone components", () => {
		expect(isValidDateOnly("2024-01-15T00:00:00Z")).toBe(false);
	});
});
