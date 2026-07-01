import { beforeEach, describe, expect, it, vi } from "vitest";

let rpcResponse: { data: unknown; error: unknown };
let lastCalledRpcName: string | null = null;

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(() => ({
		rpc: vi.fn((name: string) => {
			lastCalledRpcName = name;
			return rpcResponse;
		}),
	})),
}));

import {
	hasMoreSongsNeedingEnrichmentWork,
	selectEnrichmentWorkPlan,
} from "../batch";

beforeEach(() => {
	rpcResponse = { data: [], error: null };
	lastCalledRpcName = null;
});

describe("selectEnrichmentWorkPlan", () => {
	it("returns empty work plan when no rows are returned", async () => {
		rpcResponse = { data: [], error: null };

		const plan = await selectEnrichmentWorkPlan("account-1", 50, "normal");

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

		const plan = await selectEnrichmentWorkPlan("account-1", 50, "normal");

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

		const plan = await selectEnrichmentWorkPlan("account-1", 10, "normal");

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

		const plan = await selectEnrichmentWorkPlan("account-1", 10, "normal");

		expect(plan.needAnalysis).toEqual(["song-multi"]);
		expect(plan.needEmbedding).toEqual(["song-multi"]);
		expect(plan.needAudioFeatures).toEqual([]);
		expect(plan.needGenreTagging).toEqual([]);
		expect(plan.needContentActivation).toEqual([]);
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

		const plan = await selectEnrichmentWorkPlan("account-1", 10, "normal");

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

		await expect(
			selectEnrichmentWorkPlan("account-1", 10, "normal"),
		).rejects.toThrow("Failed to select enrichment work plan: db down");
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

describe("selectEnrichmentWorkPlan — selection mode dispatch", () => {
	it("calls the normal RPC when mode is 'normal'", async () => {
		await selectEnrichmentWorkPlan("account-1", 10, "normal");

		expect(lastCalledRpcName).toBe(
			"select_liked_song_ids_needing_enrichment_work",
		);
	});

	it("calls the bootstrap RPC when mode is 'first_match_bootstrap'", async () => {
		await selectEnrichmentWorkPlan("account-1", 10, "first_match_bootstrap");

		expect(lastCalledRpcName).toBe(
			"select_liked_song_ids_needing_first_match_enrichment_work",
		);
	});

	it("bootstrap mode returns the same work plan shape as normal mode", async () => {
		rpcResponse = {
			data: [
				{
					song_id: "song-bootstrap",
					needs_audio_features: false,
					needs_genre_tagging: false,
					needs_analysis: false,
					needs_embedding: true,
					needs_content_activation: false,
				},
			],
			error: null,
		};

		const plan = await selectEnrichmentWorkPlan(
			"account-1",
			10,
			"first_match_bootstrap",
		);

		expect(plan.allSongIds).toEqual(["song-bootstrap"]);
		expect(plan.needEmbedding).toEqual(["song-bootstrap"]);
		expect(plan.needAudioFeatures).toEqual([]);
	});
});
