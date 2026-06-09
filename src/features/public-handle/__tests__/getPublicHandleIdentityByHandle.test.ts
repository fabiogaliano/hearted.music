/**
 * Tests for getPublicHandleIdentityByHandle domain query.
 *
 * §14.8 coverage:
 * - returns identity when handle exists + onboarding completed (via inner join)
 * - returns null when no row matches (handle not found or not-complete collapses to null)
 * - maps image_url → imageUrl; does not expose snake_case key
 * - graceful null imageUrl
 * - returns Result.err on DB error — not collapsed to null
 * - lowercases handle before querying
 * - applies !inner join via user_preferences IS NOT NULL filter
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockMaybySingle, mockChainNot, mockChainEq, mockChainSelect } =
	vi.hoisted(() => {
		const mockMaybySingle = vi.fn();
		const mockChainNot = vi
			.fn()
			.mockReturnValue({ maybeSingle: mockMaybySingle });
		const mockChainEq = vi.fn().mockReturnValue({ not: mockChainNot });
		const mockChainSelect = vi.fn().mockReturnValue({ eq: mockChainEq });
		return { mockMaybySingle, mockChainNot, mockChainEq, mockChainSelect };
	});

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({
		from: () => ({ select: mockChainSelect }),
	}),
}));

import { getPublicHandleIdentityByHandle } from "@/lib/domains/library/accounts/queries";

describe("getPublicHandleIdentityByHandle", () => {
	beforeEach(() => {
		mockMaybySingle.mockReset();
		vi.clearAllMocks();
		// Re-wire the chain after clearAllMocks resets return values
		mockChainNot.mockReturnValue({ maybeSingle: mockMaybySingle });
		mockChainEq.mockReturnValue({ not: mockChainNot });
		mockChainSelect.mockReturnValue({ eq: mockChainEq });
	});

	it("returns the identity when the handle exists and onboarding is completed", async () => {
		mockMaybySingle.mockResolvedValue({
			data: { handle: "fabio", image_url: "https://example.com/avatar.jpg" },
			error: null,
		});

		const result = await getPublicHandleIdentityByHandle("fabio");

		expect(Result.isOk(result)).toBe(true);
		if (Result.isOk(result)) {
			expect(result.value).toEqual({
				handle: "fabio",
				imageUrl: "https://example.com/avatar.jpg",
			});
		}
	});

	it("maps image_url to imageUrl and does not expose the snake_case key", async () => {
		mockMaybySingle.mockResolvedValue({
			data: {
				handle: "testuser",
				image_url: "https://img.example.com/photo.png",
			},
			error: null,
		});

		const result = await getPublicHandleIdentityByHandle("testuser");

		expect(Result.isOk(result)).toBe(true);
		if (Result.isOk(result) && result.value !== null) {
			expect(result.value.imageUrl).toBe("https://img.example.com/photo.png");
			expect(
				(result.value as unknown as Record<string, unknown>).image_url,
			).toBeUndefined();
		}
	});

	it("returns null imageUrl gracefully when image_url is null", async () => {
		mockMaybySingle.mockResolvedValue({
			data: { handle: "noavatar", image_url: null },
			error: null,
		});

		const result = await getPublicHandleIdentityByHandle("noavatar");

		expect(Result.isOk(result)).toBe(true);
		if (Result.isOk(result) && result.value !== null) {
			expect(result.value.imageUrl).toBeNull();
		}
	});

	it("returns null when PGRST116 not-found code is returned (handle not found or not-complete)", async () => {
		// PGRST116 is the PostgREST "no row" code; fromSupabaseMaybe maps it to null.
		mockMaybySingle.mockResolvedValue({
			data: null,
			error: {
				code: "PGRST116",
				message: "JSON object requested, multiple (or 0) rows returned",
			},
		});

		const result = await getPublicHandleIdentityByHandle("unknownuser");

		expect(Result.isOk(result)).toBe(true);
		expect(Result.isOk(result) && result.value).toBeNull();
	});

	it("returns null when maybeSingle returns null data with no error (empty result)", async () => {
		mockMaybySingle.mockResolvedValue({ data: null, error: null });

		const result = await getPublicHandleIdentityByHandle("nobody");

		expect(Result.isOk(result)).toBe(true);
		expect(Result.isOk(result) && result.value).toBeNull();
	});

	it("returns Result.err on a real DB error — does not collapse to null", async () => {
		mockMaybySingle.mockResolvedValue({
			data: null,
			error: { code: "42P01", message: "relation does not exist" },
		});

		const result = await getPublicHandleIdentityByHandle("dbfail");

		expect(Result.isError(result)).toBe(true);
	});

	it("normalizes the handle to lowercase before querying", async () => {
		mockMaybySingle.mockResolvedValue({ data: null, error: null });

		await getPublicHandleIdentityByHandle("MixedCase");

		expect(mockChainEq).toHaveBeenCalledWith("handle", "mixedcase");
	});

	it("applies the !inner join filter (user_preferences IS NOT NULL)", async () => {
		mockMaybySingle.mockResolvedValue({ data: null, error: null });

		await getPublicHandleIdentityByHandle("fabio");

		expect(mockChainNot).toHaveBeenCalledWith(
			"user_preferences.onboarding_completed_at",
			"is",
			null,
		);
	});
});
