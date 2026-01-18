/**
 * Service-layer error types.
 *
 * Used by orchestration services (sync, analysis, embedding, etc.)
 * following the same TaggedError pattern as data errors.
 */

import { TaggedError } from "better-result";
import { z } from "zod";

// ============================================================================
// Zod Enums (single source of truth for string literals)
// ============================================================================

/** Sync operation types */
export const SyncTypeSchema = z.enum(["liked_songs", "playlists", "playlist_tracks"]);
export type SyncType = z.infer<typeof SyncTypeSchema>;

// ============================================================================
// External API Errors
// ============================================================================

/** DeepInfra API request failed */
export class DeepInfraError extends TaggedError("DeepInfraError")<{
	endpoint: string;
	statusCode?: number;
	message: string;
}>() {
	constructor(endpoint: string, statusCode?: number, detail?: string) {
		super({
			endpoint,
			statusCode,
			message: `DeepInfra ${endpoint} failed${statusCode ? ` (${statusCode})` : ""}${detail ? `: ${detail}` : ""}`,
		});
	}
}

/** Rate limit exceeded on external API */
export class RateLimitError extends TaggedError("RateLimitError")<{
	service: string;
	retryAfterMs?: number;
	message: string;
}>() {
	constructor(opts: { service: string; retryAfterMs?: number }) {
		super({
			service: opts.service,
			retryAfterMs: opts.retryAfterMs,
			message: `Rate limited by ${opts.service}${opts.retryAfterMs ? `, retry after ${opts.retryAfterMs}ms` : ""}`,
		});
	}
}

/** LLM provider request failed */
export class LlmError extends TaggedError("LlmError")<{
	provider: string;
	model: string;
	statusCode?: number;
	message: string;
}>() {
	constructor(opts: { provider: string; model: string; statusCode?: number; message: string }) {
		super({
			provider: opts.provider,
			model: opts.model,
			statusCode: opts.statusCode,
			message: `LLM ${opts.provider}:${opts.model} failed${opts.statusCode ? ` (${opts.statusCode})` : ""}: ${opts.message}`,
		});
	}
}

// ============================================================================
// Analysis Errors
// ============================================================================

/** LLM analysis failed */
export class AnalysisError extends TaggedError("AnalysisError")<{
	songId?: string;
	playlistId?: string;
	reason: string;
	message: string;
}>() {
	constructor(opts: { songId?: string; playlistId?: string; reason: string }) {
		const target = opts.songId
			? `song ${opts.songId}`
			: opts.playlistId
				? `playlist ${opts.playlistId}`
				: "unknown";
		super({
			...opts,
			message: `Analysis failed for ${target}: ${opts.reason}`,
		});
	}
}

/** No lyrics available for song */
export class NoLyricsError extends TaggedError("NoLyricsError")<{
	songId: string;
	artist: string;
	title: string;
	message: string;
}>() {
	constructor(songId: string, artist: string, title: string) {
		super({
			songId,
			artist,
			title,
			message: `No lyrics found for "${artist} - ${title}"`,
		});
	}
}

// ============================================================================
// Sync Errors
// ============================================================================

/** Sync operation failed */
export class SyncError extends TaggedError("SyncError")<{
	syncType: SyncType;
	accountId: string;
	reason: string;
	message: string;
}>() {
	constructor(
		syncType: SyncType,
		accountId: string,
		reason: string,
	) {
		super({
			syncType,
			accountId,
			reason,
			message: `${syncType} sync failed for account ${accountId}: ${reason}`,
		});
	}
}

// ============================================================================
// Embedding Errors
// ============================================================================

/** Embedding dimension mismatch */
export class DimensionMismatchError extends TaggedError(
	"DimensionMismatchError",
)<{
	expected: number;
	actual: number;
	message: string;
}>() {
	constructor(expected: number, actual: number) {
		super({
			expected,
			actual,
			message: `Embedding dimension mismatch: expected ${expected}, got ${actual}`,
		});
	}
}

/** Missing analysis required for embedding */
export class MissingAnalysisError extends TaggedError("MissingAnalysisError")<{
	songId: string;
	message: string;
}>() {
	constructor(songId: string) {
		super({
			songId,
			message: `Song ${songId} requires analysis before embedding`,
		});
	}
}

// ============================================================================
// Union Types
// ============================================================================

/** All external API errors */
export type ExternalApiError = DeepInfraError | RateLimitError;

/** All analysis pipeline errors */
export type AnalysisPipelineError = AnalysisError | NoLyricsError;

/** All sync operation errors */
export type SyncOperationError = SyncError;

/** All embedding errors */
export type EmbeddingError = DimensionMismatchError | MissingAnalysisError;

/** All service-layer errors */
export type ServiceError =
	| ExternalApiError
	| AnalysisPipelineError
	| SyncOperationError
	| EmbeddingError;
