import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

let queuedResponses: Array<{
	data: Array<{ spotify_id: string; image_url: string | null }> | null;
	error: { code: string; message: string } | null;
}> = [];
let inCalls: string[][] = [];
const mockFrom = vi.fn();

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(() => ({
		from: mockFrom,
	})),
}));

const { getWithImagesBySpotifyIds } = await import("../queries");

describe("artists queries", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		queuedResponses = [];
		inCalls = [];

		mockFrom.mockImplementation(() => ({
			select: () => ({
				in: (_column: string, values: string[]) => {
					inCalls.push(values);
					return {
						not: () =>
							queuedResponses.shift() ?? {
								data: [],
								error: null,
							},
					};
				},
			}),
		}));
	});

	it("returns empty array without querying for empty input", async () => {
		const result = await getWithImagesBySpotifyIds([]);

		expect(result).toEqual(Result.ok([]));
		expect(mockFrom).not.toHaveBeenCalled();
	});

	it("returns only artists with string image URLs", async () => {
		queuedResponses = [
			{
				data: [
					{ spotify_id: "artist-1", image_url: "https://img/1.jpg" },
					{ spotify_id: "artist-2", image_url: null },
				],
				error: null,
			},
		];

		const result = await getWithImagesBySpotifyIds(["artist-1", "artist-2"]);

		expect(result).toEqual(
			Result.ok([{ spotify_id: "artist-1", image_url: "https://img/1.jpg" }]),
		);
		expect(inCalls).toEqual([["artist-1", "artist-2"]]);
	});

	it("batches ids into groups of 100 after deduping", async () => {
		const artistIds = Array.from(
			{ length: 205 },
			(_value, index) => `artist-${index % 201}`,
		);
		queuedResponses = [
			{
				data: [{ spotify_id: "artist-0", image_url: "https://img/0.jpg" }],
				error: null,
			},
			{
				data: [{ spotify_id: "artist-100", image_url: "https://img/100.jpg" }],
				error: null,
			},
			{
				data: [{ spotify_id: "artist-200", image_url: "https://img/200.jpg" }],
				error: null,
			},
		];

		const result = await getWithImagesBySpotifyIds(artistIds);

		expect(result).toEqual(
			Result.ok([
				{ spotify_id: "artist-0", image_url: "https://img/0.jpg" },
				{ spotify_id: "artist-100", image_url: "https://img/100.jpg" },
				{ spotify_id: "artist-200", image_url: "https://img/200.jpg" },
			]),
		);
		expect(inCalls).toHaveLength(3);
		expect(inCalls[0]).toHaveLength(100);
		expect(inCalls[1]).toHaveLength(100);
		expect(inCalls[2]).toHaveLength(1);
	});
});
