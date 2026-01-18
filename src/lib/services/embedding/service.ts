/**
 * EmbeddingService - Generates and manages song embeddings.
 *
 * Responsibilities:
 * - Generate embeddings for song analysis text using DeepInfra
 * - Store/retrieve embeddings from database
 * - Handle caching and content hashing to avoid re-embedding
 *
 * Uses:
 * - DeepInfraService for embedding generation
 * - data/vectors.ts for database operations
 * - data/analysis.ts for retrieving song analysis
 */

import { Result } from "better-result";
import { z } from "zod";
import * as deepinfra from "../deepinfra/service";
import * as vectors from "@/lib/data/vectors";
import * as songAnalysis from "@/lib/data/song-analysis";
import type { DbError } from "@/lib/errors/data";
import type { DeepInfraError, RateLimitError } from "@/lib/errors/service";
import { MissingAnalysisError, DimensionMismatchError } from "@/lib/errors/service";
import type { SongEmbedding } from "@/lib/data/vectors";
import type { SongAnalysis } from "@/lib/data/song-analysis";

// ============================================================================
// Zod Schemas (single source of truth)
// ============================================================================

/** Kind of embedding content */
export const EmbeddingKindSchema = z.enum(["full", "theme", "mood", "context"]);
export type EmbeddingKind = z.infer<typeof EmbeddingKindSchema>;

/** Result of embedding a song */
export const EmbedSongResultSchema = z.object({
	songId: z.uuid(),
	embedding: z.custom<SongEmbedding>(),
	cached: z.boolean(),
});
export type EmbedSongResult = z.infer<typeof EmbedSongResultSchema>;

/** Failed embedding item */
export const EmbedFailedItemSchema = z.object({
	songId: z.uuid(),
	error: z.string(),
});
export type EmbedFailedItem = z.infer<typeof EmbedFailedItemSchema>;

/** Result of batch embedding */
export const BatchEmbedResultSchema = z.object({
	succeeded: z.array(EmbedSongResultSchema),
	failed: z.array(EmbedFailedItemSchema),
});
export type BatchEmbedResult = z.infer<typeof BatchEmbedResultSchema>;

type EmbeddingServiceError =
	| DbError
	| DeepInfraError
	| RateLimitError
	| MissingAnalysisError
	| DimensionMismatchError;

// ============================================================================
// Service
// ============================================================================

export class EmbeddingService {
	private readonly model: string;
	private readonly dims: number;

	constructor() {
		this.model = deepinfra.getEmbeddingModel();
		this.dims = deepinfra.getEmbeddingDims();
	}

	/**
	 * Generates and stores an embedding for a song.
	 * Uses the song's analysis text as the embedding content.
	 *
	 * @param songId - The song UUID
	 * @param kind - Type of embedding content (full, theme, mood, context)
	 * @returns The embedding result or error
	 */
	async embedSong(
		songId: string,
		kind: EmbeddingKind = "full",
	): Promise<Result<EmbedSongResult, EmbeddingServiceError>> {
		// 1. Check for cached embedding
		const cachedResult = await vectors.getSongEmbedding(
			songId,
			this.model,
			kind,
		);
		if (Result.isError(cachedResult)) {
			return Result.err(cachedResult.error);
		}
		if (cachedResult.value) {
			return Result.ok({
				songId,
				embedding: cachedResult.value,
				cached: true,
			});
		}

		// 2. Get song analysis
		const analysisResult = await songAnalysis.get(songId);
		if (Result.isError(analysisResult)) {
			return Result.err(analysisResult.error);
		}
		if (!analysisResult.value) {
			return Result.err(new MissingAnalysisError(songId));
		}

		// 3. Build embedding text from analysis
		const text = this.buildEmbeddingText(analysisResult.value, kind);
		const contentHash = await this.hashContent(text);

		// 4. Check if embedding exists for this content hash
		const existingResult = await this.getByContentHash(songId, kind, contentHash);
		if (Result.isError(existingResult)) {
			return Result.err(existingResult.error);
		}
		if (existingResult.value) {
			return Result.ok({
				songId,
				embedding: existingResult.value,
				cached: true,
			});
		}

		// 5. Generate embedding via DeepInfra
		const embedResult = await deepinfra.embedText(text, { prefix: "passage:" });
		if (Result.isError(embedResult)) {
			return Result.err(embedResult.error);
		}

		// 6. Validate dimensions
		if (embedResult.value.dims !== this.dims) {
			return Result.err(
				new DimensionMismatchError(this.dims, embedResult.value.dims),
			);
		}

		// 7. Store embedding
		const storeResult = await vectors.upsertSongEmbedding({
			song_id: songId,
			kind,
			model: this.model,
			model_version: null,
			dims: this.dims,
			content_hash: contentHash,
			embedding: JSON.stringify(embedResult.value.embedding),
		});

		if (Result.isError(storeResult)) {
			return Result.err(storeResult.error);
		}

		return Result.ok({
			songId,
			embedding: storeResult.value,
			cached: false,
		});
	}

