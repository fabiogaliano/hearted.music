import { describe, it, expect, vi, beforeEach } from "vitest";

let rpcResponse: { data: unknown; error: unknown };

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(() => ({
		rpc: vi.fn(() => rpcResponse),
	})),
}));

import {
	selectEnrichmentWorkPlan,
	hasMoreSongsNeedingEnrichmentWork,
} from "../batch";

beforeEach(() => {
	rpcResponse = { data: [], error: null };
});

describe("selectEnrichmentWorkPlan", () => {
	it("returns empty work plan when no rows are returned", async () => {
		rpcResponse = { data: [], error: null };

		const plan = await selectEnrichmentWorkPlan("account-1", 50);

		expect(plan.allSongIds).toEqual([]);
		expect(plan.flags).toEqual([]);
		expect(plan.needAudioFeatures).toEqual([]);
		expect(plan.needGenreTagging).toEqual([]);
		expect(plan.needAnalysis).toEqual([]);
		expect(plan.needEmbedding).toEqual([]);
		expect(plan.needContentActivation).toEqual([]);
	});

	it("partitions songs into correct sub-batches based on flags", async () => {
		rpcResponse = {
			data: [
				{
					song_id: "song-1",
					needs_audio_features: true,
					needs_genre_tagging: true,
					needs_analysis: false,
					needs_embedding: false,
					needs_content_activation: false,
				},
				{
					song_id: "song-2",
					needs_audio_features: false,
					needs_genre_tagging: false,
					needs_analysis: true,
					needs_embedding: true,
					needs_content_activation: false,
				},
				{
					song_id: "song-3",
					needs_audio_features: true,
					needs_genre_tagging: false,
					needs_analysis: false,
					needs_embedding: false,
					needs_content_activation: true,
				},
			],
			error: null,
		};

		const plan = await selectEnrichmentWorkPlan("account-1", 50);

		expect(plan.allSongIds).toEqual(["song-1", "song-2", "song-3"]);
		expect(plan.needAudioFeatures).toEqual(["song-1", "song-3"]);
		expect(plan.needGenreTagging).toEqual(["song-1"]);
		expect(plan.needAnalysis).toEqual(["song-2"]);
		expect(plan.needEmbedding).toEqual(["song-2"]);
		expect(plan.needContentActivation).toEqual(["song-3"]);
	});

	it("places a song with only one true flag in that sub-batch only", async () => {
		rpcResponse = {
			data: [
				{
					song_id: "song-only-af",
					needs_audio_features: true,
					needs_genre_tagging: false,
					needs_analysis: false,
					needs_embedding: false,
					needs_content_activation: false,
				},
			],
			error: null,
		};

		const plan = await selectEnrichmentWorkPlan("account-1", 10);

		expect(plan.needAudioFeatures).toEqual(["song-only-af"]);
		expect(plan.needGenreTagging).toEqual([]);
		expect(plan.needAnalysis).toEqual([]);
		expect(plan.needEmbedding).toEqual([]);
		expect(plan.needContentActivation).toEqual([]);
	});

	it("places a song with multiple true flags in all corresponding sub-batches", async () => {
		rpcResponse = {
			data: [
				{
					song_id: "song-multi",
					needs_audio_features: false,
					needs_genre_tagging: false,
					needs_analysis: true,
					needs_embedding: true,
					needs_content_activation: false,
				},
			],
			error: null,
		};

		const plan = await selectEnrichmentWorkPlan("account-1", 10);

		expect(plan.needAnalysis).toEqual(["song-multi"]);
		expect(plan.needEmbedding).toEqual(["song-multi"]);
		expect(plan.needAudioFeatures).toEqual([]);
		expect(plan.needGenreTagging).toEqual([]);
		expect(plan.needContentActivation).toEqual([]);
	});

	it("allSongIds length equals number of rows returned", async () => {
		rpcResponse = {
			data: [
				{
					song_id: "a",
					needs_audio_features: true,
					needs_genre_tagging: false,
					needs_analysis: false,
					needs_embedding: false,
					needs_content_activation: false,
				},
				{
					song_id: "b",
					needs_audio_features: false,
					needs_genre_tagging: true,
					needs_analysis: false,
					needs_embedding: false,
					needs_content_activation: false,
				},
			],
			error: null,
		};

		const plan = await selectEnrichmentWorkPlan("account-1", 10);

		expect(plan.allSongIds).toHaveLength(2);
		expect(plan.flags).toHaveLength(2);
	});

	it("maps per-song flags correctly to SongStageFlags", async () => {
		rpcResponse = {
			data: [
				{
					song_id: "s1",
					needs_audio_features: true,
					needs_genre_tagging: false,
					needs_analysis: true,
					needs_embedding: false,
					needs_content_activation: true,
				},
			],
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

	it("throws on RPC error", async () => {
		rpcResponse = { data: null, error: { message: "db down" } };

		await expect(selectEnrichmentWorkPlan("account-1", 10)).rejects.toThrow(
			"Failed to select enrichment work plan: db down",
		);
	});
});

describe("hasMoreSongsNeedingEnrichmentWork", () => {
	it("returns false when no rows are returned", async () => {
		rpcResponse = { data: [], error: null };
		expect(await hasMoreSongsNeedingEnrichmentWork("account-1")).toBe(false);
	});

	it("returns true when at least one row is returned", async () => {
		rpcResponse = {
			data: [
				{
					song_id: "x",
					needs_audio_features: true,
					needs_genre_tagging: false,
					needs_analysis: false,
					needs_embedding: false,
					needs_content_activation: false,
				},
			],
			error: null,
		};
		expect(await hasMoreSongsNeedingEnrichmentWork("account-1")).toBe(true);
	});

	it("throws on RPC error", async () => {
		rpcResponse = { data: null, error: { message: "timeout" } };

		await expect(
			hasMoreSongsNeedingEnrichmentWork("account-1"),
		).rejects.toThrow("Failed to probe songs needing enrichment work: timeout");
	});
});
