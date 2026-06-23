import { beforeEach, describe, expect, it, vi } from "vitest";

let rpcResponse: { data: unknown; error: unknown };

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(() => ({
		rpc: vi.fn(() => rpcResponse),
	})),
}));

import { hasPhase1SongsNeedingEnrichment } from "../phase1-backfill";

beforeEach(() => {
	rpcResponse = { data: [], error: null };
});

describe("hasPhase1SongsNeedingEnrichment", () => {
	it("returns false when no songs need Phase-1 work", async () => {
		rpcResponse = { data: [], error: null };

		expect(await hasPhase1SongsNeedingEnrichment("acct-1")).toBe(false);
	});

	it("returns true when at least one song needs audio features", async () => {
		rpcResponse = {
			data: [
				{
					song_id: "song-1",
					needs_audio_features: true,
					needs_genre_tagging: false,
				},
			],
			error: null,
		};

		expect(await hasPhase1SongsNeedingEnrichment("acct-1")).toBe(true);
	});

	it("returns true when at least one song needs genre tagging", async () => {
		rpcResponse = {
			data: [
				{
					song_id: "song-2",
					needs_audio_features: false,
					needs_genre_tagging: true,
				},
			],
			error: null,
		};

		expect(await hasPhase1SongsNeedingEnrichment("acct-1")).toBe(true);
	});

	it("throws on RPC error so callers can surface it", async () => {
		rpcResponse = { data: null, error: { message: "connection refused" } };

		await expect(hasPhase1SongsNeedingEnrichment("acct-1")).rejects.toThrow(
			"Failed to probe Phase-1 enrichment work: connection refused",
		);
	});
});
