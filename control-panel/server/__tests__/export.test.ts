import { describe, expect, it } from "vitest";
import { escapeCsvCell, toCsv } from "../export";

describe("CSV export", () => {
	it("escapes formula-leading values and CSV delimiters", () => {
		expect(escapeCsvCell("=1+1")).toBe("'=1+1");
		expect(escapeCsvCell("hello, world")).toBe('"hello, world"');
		expect(escapeCsvCell("say \"hi\"")).toBe('"say ""hi"""');
	});

	it("writes a header row", () => {
		expect(toCsv(["name", "count"], [["Adele", 2]])).toBe("name,count\nAdele,2");
	});
});