	/**
	 * Generates and stores embeddings for multiple songs.
	 * Optimizes by batching DeepInfra calls.
	 *
	 * @param songIds - Song UUIDs to embed
	 * @param kind - Type of embedding content
	 * @returns Batch result with succeeded and failed items
	 */
	async embedBatch(
		songIds: string[],
		kind: EmbeddingKind = "full",
	): Promise<Result<BatchEmbedResult, EmbeddingServiceError>> {
		if (songIds.length === 0) {
			return Result.ok({ succeeded: [], failed: [] });
		}

		// 1. Check for existing embeddings
		const existingResult = await vectors.getSongEmbeddingsBatch(
			songIds,
			this.model,
			kind,
		);
		if (Result.isError(existingResult)) {
			return Result.err(existingResult.error);
		}
		const existingMap = existingResult.value;

		// Separate cached vs needs embedding
		const cached: EmbedSongResult[] = [];
		const needsEmbedding: string[] = [];

		for (const songId of songIds) {
			const existing = existingMap.get(songId);
			if (existing) {
				cached.push({ songId, embedding: existing, cached: true });
			} else {
				needsEmbedding.push(songId);
			}
		}

		if (needsEmbedding.length === 0) {
			return Result.ok({ succeeded: cached, failed: [] });
		}

		// 2. Get analyses for songs needing embedding
		// Note: songAnalysis.get(string[]) returns Map<string, SongAnalysis>
		const analysesResult = await songAnalysis.get(needsEmbedding);
		if (Result.isError(analysesResult)) {
			return Result.err(analysesResult.error);
		}
		const analysisMap = analysesResult.value;

		// Separate songs with/without analysis
		const toEmbed: Array<{ songId: string; text: string; hash: string }> = [];
		const failed: Array<{ songId: string; error: string }> = [];

		for (const songId of needsEmbedding) {
			const songAnalysis = analysisMap.get(songId);
			if (!songAnalysis) {
				failed.push({ songId, error: "Missing analysis" });
				continue;
			}

			const text = this.buildEmbeddingText(songAnalysis, kind);
			const hash = await this.hashContent(text);
			toEmbed.push({ songId, text, hash });
		}

		if (toEmbed.length === 0) {
			return Result.ok({ succeeded: cached, failed });
		}

		// 3. Batch embed via DeepInfra
		const texts = toEmbed.map((item) => item.text);
		const batchResult = await deepinfra.embedBatch(texts, { prefix: "passage:" });

		if (Result.isError(batchResult)) {
			// All failed due to API error
			const errorMsg = batchResult.error instanceof Error
				? batchResult.error.message
				: String(batchResult.error);
			for (const item of toEmbed) {
				failed.push({ songId: item.songId, error: errorMsg });
			}
			return Result.ok({ succeeded: cached, failed });
		}

		// 4. Store embeddings
		const embeddings: vectors.UpsertSongEmbedding[] = [];
		const newEmbeddings: EmbedSongResult[] = [];

		for (let i = 0; i < toEmbed.length; i++) {
			const item = toEmbed[i];
			const result = batchResult.value[i];

			if (result.dims !== this.dims) {
				failed.push({
					songId: item.songId,
					error: `Dimension mismatch: expected ${this.dims}, got ${result.dims}`,
				});
				continue;
			}

			embeddings.push({
				song_id: item.songId,
				kind,
				model: this.model,
				model_version: null,
				dims: this.dims,
				content_hash: item.hash,
				embedding: JSON.stringify(result.embedding),
			});
		}

		if (embeddings.length > 0) {
			const storeResult = await vectors.upsertSongEmbeddings(embeddings);
			if (Result.isError(storeResult)) {
				// Store failed, but we still have cached results
				for (const emb of embeddings) {
					failed.push({ songId: emb.song_id, error: "Failed to store embedding" });
				}
			} else {
				// Add to succeeded
				for (const stored of storeResult.value) {
					newEmbeddings.push({
						songId: stored.song_id,
						embedding: stored,
						cached: false,
					});
				}
			}
		}

		return Result.ok({
			succeeded: [...cached, ...newEmbeddings],
			failed,
		});
	}

	/**
	 * Gets the embedding for a song, returning null if not found.
	 */
	async getEmbedding(
		songId: string,
		kind: EmbeddingKind = "full",
	): Promise<Result<SongEmbedding | null, DbError>> {
		return vectors.getSongEmbedding(songId, this.model, kind);
	}

	/**
	 * Gets embeddings for multiple songs.
	 */
	async getEmbeddings(
		songIds: string[],
		kind: EmbeddingKind = "full",
	): Promise<Result<Map<string, SongEmbedding>, DbError>> {
		return vectors.getSongEmbeddingsBatch(songIds, this.model, kind);
	}

	/**
	 * Gets the configured embedding dimensions.
	 */
	getDimensions(): number {
		return this.dims;
	}

	/**
	 * Gets the configured embedding model.
	 */
	getModel(): string {
		return this.model;
	}

	// ============================================================================
	// Private Helpers
	// ============================================================================

