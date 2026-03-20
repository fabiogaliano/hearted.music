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
import type { SongAnalysis } from "@/lib/domains/enrichment/content-analysis/queries";
import * as songAnalysis from "@/lib/domains/enrichment/content-analysis/queries";
import type { SongEmbedding } from "@/lib/domains/enrichment/embeddings/queries";
import * as vectors from "@/lib/domains/enrichment/embeddings/queries";
import { getMlProvider } from "@/lib/integrations/providers/factory";
import type { DbError } from "@/lib/shared/errors/database";
import {
	DimensionMismatchError,
	MissingAnalysisError,
} from "@/lib/shared/errors/domain/embedding";
import type { MLProviderError } from "@/lib/shared/errors/domain/ml";
import { getModelBundleHash } from "./versioning";

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
	| MLProviderError
	| MissingAnalysisError
	| DimensionMismatchError;

export class EmbeddingService {
	private readonly model: string;
	private readonly dims: number;

	constructor() {
		// Get ML provider and extract metadata
		const providerResult = getMlProvider();
		if (Result.isError(providerResult)) {
			throw providerResult.error;
		}
		const metadata = providerResult.value.getMetadata();
		this.model = metadata.embeddingModel;
		this.dims = metadata.embeddingDims;
	}

	/**
	 * Generates and stores an embedding for a song.
	 * Uses the song's analysis text as the embedding content.
	 *
	 * @param songId - The song UUID
	 * @returns The embedding result or error
	 */
	async embedSong(
		songId: string,
	): Promise<Result<EmbedSongResult, EmbeddingServiceError>> {
		// 1. Check for cached embedding
		const cachedResult = await vectors.getSongEmbedding(
			songId,
			this.model,
			"full",
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
		const text = this.buildEmbeddingText(analysisResult.value);
		const contentHash = await this.hashContent(text);

		// 4. Check if embedding exists for this content hash
		const existingResult = await this.getByContentHash(songId, contentHash);
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

		// 5. Generate embedding via ML provider
		const providerResult = getMlProvider();
		if (Result.isError(providerResult)) {
			return Result.err(providerResult.error);
		}
		const embedResult = await providerResult.value.embed(text, {
			prefix: "passage:",
		});
		if (Result.isError(embedResult)) {
			return Result.err(embedResult.error);
		}

		// 6. Validate dimensions
		if (embedResult.value.dims !== this.dims) {
			return Result.err(
				new DimensionMismatchError(this.dims, embedResult.value.dims),
			);
		}

		// 7. Store embedding with model bundle hash for cache invalidation
		const modelBundleHashResult = await getModelBundleHash();
		if (Result.isError(modelBundleHashResult)) {
			return Result.err(modelBundleHashResult.error);
		}

		const storeResult = await vectors.upsertSongEmbedding({
			song_id: songId,
			kind: "full",
			model: this.model,
			model_version: modelBundleHashResult.value,
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
	 * @returns Batch result with succeeded and failed items
	 */
	async embedBatch(
		songIds: string[],
	): Promise<Result<BatchEmbedResult, EmbeddingServiceError>> {
		if (songIds.length === 0) {
			return Result.ok({ succeeded: [], failed: [] });
		}

		// 1. Check for existing embeddings
		const existingResult = await vectors.getSongEmbeddingsBatch(
			songIds,
			this.model,
			"full",
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

			const text = this.buildEmbeddingText(songAnalysis);
			const hash = await this.hashContent(text);
			toEmbed.push({ songId, text, hash });
		}

		if (toEmbed.length === 0) {
			return Result.ok({ succeeded: cached, failed });
		}

		// 3. Batch embed via ML provider
		const providerResult = getMlProvider();
		if (Result.isError(providerResult)) {
			// Provider unavailable - all failed
			const errorMsg =
				providerResult.error instanceof Error
					? providerResult.error.message
					: String(providerResult.error);
			for (const item of toEmbed) {
				failed.push({ songId: item.songId, error: errorMsg });
			}
			return Result.ok({ succeeded: cached, failed });
		}

		const texts = toEmbed.map((item) => item.text);
		const batchResult = await providerResult.value.embedBatch(texts, {
			prefix: "passage:",
		});

		if (Result.isError(batchResult)) {
			// All failed due to API error
			const errorMsg =
				batchResult.error instanceof Error
					? batchResult.error.message
					: String(batchResult.error);
			for (const item of toEmbed) {
				failed.push({ songId: item.songId, error: errorMsg });
			}
			return Result.ok({ succeeded: cached, failed });
		}

		// 4. Store embeddings with model bundle hash for cache invalidation
		const modelBundleHashResult = await getModelBundleHash();
		if (Result.isError(modelBundleHashResult)) {
			// Model bundle unavailable - all embeddings failed
			const errorMsg =
				modelBundleHashResult.error instanceof Error
					? modelBundleHashResult.error.message
					: String(modelBundleHashResult.error);
			for (const item of toEmbed) {
				failed.push({ songId: item.songId, error: errorMsg });
			}
			return Result.ok({ succeeded: cached, failed });
		}

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
				kind: "full",
				model: this.model,
				model_version: modelBundleHashResult.value,
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
					failed.push({
						songId: emb.song_id,
						error: "Failed to store embedding",
					});
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
	 * Embeds arbitrary text without storing to database.
	 * Used for semantic similarity matching and query embedding.
	 *
	 * @param text - Text to embed
	 * @param options - Optional prefix (default: "query:" for instruction-tuned models)
	 * @returns Result with embedding array or error
	 */
	async embedText(
		text: string,
		options?: { prefix?: "query:" | "passage:" },
	): Promise<Result<number[], MLProviderError | DimensionMismatchError>> {
		const prefix = options?.prefix ?? "query:";

		// Get ML provider
		const providerResult = getMlProvider();
		if (Result.isError(providerResult)) {
			return Result.err(providerResult.error);
		}

		// Generate embedding
		const embedResult = await providerResult.value.embed(text, { prefix });
		if (Result.isError(embedResult)) {
			return Result.err(embedResult.error);
		}

		// Validate dimensions
		if (embedResult.value.dims !== this.dims) {
			return Result.err(
				new DimensionMismatchError(this.dims, embedResult.value.dims),
			);
		}

		return Result.ok(embedResult.value.embedding);
	}

	/**
	 * Embeds arbitrary text and stores as a song_embedding.
	 * Canonical path for text-originated song embeddings (e.g. lyrics).
	 * Uses content hash for caching — won't re-embed identical text.
	 */
	async embedAndStoreText(
		songId: string,
		text: string,
		options?: { prefix?: "query:" | "passage:" },
	): Promise<Result<EmbedSongResult, EmbeddingServiceError>> {
		const prefix = options?.prefix ?? "passage:";
		const contentHash = await this.hashContent(text);

		// Check cache by content hash
		const existingResult = await this.getByContentHash(songId, contentHash);
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

		// Generate embedding
		const providerResult = getMlProvider();
		if (Result.isError(providerResult)) {
			return Result.err(providerResult.error);
		}
		const embedResult = await providerResult.value.embed(text, { prefix });
		if (Result.isError(embedResult)) {
			return Result.err(embedResult.error);
		}
		if (embedResult.value.dims !== this.dims) {
			return Result.err(
				new DimensionMismatchError(this.dims, embedResult.value.dims),
			);
		}

		// Store with model bundle hash
		const modelBundleHashResult = await getModelBundleHash();
		if (Result.isError(modelBundleHashResult)) {
			return Result.err(modelBundleHashResult.error);
		}

		const storeResult = await vectors.upsertSongEmbedding({
			song_id: songId,
			kind: "full",
			model: this.model,
			model_version: modelBundleHashResult.value,
			dims: this.dims,
			content_hash: contentHash,
			embedding: JSON.stringify(embedResult.value.embedding),
		});

		if (Result.isError(storeResult)) {
			return Result.err(storeResult.error);
		}

		return Result.ok({ songId, embedding: storeResult.value, cached: false });
	}

	/**
	 * Gets the embedding for a song, returning null if not found.
	 */
	async getEmbedding(
		songId: string,
	): Promise<Result<SongEmbedding | null, DbError>> {
		return vectors.getSongEmbedding(songId, this.model, "full");
	}

	/**
	 * Gets embeddings for multiple songs.
	 */
	async getEmbeddings(
		songIds: string[],
	): Promise<Result<Map<string, SongEmbedding>, DbError>> {
		return vectors.getSongEmbeddingsBatch(songIds, this.model, "full");
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

	/**
	 * Builds embedding text from a song analysis.
	 * Composes from flat schema fields for rich semantic representation.
	 */
	private buildEmbeddingText(analysis: SongAnalysis): string {
		const data = analysis.analysis as Record<string, unknown>;
		if (!data) return "Song analysis for track";

		const parts: string[] = [];

		if (data.headline) parts.push(String(data.headline));
		if (data.compound_mood) parts.push(String(data.compound_mood));
		if (data.mood_description) parts.push(String(data.mood_description));

		if (data.interpretation) parts.push(String(data.interpretation));

		const themes = data.themes as
			| Array<{ name: string; description: string }>
			| undefined;
		if (themes) {
			for (const theme of themes) {
				parts.push(theme.name);
				if (theme.description) parts.push(theme.description);
			}
		}

		const journey = data.journey as
			| Array<{ section: string; mood: string; description: string }>
			| undefined;
		if (journey) {
			parts.push(journey.map((j) => j.mood).join(", "));
		}

		if (data.sonic_texture) parts.push(String(data.sonic_texture));

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
	 *
	 * Uses getSongEmbedding which returns the latest embedding by created_at.
	 * If the latest embedding's content_hash matches, we can reuse it.
	 * This correctly handles model version changes - if the model changed but
	 * content is identical, we still need to re-embed with the new model.
	 */
	private async getByContentHash(
		songId: string,
		contentHash: string,
	): Promise<Result<SongEmbedding | null, DbError>> {
		const result = await vectors.getSongEmbedding(songId, this.model, "full");
		if (Result.isError(result)) {
			return result;
		}
		// Check if latest embedding has matching content_hash
		if (result.value && result.value.content_hash === contentHash) {
			return Result.ok(result.value);
		}
		return Result.ok(null);
	}
}
