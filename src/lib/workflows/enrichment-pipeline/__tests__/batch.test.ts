import { beforeEach, describe, expect, it, vi } from "vitest";

// Separate responses for each RPC so tests can exercise both ungated (Phase-1)
// and entitlement-gated (Phase-2/3) selectors independently.
let phase1Response: { data: unknown; error: unknown };
let phase23Response: { data: unknown; error: unknown };

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(() => ({
		rpc: vi.fn((name: string) =>
			name === "select_phase1_song_ids_needing_enrichment_work"
				? phase1Response
				: phase23Response,
		),
	})),
}));

import {
	hasMoreSongsNeedingEnrichmentWork,
	selectEnrichmentWorkPlan,
} from "../batch";

const EMPTY_PHASE1 = { data: [], error: null };
const EMPTY_PHASE23 = { data: [], error: null };

beforeEach(() => {
	phase1Response = EMPTY_PHASE1;
	phase23Response = EMPTY_PHASE23;
});

// Helpers to build typed RPC row shapes
function phase1Row(
	songId: string,
	audio: boolean,
	genre: boolean,
): {
	song_id: string;
	needs_audio_features: boolean;
	needs_genre_tagging: boolean;
} {
	return {
		song_id: songId,
		needs_audio_features: audio,
		needs_genre_tagging: genre,
	};
}

function phase23Row(
	songId: string,
	analysis: boolean,
	embedding: boolean,
	activation: boolean,
): {
	song_id: string;
	needs_audio_features: boolean;
	needs_genre_tagging: boolean;
	needs_analysis: boolean;
	needs_embedding: boolean;
	needs_content_activation: boolean;
} {
	return {
		song_id: songId,
		needs_audio_features: false,
		needs_genre_tagging: false,
		needs_analysis: analysis,
		needs_embedding: embedding,
		needs_content_activation: activation,
	};
}

