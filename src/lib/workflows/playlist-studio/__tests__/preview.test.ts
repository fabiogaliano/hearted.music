/**
 * Tests for the preview-draft workflow (billing + enrichment + ranking RPC
 * orchestration).
 *
 * Collaborators are mocked so these tests exercise only the orchestration
 * branches: intent eligibility gating, embedding-failure degradation, and how
 * the RPC's rows reach composePlaylistPreview. The ranking itself is pinned
 * against the TypeScript reference by preview-rank.integration.test.ts.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSupabaseClient } from "@/lib/data/client";
import { makeBillingState } from "@/lib/domains/billing/fixtures";
import { FREE_BILLING_STATE } from "@/lib/domains/billing/state";
import { SUGGESTIONS_COUNT } from "@/lib/domains/playlists/constants";
import type { RankedSong } from "@/lib/domains/playlists/draft-engine";
import type { PreviewRanking } from "@/lib/domains/playlists/preview-rank-queries";
import { DatabaseError } from "@/lib/shared/errors/database";

const readBillingStateOrFreeTierMock = vi.fn();
vi.mock("@/lib/domains/billing/queries", () => ({
	readBillingStateOrFreeTier: (...args: unknown[]) =>
		readBillingStateOrFreeTierMock(...args),
}));

const rankPreviewCandidatesMock = vi.fn();
vi.mock("@/lib/domains/playlists/preview-rank-queries", () => ({
	rankPreviewCandidates: (...args: unknown[]) =>
		rankPreviewCandidatesMock(...args),
}));

const embeddingServiceCreateMock = vi.fn();
const embedTextMock = vi.fn();
const getModelMock = vi.fn(() => "test-model");
vi.mock("@/lib/domains/enrichment/embeddings/service", () => ({
	EmbeddingService: {
		create: (...args: unknown[]) => embeddingServiceCreateMock(...args),
	},
}));

const captureServerErrorMock = vi.fn();
vi.mock("@/lib/observability/capture-server-error", () => ({
	captureServerError: (...args: unknown[]) => captureServerErrorMock(...args),
}));

import { runPreviewPlaylistDraft } from "../preview";

const fakeSupabase = {} as AdminSupabaseClient;

function rankedSong(id: string, score: number): RankedSong {
	return {
		candidate: {
			song: {
				id,
				spotifyId: `sp-${id}`,
				name: `Song ${id}`,
				artists: ["Artist"],
				genres: ["pop"],
			},
			display: { imageUrl: null, album: null, durationMs: null },
		},
		score,
	};
}

function ranking(overrides: Partial<PreviewRanking> = {}): PreviewRanking {
	return {
		totalEligible: 0,
		rankedPoolCount: 0,
		ranked: [],
		pinned: [],
		...overrides,
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

/** The intent argument the workflow passed to the ranking RPC. */
function rankedIntent() {
	return rankPreviewCandidatesMock.mock.calls[0][2].intent;
}

