/**
 * Token → dollar cost estimation for production LLM calls.
 *
 * Reads the vendored, pinned price snapshot (model-prices.generated.json, produced
 * by scripts/sync-model-prices.ts) so there is no runtime network dependency and
 * pricing is deterministic and testable. This is a list-price × token ESTIMATE, not
 * the GCP invoice.
 */

import prices from "./model-prices.generated.json";

/** Snapshot id stamped onto every ledger row so a cost is traceable to its price source. */
export const PRICE_VERSION: string = prices._synced_at;

export interface ModelPrice {
	/** USD per input (prompt) token, non-cached. */
	inputPerToken: number;
	/** USD per cached-read input token. Falls back to inputPerToken when the source omits it. */
	cacheReadPerToken?: number;
	/** USD per output token (already covers thinking — see computeCostUsd). */
	outputPerToken: number;
}

// Last-resort prices for our two Gemini models, so a key miss in the generated
// snapshot still yields a real cost instead of silently nulling. Mirrors the
// 2026-06 Vertex on-demand rates; the generated snapshot is the source of truth
// and should match these.
const FALLBACK_PRICES: Record<string, ModelPrice> = {
	"gemini-2.5-flash": {
		inputPerToken: 3e-7,
		cacheReadPerToken: 3e-8,
		outputPerToken: 2.5e-6,
	},
	"gemini-2.5-flash-lite": {
		inputPerToken: 1e-7,
		cacheReadPerToken: 1e-8,
		outputPerToken: 4e-7,
	},
};

type PinnedEntry = {
	input_cost_per_token: number;
	output_cost_per_token: number;
	cache_read_input_token_cost: number | null;
};

const PINNED_MODELS = prices.models as Record<string, PinnedEntry>;

/**
 * Strips any provider routing prefix/suffix so a combined id ("google-vertex:gemini-2.5-flash"
 * or "vertex_ai/gemini-2.5-flash") collapses to the bare model id the snapshot is keyed by.
 */
function normalizeModel(model: string): string {
	const afterColon = model.includes(":")
		? (model.split(":").pop() ?? model)
		: model;
	return afterColon.includes("/")
		? (afterColon.split("/").pop() ?? afterColon)
		: afterColon;
}

/**
 * Resolves the per-token price for a model, or null when unpriced.
 * Vertex callers prefer the vertex_ai-keyed entry; falls back to FALLBACK_PRICES
 * so our two Gemini models never silently null on a snapshot key miss.
 */
export function getModelPrice(
	provider: string,
	model: string,
): ModelPrice | null {
	const bare = normalizeModel(model);
	const candidates =
		provider === "google-vertex"
			? [`vertex_ai/${bare}`, bare]
			: [bare, `vertex_ai/${bare}`];

	for (const key of candidates) {
		const entry = PINNED_MODELS[key];
		if (
			entry &&
			typeof entry.input_cost_per_token === "number" &&
			typeof entry.output_cost_per_token === "number"
		) {
			return {
				inputPerToken: entry.input_cost_per_token,
				cacheReadPerToken:
					typeof entry.cache_read_input_token_cost === "number"
						? entry.cache_read_input_token_cost
						: undefined,
				outputPerToken: entry.output_cost_per_token,
			};
		}
	}

	return FALLBACK_PRICES[bare] ?? null;
}

export interface CostTokens {
	/** Total prompt tokens, INCLUDING any cached-read tokens (Gemini reports it this way). */
	inputTokens: number;
	/** Cached-read subset of inputTokens, billed at the cheaper cache rate. */
	cacheReadTokens?: number;
	/** Total output tokens, INCLUDING thinking (Gemini folds thoughts into output). */
	outputTokens: number;
}

/**
 * Estimates the dollar cost of one call from its token split.
 *
 * Two facts about Gemini's accounting drive the formula:
 * - outputTokens already includes thinking tokens, billed at the output rate, so
 *   `outputTokens × outputRate` is complete — no separate reasoning term.
 * - inputTokens already includes cached tokens, billed cheaper, so input must
 *   split: non-cached at inputRate + cached at cacheReadRate.
 *
 * Returns null (not 0) when the model is unpriced, so "unknown price" stays
 * distinguishable from "genuinely free."
 */
export function computeCostUsd(
	tokens: CostTokens,
	provider: string,
	model: string,
): number | null {
	const price = getModelPrice(provider, model);
	if (!price) return null;

	const cacheRead = tokens.cacheReadTokens ?? 0;
	const nonCachedInput = Math.max(0, tokens.inputTokens - cacheRead);
	const cacheReadRate = price.cacheReadPerToken ?? price.inputPerToken;

	return (
		nonCachedInput * price.inputPerToken +
		cacheRead * cacheReadRate +
		tokens.outputTokens * price.outputPerToken
	);
}