describe("selectEnrichmentWorkPlan", () => {
	it("returns empty work plan when both selectors return no rows", async () => {
		const plan = await selectEnrichmentWorkPlan("account-1", 50);

		expect(plan.allSongIds).toEqual([]);
		expect(plan.flags).toEqual([]);
		expect(plan.needAudioFeatures).toEqual([]);
		expect(plan.needGenreTagging).toEqual([]);
		expect(plan.needAnalysis).toEqual([]);
		expect(plan.needEmbedding).toEqual([]);
		expect(plan.needContentActivation).toEqual([]);
	});

	it("includes un-entitled songs for Phase-1 work only", async () => {
		// "song-free" is not entitled — appears in Phase-1 but not Phase-2/3
		phase1Response = {
			data: [phase1Row("song-free", true, true)],
			error: null,
		};

		const plan = await selectEnrichmentWorkPlan("account-1", 50);

		expect(plan.allSongIds).toContain("song-free");
		expect(plan.needAudioFeatures).toContain("song-free");
		expect(plan.needGenreTagging).toContain("song-free");
		// Phase-2/3 flags must not be set for un-entitled song
		expect(plan.needAnalysis).not.toContain("song-free");
		expect(plan.needEmbedding).not.toContain("song-free");
		expect(plan.needContentActivation).not.toContain("song-free");
	});

	it("includes entitled songs for Phase-2/3 work only when Phase-1 is done", async () => {
		// "song-entitled" already has audio/genre; only needs analysis + embedding
		phase23Response = {
			data: [phase23Row("song-entitled", true, true, false)],
			error: null,
		};

		const plan = await selectEnrichmentWorkPlan("account-1", 50);

		expect(plan.allSongIds).toContain("song-entitled");
		expect(plan.needAnalysis).toContain("song-entitled");
		expect(plan.needEmbedding).toContain("song-entitled");
		expect(plan.needAudioFeatures).not.toContain("song-entitled");
		expect(plan.needGenreTagging).not.toContain("song-entitled");
	});

	it("merges Phase-1 and Phase-2/3 flags for the same song", async () => {
		// "song-both" is entitled AND still needs audio features AND analysis
		phase1Response = {
			data: [phase1Row("song-both", true, false)],
			error: null,
		};
		phase23Response = {
			data: [phase23Row("song-both", true, false, false)],
			error: null,
		};

		const plan = await selectEnrichmentWorkPlan("account-1", 50);

		expect(plan.allSongIds).toEqual(["song-both"]);
		expect(plan.needAudioFeatures).toContain("song-both");
		expect(plan.needAnalysis).toContain("song-both");
		expect(plan.needGenreTagging).not.toContain("song-both");
		expect(plan.needEmbedding).not.toContain("song-both");
		expect(plan.flags[0]).toMatchObject({
			songId: "song-both",
			needsAudioFeatures: true,
			needsGenreTagging: false,
			needsAnalysis: true,
			needsEmbedding: false,
			needsContentActivation: false,
		});
	});

	it("unions song IDs from both selectors without duplication", async () => {
		phase1Response = {
			data: [
				phase1Row("song-a", true, false),
				phase1Row("song-b", false, true),
			],
			error: null,
		};
		phase23Response = {
			data: [phase23Row("song-c", true, false, false)],
			error: null,
		};

		const plan = await selectEnrichmentWorkPlan("account-1", 50);

		expect(new Set(plan.allSongIds)).toEqual(
			new Set(["song-a", "song-b", "song-c"]),
		);
		expect(plan.allSongIds).toHaveLength(3);
	});

	it("does not duplicate a song ID that appears in both selectors", async () => {
		phase1Response = {
			data: [phase1Row("song-shared", true, true)],
			error: null,
		};
		phase23Response = {
			data: [phase23Row("song-shared", true, false, false)],
			error: null,
		};

		const plan = await selectEnrichmentWorkPlan("account-1", 50);

		expect(plan.allSongIds).toHaveLength(1);
		expect(plan.allSongIds[0]).toBe("song-shared");
	});

	it("maps per-song flags correctly to SongStageFlags", async () => {
		phase1Response = {
			data: [phase1Row("s1", true, false)],
			error: null,
		};
		phase23Response = {
			data: [phase23Row("s1", true, false, true)],
			error: null,
		};

		const plan = await selectEnrichmentWorkPlan("account-1", 10);

		expect(plan.flags[0]).toEqual({
			songId: "s1",
			needsAudioFeatures: true,
			needsGenreTagging: false,
			needsAnalysis: true,
			needsEmbedding: false,
			needsContentActivation: true,
		});
	});

	it("throws on Phase-1 RPC error", async () => {
		phase1Response = { data: null, error: { message: "db down" } };

		await expect(selectEnrichmentWorkPlan("account-1", 10)).rejects.toThrow(
			"Failed to select Phase-1 enrichment work plan: db down",
		);
	});

	it("throws on Phase-2/3 RPC error", async () => {
		phase23Response = { data: null, error: { message: "timeout" } };

		await expect(selectEnrichmentWorkPlan("account-1", 10)).rejects.toThrow(
			"Failed to select enrichment work plan: timeout",
		);
	});
});

describe("hasMoreSongsNeedingEnrichmentWork", () => {
	it("returns false when both selectors return no rows", async () => {
		expect(await hasMoreSongsNeedingEnrichmentWork("account-1")).toBe(false);
	});

	it("returns true when Phase-1 selector has pending work", async () => {
		phase1Response = {
			data: [phase1Row("song-x", true, false)],
			error: null,
		};

		expect(await hasMoreSongsNeedingEnrichmentWork("account-1")).toBe(true);
	});

	it("returns true when Phase-2/3 selector has pending work", async () => {
		phase23Response = {
			data: [phase23Row("song-y", true, false, false)],
			error: null,
		};

		expect(await hasMoreSongsNeedingEnrichmentWork("account-1")).toBe(true);
	});

	it("returns true when both selectors have pending work", async () => {
		phase1Response = {
			data: [phase1Row("song-a", true, false)],
			error: null,
		};
		phase23Response = {
			data: [phase23Row("song-b", false, false, true)],
			error: null,
		};

		expect(await hasMoreSongsNeedingEnrichmentWork("account-1")).toBe(true);
	});

	it("throws on Phase-1 RPC error", async () => {
		phase1Response = { data: null, error: { message: "phase1 timeout" } };

		await expect(
			hasMoreSongsNeedingEnrichmentWork("account-1"),
		).rejects.toThrow(
			"Failed to probe songs needing enrichment work: phase1 timeout",
		);
	});

	it("throws on Phase-2/3 RPC error", async () => {
		phase23Response = { data: null, error: { message: "timeout" } };

		await expect(
			hasMoreSongsNeedingEnrichmentWork("account-1"),
		).rejects.toThrow("Failed to probe songs needing enrichment work: timeout");
	});
});
