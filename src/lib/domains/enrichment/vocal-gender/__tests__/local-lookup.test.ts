import { beforeEach, describe, expect, it, vi } from "vitest";

// bun:sqlite only exists in the Bun runtime (the worker). Under Vitest/Node we
// stub it so this exercises the wrapper's logic — dedupe, miss handling, the
// readonly point lookup — independent of the runtime. The real SQLite read is
// validated at build time by scripts/maintenance/build-vocal-gender-db.ts.
const fixture = new Map<string, { gender: string }>([
	["male-id", { gender: "male" }],
	["female-id", { gender: "female" }],
	["other-id", { gender: "other" }],
]);

vi.mock("bun:sqlite", () => ({
	Database: class {
		query() {
			return { get: (id: string) => fixture.get(id) };
		}
	},
}));

import { lookupLocalGenders } from "../local-lookup";

describe("lookupLocalGenders", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns an empty map for empty input", async () => {
		expect((await lookupLocalGenders([])).size).toBe(0);
	});

	it("resolves known artists and omits misses", async () => {
		const m = await lookupLocalGenders(["male-id", "female-id", "missing-id"]);
		expect(m.get("male-id")).toBe("male");
		expect(m.get("female-id")).toBe("female");
		expect(m.has("missing-id")).toBe(false);
		expect(m.size).toBe(2);
	});

	it("dedupes repeated ids", async () => {
		const m = await lookupLocalGenders(["other-id", "other-id"]);
		expect(m.size).toBe(1);
		expect(m.get("other-id")).toBe("other");
	});
});
