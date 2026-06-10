import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogUpsertData } from "../queries";

let upsertCalls: Array<Array<{ spotify_id: string }>> = [];
const mockFrom = vi.fn();

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(() => ({ from: mockFrom })),
}));

const { upsertCatalog } = await import("../queries");

function makeCatalogRow(spotifyId: string): CatalogUpsertData {
	return {
		spotify_id: spotifyId,
		name: `name-${spotifyId}`,
		album_id: "album-1",
		album_name: "Album",
		image_url: null,
		artists: ["Artist"],
		artist_ids: ["artist-1"],
		duration_ms: 1000,
	};
}

describe("upsertCatalog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		upsertCalls = [];

		mockFrom.mockImplementation(() => ({
			upsert: (rows: Array<{ spotify_id: string }>) => {
				upsertCalls.push(rows);
				return {
					// Echo back a row per input so we can prove the chunked returns are
					// concatenated into one set — the exact failure mode of a truncated
					// `.select()` would be missing rows here.
					select: () => ({
						data: rows.map((r) => ({
							id: `id-${r.spotify_id}`,
							spotify_id: r.spotify_id,
						})),
						error: null,
					}),
				};
			},
		}));
	});

	it("does not touch the client for empty input", async () => {
		const result = await upsertCatalog([]);

		expect(result).toEqual(Result.ok([]));
		expect(mockFrom).not.toHaveBeenCalled();
	});

	it("sends a 1200-row library as 500/500/200 chunks and returns every row", async () => {
		const data = Array.from({ length: 1200 }, (_v, i) =>
			makeCatalogRow(`spotify-${i}`),
		);

		const result = await upsertCatalog(data);

		expect(upsertCalls.map((c) => c.length).sort((a, b) => b - a)).toEqual([
			500, 500, 200,
		]);

		expect(Result.isOk(result)).toBe(true);
		if (Result.isError(result)) throw new Error("expected ok");
		expect(result.value).toHaveLength(1200);
		const returnedIds = new Set(result.value.map((s) => s.spotify_id));
		expect(returnedIds.size).toBe(1200);
	});

	it("propagates a chunk error instead of returning a partial set", async () => {
		mockFrom.mockImplementation(() => ({
			upsert: (rows: Array<{ spotify_id: string }>) => ({
				select: () =>
					rows[0]?.spotify_id === "spotify-500"
						? { data: null, error: { code: "boom", message: "write failed" } }
						: {
								data: rows.map((r) => ({
									id: `id-${r.spotify_id}`,
									spotify_id: r.spotify_id,
								})),
								error: null,
							},
			}),
		}));

		const data = Array.from({ length: 1200 }, (_v, i) =>
			makeCatalogRow(`spotify-${i}`),
		);

		const result = await upsertCatalog(data);

		expect(Result.isError(result)).toBe(true);
	});
});