	/**
	 * Builds the text content to embed from a song analysis.
	 */
	private buildEmbeddingText(
		songAnalysis: SongAnalysis,
		_kind: EmbeddingKind,
	): string {
		// analysis field contains the LLM-generated analysis JSON
		const analysisData = songAnalysis.analysis as Record<string, unknown>;
		const analysis = analysisData?.analysis as Record<string, unknown> | undefined;

		if (!analysis) {
			return `Song analysis for track`;
		}

		switch (_kind) {
			case "full":
				return this.buildFullText(analysis);
			case "theme":
				return this.buildThemeText(analysis);
			case "mood":
				return this.buildMoodText(analysis);
			case "context":
				return this.buildContextText(analysis);
			default:
				return this.buildFullText(analysis);
		}
	}

	private buildFullText(analysis: Record<string, unknown>): string {
		const parts: string[] = [];

		// Meaning
		const meaning = analysis.meaning as Record<string, unknown> | undefined;
		if (meaning) {
			const themes = meaning.themes as Array<{ name: string; description?: string }> | undefined;
			if (themes) {
				parts.push(`Themes: ${themes.map((t) => t.name).join(", ")}`);
			}
			const interpretation = meaning.interpretation as Record<string, unknown> | undefined;
			if (interpretation?.surface_meaning) {
				parts.push(`Meaning: ${interpretation.surface_meaning}`);
			}
		}

		// Emotional
		const emotional = analysis.emotional as Record<string, unknown> | undefined;
		if (emotional) {
			if (emotional.dominant_mood) {
				parts.push(`Mood: ${emotional.dominant_mood}`);
			}
			if (emotional.mood_description) {
				parts.push(`${emotional.mood_description}`);
			}
		}

		// Context
		const context = analysis.context as Record<string, unknown> | undefined;
		if (context?.best_moments) {
			const moments = context.best_moments as string[];
			parts.push(`Best for: ${moments.join(", ")}`);
		}

		// Musical style
		const style = analysis.musical_style as Record<string, unknown> | undefined;
		if (style) {
			if (style.genre_primary) {
				parts.push(`Genre: ${style.genre_primary}`);
			}
			if (style.sonic_texture) {
				parts.push(`Sound: ${style.sonic_texture}`);
			}
		}

		return parts.join(". ");
	}

	private buildThemeText(analysis: Record<string, unknown>): string {
		const meaning = analysis.meaning as Record<string, unknown> | undefined;
		if (!meaning) return "";

		const parts: string[] = [];
		const themes = meaning.themes as Array<{ name: string; description?: string }> | undefined;
		if (themes) {
			for (const theme of themes) {
				parts.push(theme.name);
				if (theme.description) {
					parts.push(theme.description);
				}
			}
		}

		const interpretation = meaning.interpretation as Record<string, unknown> | undefined;
		if (interpretation) {
			if (interpretation.surface_meaning) {
				parts.push(String(interpretation.surface_meaning));
			}
			if (interpretation.deeper_meaning) {
				parts.push(String(interpretation.deeper_meaning));
			}
		}

		return parts.join(". ");
	}

	private buildMoodText(analysis: Record<string, unknown>): string {
		const emotional = analysis.emotional as Record<string, unknown> | undefined;
		if (!emotional) return "";

		const parts: string[] = [];
		if (emotional.dominant_mood) {
			parts.push(`Dominant mood: ${emotional.dominant_mood}`);
		}
		if (emotional.mood_description) {
			parts.push(String(emotional.mood_description));
		}

		const journey = emotional.journey as Array<{ section: string; mood: string }> | undefined;
		if (journey) {
			const moods = journey.map((j) => j.mood).join(", ");
			parts.push(`Emotional journey: ${moods}`);
		}

		return parts.join(". ");
	}

	private buildContextText(analysis: Record<string, unknown>): string {
		const context = analysis.context as Record<string, unknown> | undefined;
		if (!context) return "";

		const parts: string[] = [];
		if (context.primary_setting) {
			parts.push(`Setting: ${context.primary_setting}`);
		}

		const situations = context.situations as Record<string, unknown> | undefined;
		if (situations?.perfect_for) {
			const perfectFor = situations.perfect_for as string[];
			parts.push(`Perfect for: ${perfectFor.join(", ")}`);
		}

		const bestMoments = context.best_moments as string[] | undefined;
		if (bestMoments) {
			parts.push(`Best moments: ${bestMoments.join(", ")}`);
		}

		return parts.join(". ");
	}

	/**
	 * Hashes content for cache key.
	 */
	private async hashContent(text: string): Promise<string> {
		const encoder = new TextEncoder();
		const data = encoder.encode(text);
		const hashBuffer = await crypto.subtle.digest("SHA-256", data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
	}

	/**
	 * Gets embedding by content hash to avoid re-embedding identical content.
	 */
	private async getByContentHash(
		songId: string,
		kind: EmbeddingKind,
		contentHash: string,
	): Promise<Result<SongEmbedding | null, DbError>> {
		// Query by all unique fields
		const result = await vectors.getSongEmbedding(songId, this.model, kind);
		if (Result.isError(result)) {
			return result;
		}
		if (result.value && result.value.content_hash === contentHash) {
			return Result.ok(result.value);
		}
		return Result.ok(null);
	}
}
