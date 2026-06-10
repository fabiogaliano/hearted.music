/**
 * Shared pure function for flattening SongAnalysis JSON into prose.
 *
 * Used by both EmbeddingService (embedding generation) and the reranker
 * document builder so retrieval and reranking see identical text.
 * Behavior must stay identical to EmbeddingService.buildEmbeddingText —
 * any change here churns existing embeddings.
 */

import type { SongAnalysis } from "@/lib/domains/enrichment/content-analysis/queries";

/**
 * Flatten a SongAnalysis row into prose suitable for embedding or reranking.
 *
 * Handles both the v17 lyrical schema (image/lens/tension/take/contradiction/arc/lines/texture)
 * and the older instrumental/pre-v17 lyrical shape (headline/compound_mood/etc).
 * Reading both sets is safe — only keys actually present contribute.
 */
export function flattenAnalysisText(analysis: SongAnalysis): string {
	const data = analysis.analysis as Record<string, unknown>;
	if (!data) return "Song analysis for track";

	const parts: string[] = [];
	const push = (value: unknown) => {
		if (typeof value === "string" && value.trim().length > 0) {
			parts.push(value.trim());
		}
	};

	// v17 SongRead (lyrical): the active schema. None of these fields exist on
	// the older/instrumental shapes, so reading both sets is safe — only the
	// keys actually present contribute.
	push(data.image);
	push(data.lens);
	push(data.tension);
	push(data.take);
	push(data.contradiction);

	const arc = data.arc as
		| Array<{ label?: string; mood?: string; scene?: string }>
		| undefined;
	if (Array.isArray(arc)) {
		for (const beat of arc) {
			push(beat?.mood);
			push(beat?.scene);
		}
	}

	const lines = data.lines as Array<{ line?: string }> | undefined;
	if (Array.isArray(lines)) {
		for (const line of lines) {
			push(line?.line);
		}
	}

	push(data.texture);

	// Instrumental schema + legacy pre-v17 lyrical rows. These keep producing the
	// same text as before (the v17 keys above are absent), so existing embeddings
	// don't churn.
	push(data.headline);
	push(data.compound_mood);
	push(data.mood_description);
	push(data.interpretation);

	const themes = data.themes as
		| Array<{ name?: string; description?: string }>
		| undefined;
	if (Array.isArray(themes)) {
		for (const theme of themes) {
			push(theme?.name);
			push(theme?.description);
		}
	}

	const journey = data.journey as
		| Array<{ section?: string; mood?: string; description?: string }>
		| undefined;
	if (Array.isArray(journey)) {
		const moods = journey
			.map((j) => j?.mood)
			.filter((m): m is string => typeof m === "string" && m.length > 0)
			.join(", ");
		if (moods.length > 0) parts.push(moods);
	}

	push(data.sonic_texture);

	// Never return empty text. Readiness for embedding is decided purely on
	// whether an embedding row exists (getReadyForSongEmbedding), so a song that
	// produces no text would yield no row and be re-selected every batch forever —
	// a poison pill that busy-loops the enrichment reconciler. A non-empty
	// fallback guarantees a row is always written.
	if (parts.length === 0) return "Song analysis for track";

	return parts.join(". ");
}
