/**
 * Unit tests for resolveMinMatchScore — the single helper every read path calls
 * to turn a stored strictness preset into a numeric bar. The supabase client is
 * stubbed so we can drive the preferences row (or its absence) directly.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, mockClient } = vi.hoisted(() => {
	const state = {
		select: { data: null as unknown, error: null as unknown },
		insert: {
			data: null as unknown,
			error: { code: "500", message: "no insert" } as unknown,
		},
	};
	const mockClient = {
		from: () => ({
			select: () => ({
				eq: () => ({ single: () => Promise.resolve(state.select) }),
			}),
			insert: () => ({
				select: () => ({ single: () => Promise.resolve(state.insert) }),
			}),
		}),
	};
	return { state, mockClient };
});

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => mockClient,
}));

import { resolveMinMatchScore } from "../preferences-queries";

beforeEach(() => {
	state.select = { data: null, error: null };
	state.insert = { data: null, error: { code: "500", message: "no insert" } };
});

describe("resolveMinMatchScore", () => {
	it("maps a stored 'strict' preset to 0.65", async () => {
		state.select = { data: { match_strictness: "strict" }, error: null };
		expect(await resolveMinMatchScore("acct-1")).toBe(0.65);
	});

	it("maps a stored 'balanced' preset to 0.5", async () => {
		state.select = { data: { match_strictness: "balanced" }, error: null };
		expect(await resolveMinMatchScore("acct-1")).toBe(0.5);
	});

	it("maps a stored 'open' preset to 0.35", async () => {
		state.select = { data: { match_strictness: "open" }, error: null };
		expect(await resolveMinMatchScore("acct-1")).toBe(0.35);
	});

	it("falls back to the default (balanced/0.5) when no row exists and creation fails", async () => {
		// PGRST116 = not found → getPreferences returns ok(null) → getOrCreate
		// tries to insert → insert errors → resolve falls back to the default.
		state.select = { data: null, error: { code: "PGRST116" } };
		expect(await resolveMinMatchScore("acct-1")).toBe(0.5);
	});

	it("falls back to the default when the stored value is not a known preset", async () => {
		state.select = { data: { match_strictness: "bogus" }, error: null };
		expect(await resolveMinMatchScore("acct-1")).toBe(0.5);
	});
});
