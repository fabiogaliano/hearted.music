/**
 * Distillation prompt: compress an essay-length Genius annotation down to only the
 * facts that could ground an interpretation of the line it describes. The output is
 * fed to the analysis model as trusted context, and the grounding judge later checks
 * the analysis against the RAW annotation — so the one rule that matters here is
 * strict faithfulness: never add a fact the annotation does not contain.
 */
export function distillAnnotationPrompt(
	rawAnnotation: string,
	lyricLine: string,
): string {
	return `You compress a Genius lyric annotation down to only the facts that could ground an interpretation of the specific lyric line it describes. Another model reads your output as trustworthy context, so you must be strictly faithful.

LYRIC LINE:
${lyricLine}

ANNOTATION (community or editorial prose — may ramble, hype, or digress):
${rawAnnotation}

Write 1-3 plain sentences capturing ONLY what the annotation actually says about what this line means: references, wordplay or double meanings, who or what it is about, and the factual context that explains the line.

Drop everything that is not grounding: reception ("fans loved it", "became a hit"), chart, sales, or award claims, production trivia, and biography that does not directly explain the line.

Rules:
- Never add a fact, name, or claim that is not present in the annotation. If unsure, leave it out.
- No preamble, no "this line", no surrounding quotes. Output only the compressed facts.
- If the annotation is pure hype with no grounding content, output one brief sentence stating plainly what the line is about. Never output nothing.`;
}
