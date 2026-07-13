/**
 * Tests for the preview-draft workflow (billing + library + enrichment +
 * taste orchestration).
 *
 * All domain/query collaborators are mocked (per the scheduler.test.ts
 * idiom) so these tests exercise only the orchestration branches: intent
 * eligibility gating, embedding-failure degradation, and the stored-embedding
 * JSON.parse hazard. Scoring math itself is covered by draft-engine.test.ts.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSupabaseClient } from "@/lib/data/client";
import { makeBillingState } from "@/lib/domains/billing/fixtures";
import { FREE_BILLING_STATE } from "@/lib/domains/billing/state";
import type { Phase1Candidate } from "@/lib/domains/playlists/candidate-loader";

const readBillingStateOrFreeTierMock = vi.fn();
vi.mock("@/lib/domains/billing/queries", () => ({
	readBillingStateOrFreeTier: (...args: unknown[]) =>
		readBillingStateOrFreeTierMock(...args),
}));

const loadPhase1CandidatesMock = vi.fn();
vi.mock("@/lib/domains/playlists/candidate-loader", () => ({
	loadPhase1Candidates: (...args: unknown[]) =>
		loadPhase1CandidatesMock(...args),
}));

const getSongEmbeddingsBatchMock = vi.fn();
vi.mock("@/lib/domains/enrichment/embeddings/queries", () => ({
	getSongEmbeddingsBatch: (...args: unknown[]) =>
		getSongEmbeddingsBatchMock(...args),
}));

const embeddingServiceCreateMock = vi.fn();
const embedTextMock = vi.fn();
const getModelMock = vi.fn(() => "test-model");
vi.mock("@/lib/domains/enrichment/embeddings/service", () => ({
	EmbeddingService: {
		create: (...args: unknown[]) => embeddingServiceCreateMock(...args),
	},
}));

const selectEligibleCandidatesMock = vi.fn();
const buildDraftProfileMock = vi.fn();
const rankCandidatesMock = vi.fn();
const composePlaylistPreviewMock = vi.fn();
vi.mock("@/lib/domains/playlists/draft-engine", () => ({
	selectEligibleCandidates: (...args: unknown[]) =>
		selectEligibleCandidatesMock(...args),
	buildDraftProfile: (...args: unknown[]) => buildDraftProfileMock(...args),
	rankCandidates: (...args: unknown[]) => rankCandidatesMock(...args),
	composePlaylistPreview: (...args: unknown[]) =>
		composePlaylistPreviewMock(...args),
}));

import { runPreviewPlaylistDraft } from "../preview";

const fakeSupabase = {} as AdminSupabaseClient;

function makeCandidate(id: string): Phase1Candidate {
	return {
		song: {
			id,
			spotifyId: `sp-${id}`,
			name: `Song ${id}`,
			artists: ["Artist"],
			genres: ["pop"],
			audioFeatures: null,
		},
		filterMeta: {
			language: "en",
			languageSecondary: null,
			releaseYear: 2020,
			vocalGender: null,
			likedAt: Date.now(),
		},
		display: { imageUrl: null, album: null, durationMs: null },
	};
}

function baseInput(
	overrides: Partial<Parameters<typeof runPreviewPlaylistDraft>[2]> = {},
) {
	return {
		intent: undefined,
		genrePills: [],
		matchFilters: { version: 1 as const },
		maxSongs: 15,
		pinnedSongIds: [],
		excludedSongIds: [],
		suggestionsOffset: 0,
		...overrides,
	};
}

describe("runPreviewPlaylistDraft", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		loadPhase1CandidatesMock.mockResolvedValue([
			makeCandidate("a"),
			makeCandidate("b"),
		]);
		selectEligibleCandidatesMock.mockImplementation((candidates) => candidates);
		buildDraftProfileMock.mockReturnValue({ source: "draft-profile" });
		rankCandidatesMock.mockResolvedValue([]);
		// Passes intentApplied/totalEligible straight through so tests can assert
		// on them without re-implementing composePlaylistPreview's slicing logic.
		composePlaylistPreviewMock.mockImplementation(
			({ intentApplied, totalEligible }) => ({
				tracklist: [],
				suggestions: [],
				totalEligible,
				intentApplied,
				droppedPinnedSongIds: [],
			}),
		);
	});

	it("degrades to free tier on billing error → intentApplied false even with intent", async () => {
		// readBillingStateOrFreeTier owns the degrade-on-error behavior itself
		// (covered by its own unit tests); this simulates what it returns when
		// the underlying read fails.
		readBillingStateOrFreeTierMock.mockResolvedValue(FREE_BILLING_STATE);

		const result = await runPreviewPlaylistDraft(
			fakeSupabase,
			"acct-1",
			baseInput({ intent: "moody synths" }),
		);

		expect(embeddingServiceCreateMock).not.toHaveBeenCalled();
		expect(buildDraftProfileMock).toHaveBeenCalled();
		expect(buildDraftProfileMock.mock.calls[0][2]).toBeUndefined();
		expect(result.intentApplied).toBe(false);
	});

	it("ineligible account: client intent ignored, EmbeddingService.create never called", async () => {
		readBillingStateOrFreeTierMock.mockResolvedValue(
			makeBillingState({ unlimitedAccess: { kind: "none" } }),
		);

		const result = await runPreviewPlaylistDraft(
			fakeSupabase,
			"acct-1",
			baseInput({ intent: "lofi beats to study to" }),
		);

		expect(embeddingServiceCreateMock).not.toHaveBeenCalled();
		expect(buildDraftProfileMock).toHaveBeenCalled();
		expect(buildDraftProfileMock.mock.calls[0][2]).toBeUndefined();
		expect(result.intentApplied).toBe(false);
	});

	it("eligible + blank/whitespace intent → pills-only", async () => {
		readBillingStateOrFreeTierMock.mockResolvedValue(
			makeBillingState({ unlimitedAccess: { kind: "subscription" } }),
		);

		const result = await runPreviewPlaylistDraft(
			fakeSupabase,
			"acct-1",
			baseInput({ intent: "   " }),
		);

		expect(embeddingServiceCreateMock).not.toHaveBeenCalled();
		expect(buildDraftProfileMock).toHaveBeenCalled();
		expect(buildDraftProfileMock.mock.calls[0][2]).toBeUndefined();
		expect(result.intentApplied).toBe(false);
	});

	it("EmbeddingService.create() error → pills-only", async () => {
		readBillingStateOrFreeTierMock.mockResolvedValue(
			makeBillingState({ unlimitedAccess: { kind: "subscription" } }),
		);
		embeddingServiceCreateMock.mockReturnValue(
			Result.err(new Error("no ML provider configured")),
		);

		const result = await runPreviewPlaylistDraft(
			fakeSupabase,
			"acct-1",
			baseInput({ intent: "moody synths" }),
		);

		expect(getSongEmbeddingsBatchMock).not.toHaveBeenCalled();
		expect(buildDraftProfileMock).toHaveBeenCalled();
		expect(buildDraftProfileMock.mock.calls[0][2]).toBeUndefined();
		expect(result.intentApplied).toBe(false);
	});

	it("embedText error → pills-only, intentApplied false", async () => {
		readBillingStateOrFreeTierMock.mockResolvedValue(
			makeBillingState({ unlimitedAccess: { kind: "subscription" } }),
		);
		embeddingServiceCreateMock.mockReturnValue(
			Result.ok({ embedText: embedTextMock, getModel: getModelMock }),
		);
		embedTextMock.mockResolvedValue(Result.err(new Error("provider timeout")));
		getSongEmbeddingsBatchMock.mockResolvedValue(Result.ok(new Map()));

		const result = await runPreviewPlaylistDraft(
			fakeSupabase,
			"acct-1",
			baseInput({ intent: "moody synths" }),
		);

		expect(buildDraftProfileMock).toHaveBeenCalled();
		expect(buildDraftProfileMock.mock.calls[0][2]).toBeUndefined();
		expect(result.intentApplied).toBe(false);
	});

	it("parses a stored embedding when it comes back as a JSON string", async () => {
		readBillingStateOrFreeTierMock.mockResolvedValue(
			makeBillingState({ unlimitedAccess: { kind: "subscription" } }),
		);
		embeddingServiceCreateMock.mockReturnValue(
			Result.ok({ embedText: embedTextMock, getModel: getModelMock }),
		);
		embedTextMock.mockResolvedValue(Result.ok([0.1, 0.2, 0.3]));
		getSongEmbeddingsBatchMock.mockResolvedValue(
			Result.ok(
				new Map([["a", { embedding: JSON.stringify([1, 2, 3]) } as never]]),
			),
		);

		await runPreviewPlaylistDraft(
			fakeSupabase,
			"acct-1",
			baseInput({ intent: "moody synths" }),
		);

		const songEmbeddingsMap = rankCandidatesMock.mock.calls[0][2] as Map<
			string,
			number[]
		>;
		expect(songEmbeddingsMap.get("a")).toEqual([1, 2, 3]);
	});

	it("passes an already-array stored embedding through unchanged", async () => {
		readBillingStateOrFreeTierMock.mockResolvedValue(
			makeBillingState({ unlimitedAccess: { kind: "subscription" } }),
		);
		embeddingServiceCreateMock.mockReturnValue(
			Result.ok({ embedText: embedTextMock, getModel: getModelMock }),
		);
		embedTextMock.mockResolvedValue(Result.ok([0.1, 0.2, 0.3]));
		getSongEmbeddingsBatchMock.mockResolvedValue(
			Result.ok(new Map([["b", { embedding: [4, 5, 6] } as never]])),
		);

		await runPreviewPlaylistDraft(
			fakeSupabase,
			"acct-1",
			baseInput({ intent: "moody synths" }),
		);

		const songEmbeddingsMap = rankCandidatesMock.mock.calls[0][2] as Map<
			string,
			number[]
		>;
		expect(songEmbeddingsMap.get("b")).toEqual([4, 5, 6]);
	});

	it("song-embeddings fetch error with successful intent embedding: intentApplied stays true, map stays undefined", async () => {
		readBillingStateOrFreeTierMock.mockResolvedValue(
			makeBillingState({ unlimitedAccess: { kind: "subscription" } }),
		);
		embeddingServiceCreateMock.mockReturnValue(
			Result.ok({ embedText: embedTextMock, getModel: getModelMock }),
		);
		embedTextMock.mockResolvedValue(Result.ok([0.1, 0.2, 0.3]));
		getSongEmbeddingsBatchMock.mockResolvedValue(
			Result.err(new Error("song_embedding read failed")),
		);

		const result = await runPreviewPlaylistDraft(
			fakeSupabase,
			"acct-1",
			baseInput({ intent: "moody synths" }),
		);

		expect(buildDraftProfileMock.mock.calls[0][2]).toEqual([0.1, 0.2, 0.3]);
		expect(result.intentApplied).toBe(true);
		const songEmbeddingsMap = rankCandidatesMock.mock.calls[0][2];
		expect(songEmbeddingsMap).toBeUndefined();
	});
});
