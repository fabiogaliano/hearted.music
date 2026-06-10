/**
 * Embedding input formatting and Matryoshka truncation.
 *
 * Shared by every ML provider so the on-the-wire format is identical
 * regardless of backend. Lives outside both `providers/` and `deepinfra/`
 * to avoid an import cycle (providers → deepinfra → providers).
 *
 * Instruction-tuned models (Qwen3-Embedding, E5-instruct) require an
 * asymmetric format the non-instruct `query:`/`passage:` convention got wrong:
 *   - queries:   "Instruct: {task}\nQuery: {text}"
 *   - documents: the raw text, with NO prefix
 * Mixing those up (the previous bug) embeds every vector in a format the model
 * was never trained on. See docs/architecture/matching-system-roadmap.md #2/#3.
 */

/** Which side of a retrieval pair the text represents. */
export type EmbeddingRole = "query" | "passage";

export const EMBEDDING_ROLES = ["query", "passage"] as const;

/**
 * Task instruction baked into query-side embeddings. Documents never carry it.
 * Qwen3 degrades ~1–5% without a task instruction, so this is required, not
 * optional. Phrased for our domain: a playlist's intent text is the query,
 * songs are the documents it retrieves.
 */
export const EMBEDDING_TASK_DESCRIPTION =
	"Given a playlist's mood and theme, retrieve songs that fit it";

/**
 * Formats text for embedding per the model's convention.
 *
 * For instruction-tuned models, queries get the `Instruct: …\nQuery: …`
 * wrapper and documents are sent verbatim. Non-instruct models (e.g. the
 * MiniLM fallback) take raw text on both sides.
 */
export function formatEmbeddingInput(
	text: string,
	role: EmbeddingRole,
	instructionTuned: boolean,
): string {
	if (!instructionTuned || role === "passage") {
		return text;
	}
	// No space after "Query:" — matches Qwen3's reference get_detailed_instruct
	// exactly (f'Instruct: {task}\nQuery:{query}'). The tokenizer is BPE, so the
	// space-vs-no-space boundary is what the model was trained on.
	return `Instruct: ${EMBEDDING_TASK_DESCRIPTION}\nQuery:${text}`;
}

/**
 * Matryoshka truncation: take the first `dims` components and L2-renormalize.
 *
 * MRL models (Qwen3-Embedding) are trained so any leading prefix of the full
 * vector is itself a valid embedding once renormalized. Vectors already at or
 * below `dims` are renormalized but not sliced. Done client-side so it is
 * deterministic and independent of whether the provider honors a `dimensions`
 * request parameter.
 */
export function truncateAndNormalize(
	embedding: number[],
	dims: number,
): number[] {
	const sliced = embedding.length > dims ? embedding.slice(0, dims) : embedding;

	let sumSquares = 0;
	for (const value of sliced) {
		sumSquares += value * value;
	}
	const norm = Math.sqrt(sumSquares);
	if (norm === 0) {
		return sliced;
	}
	return sliced.map((value) => value / norm);
}
