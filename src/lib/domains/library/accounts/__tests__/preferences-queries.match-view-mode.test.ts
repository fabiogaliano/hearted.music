/**
 * Tests for getPreferredMatchViewMode and setPreferredMatchViewMode (C10 / E15).
 *
 * getPreferredMatchViewMode mirrors resolveMinMatchScore:
 * - defaults to 'playlist' when the row is absent or unreadable
 * - returns the stored value for known modes
 * - falls back to 'playlist' for unrecognised values (future-proofing)
 *
 * setPreferredMatchViewMode is a thin upsert helper — tested via the mock
 * client to confirm the correct column + value are written.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted client mock — mirrors the pattern used in preferences-queries.strictness.test.ts
// ---------------------------------------------------------------------------

const { state, mockUpsert } = vi.hoisted(() => {
	const mockUpsertResult = {
		data: null as unknown,
		error: null as unknown,
	};
	const mockUpsert = vi.fn().mockResolvedValue(mockUpsertResult);

	const state = {
		select: { data: null as unknown, error: null as unknown },
		insert: {
			data: null as unknown,
			error: { code: "500", message: "insert disabled" } as unknown,
		},
		upsert: mockUpsertResult,
	};

	return { state, mockUpsert };
});

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({
		from: () => ({
			select: () => ({
				eq: () => ({ single: () => Promise.resolve(state.select) }),
			}),
			insert: () => ({
				select: () => ({ single: () => Promise.resolve(state.insert) }),
			}),
			upsert: () => ({
				select: () => ({ single: mockUpsert }),
			}),
		}),
	}),
}));

import {
	getPreferredMatchViewMode,
	setPreferredMatchViewMode,
} from "../preferences-queries";

beforeEach(() => {
	state.select = { data: null, error: null };
	state.insert = {
		data: null,
		error: { code: "500", message: "insert disabled" },
	};
	mockUpsert.mockReset();
});

// ---------------------------------------------------------------------------
// getPreferredMatchViewMode
// ---------------------------------------------------------------------------

describe("getPreferredMatchViewMode", () => {
	it("returns 'song' when the row has match_view_mode = 'song'", async () => {
		state.select = {
			data: { match_view_mode: "song", match_strictness: "balanced" },
			error: null,
		};
		expect(await getPreferredMatchViewMode("acct-1")).toBe("song");
	});

	it("returns 'playlist' when the row has match_view_mode = 'playlist'", async () => {
		state.select = {
			data: { match_view_mode: "playlist", match_strictness: "balanced" },
			error: null,
		};
		expect(await getPreferredMatchViewMode("acct-1")).toBe("playlist");
	});

	it("falls back to 'playlist' when the stored value is unrecognised", async () => {
		state.select = {
			data: {
				match_view_mode: "unknown_future_mode",
				match_strictness: "balanced",
			},
			error: null,
		};
		expect(await getPreferredMatchViewMode("acct-1")).toBe("playlist");
	});

	it("falls back to 'playlist' when no row exists and creation fails", async () => {
		state.select = { data: null, error: { code: "PGRST116" } };
		expect(await getPreferredMatchViewMode("acct-1")).toBe("playlist");
	});
});

// ---------------------------------------------------------------------------
// setPreferredMatchViewMode
// ---------------------------------------------------------------------------

describe("setPreferredMatchViewMode", () => {
	it("writes 'song' and returns ok with the updated row", async () => {
		const updatedRow = {
			account_id: "acct-1",
			match_view_mode: "song",
			match_strictness: "balanced",
		};
		mockUpsert.mockResolvedValueOnce({ data: updatedRow, error: null });

		const result = await setPreferredMatchViewMode("acct-1", "song");

		expect(Result.isOk(result)).toBe(true);
		expect(mockUpsert).toHaveBeenCalledOnce();
	});

	it("writes 'playlist' and returns ok with the updated row", async () => {
		const updatedRow = {
			account_id: "acct-1",
			match_view_mode: "playlist",
			match_strictness: "balanced",
		};
		mockUpsert.mockResolvedValueOnce({ data: updatedRow, error: null });

		const result = await setPreferredMatchViewMode("acct-1", "playlist");

		expect(Result.isOk(result)).toBe(true);
		expect(mockUpsert).toHaveBeenCalledOnce();
	});

	it("returns err when the upsert fails", async () => {
		mockUpsert.mockResolvedValueOnce({
			data: null,
			error: { code: "500", message: "db error" },
		});

		const result = await setPreferredMatchViewMode("acct-1", "song");

		expect(Result.isError(result)).toBe(true);
	});
});