describe("runPreviewPlaylistDraft", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		embeddingServiceCreateMock.mockReturnValue(
			Result.ok({ embedText: embedTextMock, getModel: getModelMock }),
		);
		rankPreviewCandidatesMock.mockResolvedValue(Result.ok(ranking()));
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
		expect(embedTextMock).not.toHaveBeenCalled();
		expect(rankedIntent()).toBeNull();
		expect(result.intentApplied).toBe(false);
	});

	it("ineligible account ignores client intent", async () => {
		readBillingStateOrFreeTierMock.mockResolvedValue(
			makeBillingState({ unlimitedAccess: { kind: "none" } }),
		);

		const result = await runPreviewPlaylistDraft(
			fakeSupabase,
			"acct-1",
			baseInput({ intent: "lofi beats to study to" }),
		);

		expect(embedTextMock).not.toHaveBeenCalled();
		expect(rankedIntent()).toBeNull();
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
		expect(rankedIntent()).toBeNull();
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

		expect(captureServerErrorMock).toHaveBeenCalledWith(
			expect.objectContaining({ message: "no ML provider configured" }),
			expect.objectContaining({ accountId: "acct-1" }),
		);
		expect(rankedIntent()).toBeNull();
		expect(result.intentApplied).toBe(false);
	});

	it("embedText error → pills-only, intentApplied false", async () => {
		readBillingStateOrFreeTierMock.mockResolvedValue(
			makeBillingState({ unlimitedAccess: { kind: "subscription" } }),
		);
		embedTextMock.mockResolvedValue(Result.err(new Error("provider timeout")));

		const result = await runPreviewPlaylistDraft(
			fakeSupabase,
			"acct-1",
			baseInput({ intent: "moody synths" }),
		);

		expect(captureServerErrorMock).toHaveBeenCalledWith(
			expect.objectContaining({ message: "provider timeout" }),
			expect.objectContaining({ accountId: "acct-1" }),
		);
		expect(rankedIntent()).toBeNull();
		expect(result.intentApplied).toBe(false);
	});

	it("eligible intent ranks against the embedding service's model", async () => {
		readBillingStateOrFreeTierMock.mockResolvedValue(
			makeBillingState({ unlimitedAccess: { kind: "subscription" } }),
		);
		embedTextMock.mockResolvedValue(Result.ok([0.1, 0.2, 0.3]));

		const result = await runPreviewPlaylistDraft(
			fakeSupabase,
			"acct-1",
			baseInput({ intent: "  moody synths  " }),
		);

		expect(embedTextMock).toHaveBeenCalledWith("moody synths", {
			role: "query",
		});
		expect(rankedIntent()).toEqual({
			embedding: [0.1, 0.2, 0.3],
			model: "test-model",
		});
		expect(result.intentApplied).toBe(true);
	});

	it("no intent → no billing read and no embedding service", async () => {
		await runPreviewPlaylistDraft(fakeSupabase, "acct-1", baseInput());

		expect(readBillingStateOrFreeTierMock).not.toHaveBeenCalled();
		expect(embeddingServiceCreateMock).not.toHaveBeenCalled();
		expect(rankedIntent()).toBeNull();
	});

	it("pinned rows lead the tracklist and the ranked limit covers the deepest suggestions window", async () => {
		const ranked = Array.from({ length: 10 + 24 + SUGGESTIONS_COUNT }, (_, i) =>
			rankedSong(`r${i}`, 1 - i / 100),
		);
		rankPreviewCandidatesMock.mockResolvedValue(
			Result.ok(
				ranking({
					totalEligible: 500,
					ranked,
					// Out-of-filter pin: absent from ranked, scored low.
					pinned: [rankedSong("pin", 0.01)],
				}),
			),
		);

		const result = await runPreviewPlaylistDraft(
			fakeSupabase,
			"acct-1",
			baseInput({
				maxSongs: 10,
				suggestionsOffset: 24,
				pinnedSongIds: ["pin"],
			}),
		);

		expect(rankPreviewCandidatesMock.mock.calls[0][2].rankedLimit).toBe(
			10 + 24 + SUGGESTIONS_COUNT,
		);
		expect(result.tracklist.map((s) => s.id)).toEqual([
			"pin",
			...ranked.slice(0, 9).map((e) => e.candidate.song.id),
		]);
		expect(result.suggestions.map((s) => s.id)).toEqual(
			ranked
				.slice(9 + 24, 9 + 24 + SUGGESTIONS_COUNT)
				.map((e) => e.candidate.song.id),
		);
		expect(result.totalEligible).toBe(500);
		expect(result.droppedPinnedSongIds).toEqual([]);
	});

	it("ranking RPC failure is reported and thrown rather than shown as an empty preview", async () => {
		const dbError = new DatabaseError({
			code: "57014",
			message: "canceling statement due to statement timeout",
		});
		rankPreviewCandidatesMock.mockResolvedValue(Result.err(dbError));

		const thrown = await runPreviewPlaylistDraft(
			fakeSupabase,
			"acct-1",
			baseInput(),
		).catch((error: unknown) => error);

		expect(thrown).toBeInstanceOf(Error);
		expect((thrown as Error).cause).toBe(dbError);
		// TaggedErrors are iterable (yield* in Result.gen), and deep equality would
		// iterate one, so compare the captured error by identity.
		const [captured, context] = captureServerErrorMock.mock.calls[0];
		expect(captured).toBe(dbError);
		expect(context).toMatchObject({ accountId: "acct-1" });
	});
});
