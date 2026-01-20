/**
 * RerankerService - Cross-encoder reranking for match refinement.
 *
 * Responsibilities:
 * - Rerank candidate matches using DeepInfra's cross-encoder
 * - Blend reranker scores with original scores
 * - Graceful degradation when reranking fails
 *
 * Uses:
 * - DeepInfraService for reranking API calls
 *
 * This implements stage-2 of a two-stage matching pipeline:
 * 1. Stage 1: Fast embedding similarity to get top-N candidates
 * 2. Stage 2: Cross-encoder reranking of top-N for better precision
 */

import { Result } from "better-result";
import { z } from "zod";
import * as deepinfra from "../deepinfra/service";
import type { DeepInfraError } from "@/lib/errors/external/deepinfra";

// ============================================================================
// Zod Schemas (single source of truth)
// ============================================================================

/** Configuration for reranking operations */
export const RerankerConfigSchema = z.object({
	/** Number of top candidates to rerank (default: 50) */
	topN: z.number().min(1).max(100).default(50),
	/** Weight for blending reranker score with original score (0-1, default: 0.3) */
	blendWeight: z.number().min(0).max(1).default(0.3),
	/** Minimum original score to consider for reranking (default: 0.2) */
	minScoreThreshold: z.number().min(0).max(1).default(0.2),
});
export type RerankerConfig = z.infer<typeof RerankerConfigSchema>;

/** Default reranker configuration */
export const DEFAULT_RERANKER_CONFIG: RerankerConfig = {
	topN: 50,
	blendWeight: 0.3,
	minScoreThreshold: 0.2,
};

/** A match candidate with score */
export const MatchCandidateSchema = z.object({
	id: z.string(),
	score: z.number(),
	document: z.string(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});
export type MatchCandidate = z.infer<typeof MatchCandidateSchema>;

/** Statistics about the reranking operation */
export const RerankStatsSchema = z.object({
	originalTopScore: z.number(),
	rerankTopScore: z.number(),
	scoreShift: z.number(),
});
export type RerankStats = z.infer<typeof RerankStatsSchema>;

/** Result of a reranking operation */
export const RerankResultSchema = z.object({
	/** Reranked candidates with blended scores */
	candidates: z.array(MatchCandidateSchema),
	/** Whether reranking was actually performed */
	reranked: z.boolean(),
	/** Number of candidates that were reranked */
	rerankedCount: z.number(),
	/** Statistics about the reranking operation */
	stats: RerankStatsSchema,
});
export type RerankResult = z.infer<typeof RerankResultSchema>;

type RerankerServiceError = DeepInfraError;

// ============================================================================
// Service
// ============================================================================

export class RerankerService {
	private config: RerankerConfig;

	constructor(config: Partial<RerankerConfig> = {}) {
		// Validate and apply defaults via Zod
		this.config = RerankerConfigSchema.parse({
			...DEFAULT_RERANKER_CONFIG,
			...config,
		});
	}

	/**
	 * Reranks candidates based on their relevance to a query.
	 *
	 * @param query - The query text (e.g., playlist profile)
	 * @param candidates - Candidates from stage-1 matching
	 * @returns Reranked candidates with blended scores
	 */
	async rerank(
		query: string,
		candidates: MatchCandidate[],
	): Promise<Result<RerankResult, RerankerServiceError>> {
		// Guard: no candidates
		if (candidates.length === 0) {
			return Result.ok(this.createEmptyResult());
		}

		// Guard: empty query
		if (!query?.trim()) {
			return Result.ok(this.createSkippedResult(candidates));
		}

		// Filter candidates above minimum threshold
		const eligibleCandidates = candidates.filter(
			(c) => c.score >= this.config.minScoreThreshold,
		);

		// Guard: no candidates above threshold
		if (eligibleCandidates.length === 0) {
			return Result.ok(this.createSkippedResult(candidates));
		}

		// Take top-N for reranking
		const topN = Math.min(this.config.topN, eligibleCandidates.length);
		const toRerank = eligibleCandidates.slice(0, topN);
		const notReranked = candidates.slice(topN);

		// Extract documents for reranking
		const documents = toRerank.map((c) => c.document);

		// Call DeepInfra reranker
		const rerankResult = await deepinfra.rerank(query, documents);

		if (Result.isError(rerankResult)) {
			// Graceful degradation: return original order
			return Result.ok(this.createSkippedResult(candidates));
		}

		// Build score map from reranker results
		const rerankScores = new Map<number, number>();
		for (const score of rerankResult.value.scores) {
			rerankScores.set(score.index, score.score);
		}

		// Apply blended scores to reranked candidates
		const rerankedCandidates: MatchCandidate[] = toRerank.map(
			(candidate, index) => {
				const rerankScore = rerankScores.get(index) ?? 0.5;
				const blendedScore = this.blendScores(candidate.score, rerankScore);

				return {
					...candidate,
					score: blendedScore,
					metadata: {
						...candidate.metadata,
						rerank_score: rerankScore,
						original_score: candidate.score,
					},
				};
			},
		);

		// Sort reranked by new blended score
		rerankedCandidates.sort((a, b) => b.score - a.score);

		// Combine reranked + not reranked
		const allCandidates = [...rerankedCandidates, ...notReranked];

		// Calculate stats
		const originalTopScore = candidates[0]?.score ?? 0;
		const rerankTopScore = allCandidates[0]?.score ?? 0;

		return Result.ok({
			candidates: allCandidates,
			reranked: true,
			rerankedCount: topN,
			stats: {
				originalTopScore,
				rerankTopScore,
				scoreShift: rerankTopScore - originalTopScore,
			},
		});
	}

	/**
	 * Checks if the reranker service is available.
	 */
	async isAvailable(): Promise<boolean> {
		return deepinfra.isAvailable();
	}

	/**
	 * Updates the reranker configuration.
	 */
	updateConfig(config: Partial<RerankerConfig>): void {
		this.config = { ...this.config, ...config };
	}

	/**
	 * Gets the current configuration.
	 */
	getConfig(): RerankerConfig {
		return { ...this.config };
	}

	// ============================================================================
	// Private Helpers
	// ============================================================================

	/**
	 * Blends original score with reranker score.
	 *
	 * Formula: blended = (1 - weight) * original + weight * reranker
	 *
	 * With default weight=0.3:
	 *   - 70% of original score is preserved
	 *   - 30% comes from cross-encoder reranking
	 */
	private blendScores(originalScore: number, rerankScore: number): number {
		return (
			(1 - this.config.blendWeight) * originalScore +
			this.config.blendWeight * rerankScore
		);
	}

	/**
	 * Creates an empty result when there are no candidates.
	 */
	private createEmptyResult(): RerankResult {
		return {
			candidates: [],
			reranked: false,
			rerankedCount: 0,
			stats: {
				originalTopScore: 0,
				rerankTopScore: 0,
				scoreShift: 0,
			},
		};
	}

	/**
	 * Creates a skipped result when reranking was not performed.
	 */
	private createSkippedResult(candidates: MatchCandidate[]): RerankResult {
		const topScore = candidates[0]?.score ?? 0;
		return {
			candidates,
			reranked: false,
			rerankedCount: 0,
			stats: {
				originalTopScore: topScore,
				rerankTopScore: topScore,
				scoreShift: 0,
			},
		};
	}
}
