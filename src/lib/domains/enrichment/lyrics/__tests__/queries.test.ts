import { Result } from "better-result";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Json } from "@/lib/data/database.types";
import { parseDocument, type StoredFetchOutcome } from "../queries";

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

	// A `manual`-source row was found in prod storing its document double-encoded:
	// a JSON string instead of a JSON object. parseDocument must reject it (not
	// throw), so the snapshot reader can skip the one bad row instead of failing
	// the whole batch's lyrics lookup.
	it("rejects a double-encoded (stringified) document", () => {
		const result = parseDocument(JSON.stringify(docWithNullRole) as Json);
		expect(Result.isError(result)).toBe(true);
	});
});

// Type-level tests for fetch-outcome persistence (Decision 5).
// Behavioral coverage (actual DB round-trips) lands in Phase 6 integration tests,
// since these functions require a live song_lyrics row. The types below verify
// that callers can distinguish null (no attempt) from a recorded not_found row,
// which is the core contract getSongFetchOutcome provides.
describe("StoredFetchOutcome type contract", () => {
	it("null and StoredFetchOutcome are distinct (type-level)", () => {
		// The return type must allow null (never attempted) separately from a row.
		expectTypeOf<StoredFetchOutcome | null>().not.toEqualTypeOf<StoredFetchOutcome>();
		expectTypeOf<null>().not.toEqualTypeOf<StoredFetchOutcome>();
	});

	it("fetchStatus covers exactly the three persisted states", () => {
		// All three CHECK-constrained values must be assignable to the field type.
		const lyrics = {
			fetchStatus: "lyrics",
			fetchSource: "genius",
		} satisfies StoredFetchOutcome;
		const instrumental = {
			fetchStatus: "instrumental",
			fetchSource: "lrclib",
		} satisfies StoredFetchOutcome;
		const notFound = {
			fetchStatus: "not_found",
			fetchSource: null,
		} satisfies StoredFetchOutcome;

		expect(lyrics.fetchStatus).toBe("lyrics");
		expect(instrumental.fetchStatus).toBe("instrumental");
		expect(notFound.fetchStatus).toBe("not_found");
		expect(notFound.fetchSource).toBeNull();
	});
});
