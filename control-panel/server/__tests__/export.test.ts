import { describe, expect, it } from "vitest";
import { collectExportPages, escapeCsvCell, toCsv } from "../export";

describe("CSV export", () => {
	it("escapes formula-leading values and CSV delimiters", () => {
		expect(escapeCsvCell("=1+1")).toBe("'=1+1");
		expect(escapeCsvCell("hello, world")).toBe('"hello, world"');
		expect(escapeCsvCell("say \"hi\"")).toBe('"say ""hi"""');
	});

	it("writes a header row", () => {
		expect(toCsv(["name", "count"], [["Adele", 2]])).toBe("name,count\nAdele,2");
	});

	it("collects every export page", async () => {
		const rows = await collectExportPages(
			{ rows: [1, 2], total: 3, page: 1, pageSize: 100 },
			async () => ({ rows: [3], total: 3, page: 2, pageSize: 100 }),
		);
		expect(rows).toEqual([1, 2, 3]);
	});

	it("fails instead of looping when a later export page is empty", async () => {
		await expect(
			collectExportPages(
				{ rows: [1, 2], total: 3, page: 1, pageSize: 100 },
				async () => ({ rows: [], total: 3, page: 2, pageSize: 100 }),
			),
		).rejects.toMatchObject({ status: 409 });
	});
});
