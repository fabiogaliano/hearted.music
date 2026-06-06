import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import type { Json } from "@/lib/data/database.types";
import { parseDocument } from "../queries";

// The worker writes an absent role as undefined; Postgres jsonb stores it as null. The read
// path must accept that and normalize back to undefined — otherwise every cached document with
// community annotations (the vast majority) fails to parse.
const docWithNullRole: Json = {
	schemaVersion: 1,
	source: "genius",
	sections: [
		{
			type: "Verse 1",
			lines: [
				{
					id: 1,
					text: "a line",
					annotations: [
						{
							text: "a community note",
							verified: false,
							votes_total: 20,
							pinnedRole: null,
							state: "accepted",
						},
					],
				},
			],
		},
	],
};

describe("parseDocument", () => {
	it("accepts pinnedRole: null and normalizes it to undefined", () => {
		const result = parseDocument(docWithNullRole);
		expect(Result.isOk(result)).toBe(true);
		if (Result.isOk(result)) {
			const annotation = result.value.sections[0].lines[0].annotations?.[0];
			expect(annotation?.pinnedRole).toBeUndefined();
			expect(annotation?.text).toBe("a community note");
		}
	});

	it("rejects an unsupported schema version", () => {
		const result = parseDocument({
			...docWithNullRole,
			schemaVersion: 99,
		} as Json);
		expect(Result.isError(result)).toBe(true);
	});
});
