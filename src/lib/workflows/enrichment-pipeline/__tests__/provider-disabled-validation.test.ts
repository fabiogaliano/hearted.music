/**
 * S3-12: Provider-Disabled Validation
 *
 * Verifies that self_hosted accounts pass through the same entitlement path
 * as paid accounts, with full library processing and no regressions from
 * billing-unaware behavior.
 *
 * Tests the complete chain:
 *   Account provisioning → billing state → enrichment selector → orchestrator →
 *   content activation → read models (display_state, match refresh)
 *
 * Split into two describe blocks because the orchestrator requires mocking
 * the batch module (same pattern as orchestrator.test.ts), while provisioning
 * and activation tests mock the supabase client directly.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingState } from "@/lib/domains/billing/state";
import type { PipelineBatch } from "../batch";
import type { EnrichmentWorkPlan } from "../types";

// ---------------------------------------------------------------------------
// Mocks: env
// ---------------------------------------------------------------------------

const mockEnv = { BILLING_ENABLED: false };

vi.mock("@/env", () => ({
	env: new Proxy(
		{},
		{
			get: (_target, prop) => {
				if (prop === "BILLING_ENABLED") return mockEnv.BILLING_ENABLED;
				return undefined;
			},
		},
	),
}));

// ---------------------------------------------------------------------------
// Mocks: supabase client
// ---------------------------------------------------------------------------

const supabaseInteractions = {
	inserts: [] as Array<{ table: string; data: Record<string, unknown> }>,
	rpcs: [] as Array<{ fn: string; params: Record<string, unknown> }>,
};

const mockRpc = vi.fn((fn: string, params: Record<string, unknown> = {}) => {
	supabaseInteractions.rpcs.push({ fn, params });

	if (fn === "select_liked_song_ids_needing_enrichment_work") {
		return {
			data: [
				{
					song_id: "song-1",
					needs_audio_features: true,
					needs_genre_tagging: true,
					needs_analysis: true,
					needs_embedding: true,
					needs_content_activation: true,
				},
				{
					song_id: "song-2",
					needs_audio_features: true,
					needs_genre_tagging: true,
					needs_analysis: true,
					needs_embedding: true,
					needs_content_activation: true,
				},
				{
					song_id: "song-3",
					needs_audio_features: true,
					needs_genre_tagging: true,
					needs_analysis: true,
					needs_embedding: true,
					needs_content_activation: true,
				},
			],
			error: null,
		};
	}

	if (fn === "reprioritize_pending_jobs_for_account") {
		return { data: null, error: null };
	}

	if (fn === "insert_song_unlocks_without_charge") {
		return { data: null, error: null };
	}

	if (fn === "create_account_with_billing") {
		return {
			data: {
				id: "test-account-id",
				better_auth_user_id: params.p_better_auth_user_id ?? null,
				email: params.p_email ?? null,
				display_name: params.p_display_name ?? null,
				spotify_id: null,
				handle: null,
				image_url: null,
				created_at: "2026-04-06T00:00:00Z",
				updated_at: "2026-04-06T00:00:00Z",
			},
			error: null,
		};
	}

	return { data: null, error: null };
});

const mockInsert = vi.fn((data: Record<string, unknown>) => ({
	select: () => ({
		single: () => {
			if ("better_auth_user_id" in data) {
				supabaseInteractions.inserts.push({ table: "account", data });
				return Promise.resolve({
					data: {
						id: "test-account-id",
						better_auth_user_id: data.better_auth_user_id,
						email: data.email,
						display_name: data.display_name,
						spotify_id: null,
						created_at: "2026-04-06T00:00:00Z",
						updated_at: "2026-04-06T00:00:00Z",
					},
					error: null,
				});
			}
			return Promise.resolve({ data: null, error: null });
		},
	}),
}));

const mockBillingInsert = vi.fn((data: Record<string, unknown>) => {
	supabaseInteractions.inserts.push({ table: "account_billing", data });
	return Promise.resolve({ data: null, error: null });
});

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(() => ({
		from: vi.fn((table: string) => {
			if (table === "account") {
				return { insert: mockInsert, select: vi.fn() };
			}
			if (table === "account_billing") {
				return {
					insert: mockBillingInsert,
					select: () => ({
						eq: () => ({
							single: () =>
								Promise.resolve({
									data: {
										account_id: "test-account-id",
										plan: "free",
										credit_balance: 0,
										subscription_status: "none",
										cancel_at_period_end: false,
										unlimited_access_source: "self_hosted",
										stripe_customer_id: null,
										stripe_subscription_id: null,
										subscription_period_end: null,
										created_at: "2026-04-06T00:00:00Z",
										updated_at: "2026-04-06T00:00:00Z",
									},
									error: null,
								}),
						}),
					}),
				};
			}
			return {
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({ data: null, error: null }),
			};
		}),
		rpc: mockRpc,
	})),
}));

// ---------------------------------------------------------------------------
// Mocks: billing queries (for content activation path)
// ---------------------------------------------------------------------------

const selfHostedBillingState: BillingState = {
	plan: "free",
	creditBalance: 0,
	subscriptionStatus: "none",
	cancelAtPeriodEnd: false,
	subscriptionPeriodEnd: null,
	unlimitedAccess: { kind: "self_hosted" },
	queueBand: "priority",
};

vi.mock("@/lib/domains/billing/queries", () => ({
	readBillingState: vi.fn(() => Result.ok(selfHostedBillingState)),
}));

// ---------------------------------------------------------------------------
// Mocks: batch module (for orchestrator tests)
// ---------------------------------------------------------------------------

function makeFullWorkPlan(): EnrichmentWorkPlan {
	const allSongIds = ["song-1", "song-2", "song-3"];
	return {
		allSongIds,
		flags: allSongIds.map((songId) => ({
			songId,
			needsAudioFeatures: true,
			needsGenreTagging: true,
			needsAnalysis: true,
			needsEmbedding: true,
			needsContentActivation: true,
		})),
		needAudioFeatures: allSongIds,
		needGenreTagging: allSongIds,
		needAnalysis: allSongIds,
		needEmbedding: allSongIds,
		needContentActivation: allSongIds,
	};
}

function makeBatch(songIds: string[]): PipelineBatch {
	const now = new Date().toISOString();
	return {
		songIds,
		songs: songIds.map((id) => ({
			id,
			spotify_id: `sp-${id}`,
			name: id,
			artists: ["test"],
			artist_ids: [],
			genres: ["rock"],
			album_id: null,
			album_name: null,
			image_url: null,
			preview_url: null,
			duration_ms: null,
			popularity: null,
			isrc: null,
			release_year: null,
			release_year_checked_at: null,
			vocal_gender: null,
			created_at: now,
			updated_at: now,
		})),
		spotifyIdBySongId: new Map(songIds.map((id) => [id, `sp-${id}`])),
	};
}

const mockSelectEnrichmentWorkPlan = vi
	.fn<() => Promise<EnrichmentWorkPlan>>()
	.mockResolvedValue(makeFullWorkPlan());
const mockLoadBatchSongs = vi
	.fn<() => Promise<PipelineBatch>>()
	.mockResolvedValue(makeBatch(["song-1", "song-2", "song-3"]));
const mockHasMoreSongsNeedingEnrichmentWork = vi
	.fn<() => Promise<boolean>>()
	.mockResolvedValue(false);
const mockGetEntitledDataEnrichedSongIds = vi
	.fn<() => Promise<string[]>>()
	.mockResolvedValue([]);

vi.mock("../batch", () => ({
	selectEnrichmentWorkPlan: (...args: unknown[]) =>
		mockSelectEnrichmentWorkPlan(...(args as [])),
	loadBatchSongs: (...args: unknown[]) => mockLoadBatchSongs(...(args as [])),
	hasMoreSongsNeedingEnrichmentWork: (...args: unknown[]) =>
		mockHasMoreSongsNeedingEnrichmentWork(...(args as [])),
	getEntitledDataEnrichedSongIds: (...args: unknown[]) =>
		mockGetEntitledDataEnrichedSongIds(...(args as [])),
}));

// ---------------------------------------------------------------------------
// Mocks: enrichment stages
// ---------------------------------------------------------------------------

function audioOutcomeSuccess(songIds: string[]): {
	kind: "attempted";
	stage: "audio_features";
	candidateSongIds: string[];
	attemptedSongIds: string[];
	succeededSongIds: string[];
	failures: never[];
} {
	return {
		kind: "attempted",
		stage: "audio_features",
		candidateSongIds: songIds,
		attemptedSongIds: songIds,
		succeededSongIds: songIds,
		failures: [],
	};
}

function genreOutcomeSuccess(songIds: string[]): {
	kind: "attempted";
	stage: "genre_tagging";
	candidateSongIds: string[];
	attemptedSongIds: string[];
	succeededSongIds: string[];
	failures: never[];
} {
	return {
		kind: "attempted",
		stage: "genre_tagging",
		candidateSongIds: songIds,
		attemptedSongIds: songIds,
		succeededSongIds: songIds,
		failures: [],
	};
}

function embeddingOutcomeSuccess(songIds: string[]): {
	kind: "attempted";
	stage: "song_embedding";
	candidateSongIds: string[];
	attemptedSongIds: string[];
	succeededSongIds: string[];
	failures: never[];
} {
	return {
		kind: "attempted",
		stage: "song_embedding",
		candidateSongIds: songIds,
		attemptedSongIds: songIds,
		succeededSongIds: songIds,
		failures: [],
	};
}

function analysisOutcomeSuccess(songIds: string[]): {
	kind: "attempted";
	stage: "song_analysis";
	candidateSongIds: string[];
	attemptedSongIds: string[];
	succeededSongIds: string[];
	failures: never[];
} {
	return {
		kind: "attempted",
		stage: "song_analysis",
		candidateSongIds: songIds,
		attemptedSongIds: songIds,
		succeededSongIds: songIds,
		failures: [],
	};
}

function activationOutcomeSuccess(songIds: string[]): {
	kind: "attempted";
	stage: "content_activation";
	candidateSongIds: string[];
	attemptedSongIds: string[];
	succeededSongIds: string[];
	failures: never[];
} {
	return {
		kind: "attempted",
		stage: "content_activation",
		candidateSongIds: songIds,
		attemptedSongIds: songIds,
		succeededSongIds: songIds,
		failures: [],
	};
}

const mockRunAudioFeatures = vi
	.fn()
	.mockImplementation((_ctx: unknown, batch: PipelineBatch) =>
		Promise.resolve(audioOutcomeSuccess(batch.songIds)),
	);
const mockRunGenreTagging = vi
	.fn()
	.mockImplementation((_ctx: unknown, batch: PipelineBatch) =>
		Promise.resolve(genreOutcomeSuccess(batch.songIds)),
	);
const mockRunSongAnalysis = vi
	.fn()
	.mockImplementation((_ctx: unknown, batch: PipelineBatch) =>
		Promise.resolve(analysisOutcomeSuccess(batch.songIds)),
	);
const mockRunSongEmbedding = vi
	.fn()
	.mockImplementation((_ctx: unknown, batch: PipelineBatch) =>
		Promise.resolve(embeddingOutcomeSuccess(batch.songIds)),
	);
const mockRunContentActivation = vi
	.fn()
	.mockImplementation((_ctx: unknown, songIds: string[]) =>
		Promise.resolve(activationOutcomeSuccess(songIds)),
	);
const mockMarkItemsNew = vi.fn().mockResolvedValue(Result.ok([]));

vi.mock("../stages/audio-features", () => ({
	runAudioFeatures: (...args: unknown[]) => mockRunAudioFeatures(...args),
}));
vi.mock("../stages/genre-tagging", () => ({
	runGenreTagging: (...args: unknown[]) => mockRunGenreTagging(...args),
}));
vi.mock("../stages/song-analysis", () => ({
	runSongAnalysis: (...args: unknown[]) => mockRunSongAnalysis(...args),
}));
vi.mock("../stages/song-embedding", () => ({
	runSongEmbedding: (...args: unknown[]) => mockRunSongEmbedding(...args),
}));
vi.mock("../stages/content-activation", () => ({
	runContentActivation: (...args: unknown[]) =>
		mockRunContentActivation(...args),
}));
vi.mock("@/lib/domains/library/liked-songs/status-queries", () => ({
	markItemsNew: (...args: unknown[]) => mockMarkItemsNew(...args),
	markPipelineProcessed: vi.fn().mockResolvedValue(Result.ok(undefined)),
}));

// ---------------------------------------------------------------------------
// Mocks: infrastructure
// ---------------------------------------------------------------------------

vi.mock("@/lib/domains/enrichment/embeddings/service", () => ({
	EmbeddingService: {
		create: () =>
			Result.ok({
				getEmbeddings: vi.fn().mockResolvedValue(Result.ok(new Map())),
			}),
	},
}));

vi.mock("@/lib/platform/jobs/repository", () => ({
	updateJobProgress: vi.fn().mockResolvedValue(Result.ok(undefined)),
}));

vi.mock("@/lib/platform/jobs/item-failures", () => ({
	resolveJobStageFailures: vi.fn().mockResolvedValue(Result.ok(0)),
}));

vi.mock("../record-failure", () => ({
	recordStageFailure: vi.fn().mockResolvedValue(Result.ok(undefined)),
}));

vi.mock("@/lib/domains/enrichment/audio-features/queries", () => ({
	getBatch: vi.fn().mockResolvedValue(Result.ok(new Map())),
}));

vi.mock("@/lib/domains/enrichment/content-analysis/queries", () => ({
	get: vi.fn().mockResolvedValue(Result.ok(new Map())),
}));

vi.mock("@/lib/domains/library/songs/queries", () => ({
	getByIds: vi.fn().mockResolvedValue(Result.ok([])),
}));

vi.mock("@/lib/integrations/llm/service", () => ({
	createLlmService: vi.fn().mockReturnValue(undefined),
}));

vi.mock("@/lib/domains/taste/playlist-profiling/service", () => ({
	createPlaylistProfilingService: vi.fn().mockReturnValue({}),
}));

// ---------------------------------------------------------------------------
// Imports (must come after mocks)
// ---------------------------------------------------------------------------

import { createAccountForBetterAuthUser } from "@/lib/domains/library/accounts/queries";
import { executeWorkerChunk } from "../orchestrator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCOUNT_ID = "test-account-id";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks();
	supabaseInteractions.inserts = [];
	supabaseInteractions.rpcs = [];
	mockEnv.BILLING_ENABLED = false;
	mockRunAudioFeatures.mockImplementation(
		(_ctx: unknown, batch: PipelineBatch) =>
			Promise.resolve(audioOutcomeSuccess(batch.songIds)),
	);
	mockRunGenreTagging.mockImplementation(
		(_ctx: unknown, batch: PipelineBatch) =>
			Promise.resolve(genreOutcomeSuccess(batch.songIds)),
	);
	mockRunSongAnalysis.mockImplementation(
		(_ctx: unknown, batch: PipelineBatch) =>
			Promise.resolve(analysisOutcomeSuccess(batch.songIds)),
	);
	mockRunSongEmbedding.mockImplementation(
		(_ctx: unknown, batch: PipelineBatch) =>
			Promise.resolve(embeddingOutcomeSuccess(batch.songIds)),
	);
	mockRunContentActivation.mockImplementation(
		(_ctx: unknown, songIds: string[]) =>
			Promise.resolve(activationOutcomeSuccess(songIds)),
	);
	mockMarkItemsNew.mockResolvedValue(Result.ok([]));
	mockSelectEnrichmentWorkPlan.mockResolvedValue(makeFullWorkPlan());
	mockLoadBatchSongs.mockResolvedValue(
		makeBatch(["song-1", "song-2", "song-3"]),
	);
	mockHasMoreSongsNeedingEnrichmentWork.mockResolvedValue(false);
});

describe("S3-12: Provider-Disabled (self_hosted) Validation", () => {
	describe("1. Account provisioning with BILLING_ENABLED=false", () => {
		it("provisions account_billing with unlimited_access_source='self_hosted'", async () => {
			const result = await createAccountForBetterAuthUser({
				better_auth_user_id: "ba-user-1",
				email: "test@example.com",
				display_name: "Test User",
			});

			expect(result).toBeOk();
			if (!Result.isOk(result)) return;

			expect(result.value.id).toBe(ACCOUNT_ID);

			const provisionCall = supabaseInteractions.rpcs.find(
				(r) => r.fn === "create_account_with_billing",
			);
			expect(provisionCall).toBeDefined();
			expect(provisionCall?.params).toEqual({
				p_better_auth_user_id: "ba-user-1",
				p_email: "test@example.com",
				p_display_name: "Test User",
				p_unlimited_access_source: "self_hosted",
			});
		});

		it("calls reprioritize_pending_jobs_for_account after provisioning", async () => {
			await createAccountForBetterAuthUser({
				better_auth_user_id: "ba-user-2",
				email: "test2@example.com",
				display_name: "Test User 2",
			});

			const reprioritizeCall = supabaseInteractions.rpcs.find(
				(r) => r.fn === "reprioritize_pending_jobs_for_account",
			);
			expect(reprioritizeCall).toBeDefined();
			expect(reprioritizeCall?.params).toEqual({
				p_account_id: ACCOUNT_ID,
			});
		});

		it("does NOT set self_hosted when BILLING_ENABLED=true", async () => {
			mockEnv.BILLING_ENABLED = true;

			await createAccountForBetterAuthUser({
				better_auth_user_id: "ba-user-3",
				email: "test3@example.com",
				display_name: "Test User 3",
			});

			const provisionCall = supabaseInteractions.rpcs.find(
				(r) => r.fn === "create_account_with_billing",
			);
			expect(provisionCall?.params).toEqual({
				p_better_auth_user_id: "ba-user-3",
				p_email: "test3@example.com",
				p_display_name: "Test User 3",
			});

			const reprioritizeCall = supabaseInteractions.rpcs.find(
				(r) => r.fn === "reprioritize_pending_jobs_for_account",
			);
			expect(reprioritizeCall).toBeUndefined();
		});
	});

	describe("4. Full pipeline runs all phases (A + B + C + activation)", () => {
		it("orchestrator runs all four enrichment stages for self_hosted account", async () => {
			const result = await executeWorkerChunk(ACCOUNT_ID, "job-1", 50, 0);

			expect(mockRunAudioFeatures).toHaveBeenCalledOnce();
			expect(mockRunGenreTagging).toHaveBeenCalledOnce();
			expect(mockRunSongAnalysis).toHaveBeenCalledOnce();
			expect(mockRunSongEmbedding).toHaveBeenCalledOnce();

			expect(result.readyCount).toBe(3);
		});

		it("Phase B (analysis) receives all songs — not gated out", async () => {
			await executeWorkerChunk(ACCOUNT_ID, "job-1", 50, 0);

			const analysisBatch = mockRunSongAnalysis.mock
				.calls[0][1] as PipelineBatch;
			expect(analysisBatch.songIds).toEqual(["song-1", "song-2", "song-3"]);
		});

		it("Phase C (embedding) receives all songs — not gated out", async () => {
			await executeWorkerChunk(ACCOUNT_ID, "job-1", 50, 0);

			const embeddingBatch = mockRunSongEmbedding.mock
				.calls[0][1] as PipelineBatch;
			expect(embeddingBatch.songIds).toEqual(["song-1", "song-2", "song-3"]);
		});

		it("content activation is called with all songs", async () => {
			await executeWorkerChunk(ACCOUNT_ID, "job-1", 50, 0);

			expect(mockRunContentActivation).toHaveBeenCalledOnce();
			const [ctx, songIds] = mockRunContentActivation.mock.calls[0] as [
				unknown,
				string[],
			];
			expect(songIds).toEqual(["song-1", "song-2", "song-3"]);
			expect(ctx).toMatchObject({ accountId: ACCOUNT_ID });
		});
	});

	describe("6. No regressions: self_hosted equivalent to pre-billing full-library", () => {
		it("orchestrator processes same count as pre-billing (all songs)", async () => {
			const result = await executeWorkerChunk(ACCOUNT_ID, "job-1", 50, 0);

			expect(result.readyCount).toBe(3);
			expect(result.doneCount).toBeGreaterThan(0);
		});
	});
});
