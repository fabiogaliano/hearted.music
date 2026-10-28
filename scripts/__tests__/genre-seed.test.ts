import { describe, expect, it } from "vitest";
import { latestGenreSeedMigration, renderGenreSeedSql } from "../db/genre-seed";

const markerLine = (sql: string) =>
	sql.split("\n").find((line) => line.startsWith("-- GENRE_TABLE_VERSION"));

describe("genre seed migration", () => {
	it("latest committed seed matches table.json + CANON_MAP (stale seed would make the SQL preview ranking diverge from TypeScript)", () => {
		const latest = latestGenreSeedMigration();
		const rendered = renderGenreSeedSql();
		const fix = "run `bun scripts/db/genre-seed.ts` and commit the new migration";

		expect(latest, fix).not.toBeNull();
		// The marker carries the version and content hash, so a mismatch reads
		// as one line instead of a 9,000-row diff.
		expect(markerLine(latest?.sql ?? ""), fix).toBe(markerLine(rendered));
		expect(latest?.sql === rendered, `${latest?.name} differs: ${fix}`).toBe(
			true,
		);
	});
});
