/**
 * Persistence for the unified LLM spend ledger (llm_usage).
 *
 * Service-role client (worker-written, deny-all RLS). One row per actual LLM call.
 * recordLlmUsage is BEST-EFFORT: it never throws and a failed insert returns
 * Result.err for the caller to log — it must never break the analysis/distillation
 * that produced the spend. price_version is stamped from the loaded price snapshot
 * so a row is always traceable to the rates that priced it.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { TablesInsert } from "@/lib/data/database.types";
import { PRICE_VERSION } from "@/lib/integrations/llm/pricing";
import type { TokenUsage } from "@/lib/integrations/llm/service";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import { fromSupabaseSingle } from "@/lib/shared/utils/result-wrappers/supabase";

export interface RecordLlmUsageInput {
	/** Call site, e.g. 'song-analysis' | 'song-rewrite' | 'playlist-analysis' | 'annotation-distillation'. */
	functionId: string;
	provider: string;
	/** Bare model id, e.g. 'gemini-2.5-flash'. */
	model: string;
	/** Exactly one of these identifies the entity; the rest stay null. */
	songId?: string | null;
	playlistId?: string | null;
	contentHash?: string | null;
	/** Service token usage; prompt→input and completion→output, with the cache/reasoning splits. */
	tokens: TokenUsage | undefined;
	/** Token × list-price estimate from the service; null when the model is unpriced. */
	costUsd: number | null;
	promptVersion?: string | null;
}

/**
 * Inserts one ledger row. Returns Result<void> — callers log a failure and move on;
 * a ledger miss must not fail the work that already happened.
 */
export async function recordLlmUsage(
	input: RecordLlmUsageInput,
): Promise<Result<void, DbError>> {
	try {
		const supabase = createAdminSupabaseClient();
		const row: TablesInsert<"llm_usage"> = {
			function_id: input.functionId,
			provider: input.provider,
			model: input.model,
			song_id: input.songId ?? null,
			playlist_id: input.playlistId ?? null,
			content_hash: input.contentHash ?? null,
			input_tokens: input.tokens?.prompt ?? 0,
			cache_read_tokens: input.tokens?.cacheReadTokens ?? 0,
			output_tokens: input.tokens?.completion ?? 0,
			reasoning_tokens: input.tokens?.reasoningTokens ?? 0,
			cost_usd: input.costUsd,
			price_version: PRICE_VERSION,
			prompt_version: input.promptVersion ?? null,
		};

		const result = await fromSupabaseSingle(
			supabase.from("llm_usage").insert(row).select("id").single(),
		);
		if (Result.isError(result)) {
			return Result.err(result.error);
		}
		return Result.ok(undefined);
	} catch (error) {
		return Result.err(
			new DatabaseError({
				code: "llm_usage_record_failed",
				message: error instanceof Error ? error.message : String(error),
			}),
		);
	}
}
