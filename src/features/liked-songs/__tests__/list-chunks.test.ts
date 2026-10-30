import { describe, expect, it } from "vitest";
import { chunkAroundOrigin } from "../components/list-chunks";

const rows = (from: number, to: number) =>
	Array.from({ length: to - from }, (_, i) => `r${from + i}`);

describe("chunkAroundOrigin", () => {
	it("keeps every existing chunk's rows and key when a row lands above the origin", () => {
		const before = chunkAroundOrigin(rows(0, 120), 0, 50);
		const after = chunkAroundOrigin(["new", ...rows(0, 120)], 1, 50);

		expect(after[0]).toEqual({ key: -1, items: ["new"] });
		expect(after.slice(1)).toEqual(before);
	});

	it("gives a partial page prepended above the origin its own chunk", () => {
		const chunks = chunkAroundOrigin(
			[...rows(0, 23), ...rows(100, 160)],
			23,
			50,
		);

		expect(chunks.map(({ key, items }) => [key, items.length])).toEqual([
			[-1, 23],
			[0, 50],
			[1, 10],
		]);
	});
});
