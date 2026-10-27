import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";
import { getMatchResults } from "../queries";

// PostgREST's max_rows (supabase/config.toml, and prod): no response carries
// more rows than this, whatever range was asked for.
const MAX_ROWS = 1000;
const SNAPSHOT_ROWS = 2500;

const { snapshotRows } = vi.hoisted(() => ({
	snapshotRows: Array.from({ length: 2500 }, (_, i) => ({
		song_id: `song-${String(i).padStart(4, "0")}`,
		playlist_id: "pl-1",
		score: 1 - i / 10_000,
		fused_score: null,
	})),
}));

function cappedQuery() {
	const query = {
		select: () => query,
		eq: () => query,
		order: () => query,
		range: (from: number, to: number) =>
			Promise.resolve({
				data: snapshotRows.slice(from, Math.min(to + 1, from + MAX_ROWS)),
				error: null,
			}),
		// biome-ignore lint/suspicious/noThenProperty: an unranged PostgREST query is awaited directly, and that single request is what gets truncated
		then: (resolve: (value: unknown) => void) =>
			resolve({ data: snapshotRows.slice(0, MAX_ROWS), error: null }),
	};
	return query;
}

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({ from: () => cappedQuery() }),
}));

describe("getMatchResults", () => {
	it("regression: returns every row of a snapshot past the PostgREST row cap (one request truncated at 1,000)", async () => {
		const result = await getMatchResults("snap-1");
		if (Result.isError(result)) throw result.error;

		expect(result.value).toHaveLength(SNAPSHOT_ROWS);
		expect(new Set(result.value.map((r) => r.song_id)).size).toBe(
			SNAPSHOT_ROWS,
		);
	});
});
