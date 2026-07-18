/**
 * Tests for selectOwnedSongIds — the server-side draft ownership guard.
 *
 * The guard constrains a caller-supplied songId list to the account's active
 * liked_song rows so persistNewPlaylistConfig / recordPlaylistMatchDecisions
 * can't resolve URIs or write match_decision rows for songs the account never
 * liked. Covers: filtering to owned ids, empty input short-circuit, fail-closed
 * on DB error, and chunked `.in()` reads for lists over DB_IN_FILTER_CHUNK_SIZE.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockIn, mockFrom } = vi.hoisted(() => {
	// Chain terminates at .in(): from → select → eq → is → in.
	const mockIn = vi.fn();
	const mockIs = vi.fn(() => ({ in: mockIn }));
	const mockEq = vi.fn(() => ({ is: mockIs }));
	const mockSelect = vi.fn(() => ({ eq: mockEq }));
	const mockFrom = vi.fn(() => ({ select: mockSelect }));
	return { mockIn, mockFrom };
});

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({ from: mockFrom }),
}));

import { selectOwnedSongIds } from "../queries";

describe("selectOwnedSongIds", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns only the ids that map to active liked_song rows", async () => {
		// Caller passes three ids; only two are actually liked by the account.
		mockIn.mockResolvedValue({
			data: [{ song_id: "owned-1" }, { song_id: "owned-2" }],
			error: null,
		});

		const result = await selectOwnedSongIds("acct-1", [
			"owned-1",
			"owned-2",
			"not-owned-3",
		]);

		expect(Result.isOk(result)).toBe(true);
		if (Result.isOk(result)) {
			expect([...result.value].sort()).toEqual(["owned-1", "owned-2"]);
			expect(result.value.has("not-owned-3")).toBe(false);
		}
		expect(mockFrom).toHaveBeenCalledWith("liked_song");
	});

	it("short-circuits to an empty set without querying on empty input", async () => {
		const result = await selectOwnedSongIds("acct-1", []);

		expect(Result.isOk(result)).toBe(true);
		if (Result.isOk(result)) {
			expect(result.value.size).toBe(0);
		}
		expect(mockFrom).not.toHaveBeenCalled();
	});

	it("fails closed (Result.err) on a DB error rather than under-filtering", async () => {
		mockIn.mockResolvedValue({
			data: null,
			error: { code: "500", message: "boom" },
		});

		const result = await selectOwnedSongIds("acct-1", ["a", "b"]);

		expect(Result.isError(result)).toBe(true);
	});

	it("chunks lists over DB_IN_FILTER_CHUNK_SIZE and unions the results", async () => {
		// 150 ids → two chunks of 100 + 50. Each chunk returns one owned id.
		const ids = Array.from({ length: 150 }, (_, i) => `id-${i}`);
		mockIn
			.mockResolvedValueOnce({ data: [{ song_id: "id-0" }], error: null })
			.mockResolvedValueOnce({ data: [{ song_id: "id-100" }], error: null });

		const result = await selectOwnedSongIds("acct-1", ids);

		expect(mockIn).toHaveBeenCalledTimes(2);
		expect(Result.isOk(result)).toBe(true);
		if (Result.isOk(result)) {
			expect([...result.value].sort()).toEqual(["id-0", "id-100"]);
		}
	});
});
