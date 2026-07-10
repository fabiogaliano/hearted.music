import { beforeEach, describe, expect, it, vi } from "vitest";

let rpcResponse: { data: unknown; error: unknown };
// Per-RPC overrides let a test feed the ungated Phase-1 selector and the gated
// selector distinct rows; unset names fall back to the shared rpcResponse.
let rpcResponseByName: Record<string, { data: unknown; error: unknown }>;
// Every RPC name the code issues, in call order. Tracking all of them (rather
// than just the last) lets dispatch assertions check exactly which gated
// selector ran without constraining the order the production code issues in.
let calledRpcNames: string[];

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(() => ({
		rpc: vi.fn((name: string) => {
			calledRpcNames.push(name);
			return rpcResponseByName[name] ?? rpcResponse;
		}),
	})),
}));

import {
	hasMoreSongsNeedingEnrichmentWork,
	selectEnrichmentWorkPlan,
} from "../batch";

const PHASE1_RPC = "select_phase1_song_ids_needing_enrichment_work";
const GATED_RPC = "select_liked_song_ids_needing_enrichment_work";

beforeEach(() => {
	rpcResponse = { data: [], error: null };
	rpcResponseByName = {};
	calledRpcNames = [];
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

		expect(calledRpcNames).toContain(
			"select_liked_song_ids_needing_enrichment_work",
		);
		expect(calledRpcNames).not.toContain(
			"select_liked_song_ids_needing_first_match_enrichment_work",
		);
	});

	it("calls the bootstrap RPC when mode is 'first_match_bootstrap'", async () => {
		await selectEnrichmentWorkPlan("account-1", 10, "first_match_bootstrap");

		expect(calledRpcNames).toContain(
			"select_liked_song_ids_needing_first_match_enrichment_work",
		);
		expect(calledRpcNames).not.toContain(
			"select_liked_song_ids_needing_enrichment_work",
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

describe("selectEnrichmentWorkPlan — Phase-1 / gated selector merge", () => {
	it("takes audio/genre flags from the ungated Phase-1 selector, not the gated one", async () => {
		// Free-user shape: the gated selector returns this song with its Phase-1
		// flags FALSE (not entitled), while the ungated Phase-1 selector reports
		// the real pending work. The merged plan must reflect Phase-1's flags.
		rpcResponseByName = {
			[PHASE1_RPC]: {
				data: [
					{
						song_id: "free-song",
						needs_audio_features: true,
						needs_genre_tagging: true,
					},
				],
				error: null,
			},
			[GATED_RPC]: {
				data: [
					{
						song_id: "free-song",
						needs_audio_features: false,
						needs_genre_tagging: false,
						needs_analysis: false,
						needs_embedding: false,
						needs_content_activation: false,
					},
				],
				error: null,
			},
		};

		const plan = await selectEnrichmentWorkPlan("account-1", 50, "normal");

		expect(plan.needAudioFeatures).toEqual(["free-song"]);
		expect(plan.needGenreTagging).toEqual(["free-song"]);
		expect(plan.needAnalysis).toEqual([]);
	});

	it("includes a Phase-1-only song the gated selector never returns", async () => {
		rpcResponseByName = {
			[PHASE1_RPC]: {
				data: [
					{
						song_id: "phase1-only",
						needs_audio_features: true,
						needs_genre_tagging: false,
					},
				],
				error: null,
			},
			[GATED_RPC]: { data: [], error: null },
		};

		const plan = await selectEnrichmentWorkPlan("account-1", 50, "normal");

		expect(plan.allSongIds).toEqual(["phase1-only"]);
		expect(plan.needAudioFeatures).toEqual(["phase1-only"]);
		expect(plan.flags[0]).toEqual({
			songId: "phase1-only",
			needsAudioFeatures: true,
			needsGenreTagging: false,
			needsAnalysis: false,
			needsEmbedding: false,
			needsContentActivation: false,
		});
	});

	it("unions songs across both selectors with Phase-1 order first", async () => {
		rpcResponseByName = {
			[PHASE1_RPC]: {
				data: [
					{
						song_id: "shared",
						needs_audio_features: true,
						needs_genre_tagging: false,
					},
					{
						song_id: "phase1-only",
						needs_audio_features: true,
						needs_genre_tagging: false,
					},
				],
				error: null,
			},
			[GATED_RPC]: {
				data: [
					{
						song_id: "shared",
						needs_audio_features: false,
						needs_genre_tagging: false,
						needs_analysis: true,
						needs_embedding: false,
						needs_content_activation: false,
					},
					{
						song_id: "gated-only",
						needs_audio_features: false,
						needs_genre_tagging: false,
						needs_analysis: false,
						needs_embedding: true,
						needs_content_activation: false,
					},
				],
				error: null,
			},
		};

		const plan = await selectEnrichmentWorkPlan("account-1", 50, "normal");

		expect(plan.allSongIds).toEqual(["shared", "phase1-only", "gated-only"]);
		expect(plan.needAudioFeatures).toEqual(["shared", "phase1-only"]);
		expect(plan.needAnalysis).toEqual(["shared"]);
		expect(plan.needEmbedding).toEqual(["gated-only"]);
	});

	it("throws the Phase-1 message when only the Phase-1 selector errors", async () => {
		rpcResponseByName = {
			[PHASE1_RPC]: { data: null, error: { message: "phase1 down" } },
			[GATED_RPC]: { data: [], error: null },
		};

		await expect(
			selectEnrichmentWorkPlan("account-1", 10, "normal"),
		).rejects.toThrow(
			"Failed to select Phase-1 enrichment work plan: phase1 down",
		);
	});
});
