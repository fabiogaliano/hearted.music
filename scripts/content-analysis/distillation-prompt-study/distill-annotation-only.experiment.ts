#!/usr/bin/env bun
/// <reference types="bun" />

// EXPERIMENT (not the gate, not production). Question: if the distiller saw ONLY the annotation
// — no lyric line — would the lyric-anchoring false-positives in check-distillation's first run
// go away? It re-distills the golds annotation-only, IN MEMORY (direct Vertex call, no cache
// read/write, so the real annotation_distillation cache is untouched), then judges each pair
// with the SAME annotation-only judge as the gate. Compare the flag count against
// check-distillation-results.md (the with-line run: 8 golds flagged, 6 of them lyric-anchored).
//
//   bun scripts/content-analysis/distill-annotation-only.experiment.ts [song-key...]

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Result } from "better-result";
import { z } from "zod";
import { normalizeAnnotationText } from "@/lib/domains/enrichment/lyrics/utils/lyrics-formatter";
import { createLlmService } from "@/lib/integrations/llm/service";
import { loadLyricsDoc } from "../../voice-audit/lyrics-context";
import { runClaude } from "../../voice-audit/tier2/claude-cli";

const LYRICS_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"voice-audit",
	"exemplars",
	"lyrics",
);
const NEGATIVE_SOURCE_KEYS = ["as-it-was", "blinding-lights"] as const;
const FABRICATED_CHART_FACT =
	"It spent nineteen consecutive weeks at number one in Norway.";
const FABRICATED_BIO_FACT =
	"The songwriter has said this verse was written entirely in a Reykjavík hotel in 2009.";

// Same intent as prompts/distill.ts, but with the lyric line and every "what this line means"
// reference stripped — the annotation is the only thing the model sees.
function annotationOnlyDistillPrompt(rawAnnotation: string): string {
	return `You compress a Genius lyric annotation down to only the grounding facts it contains. Another model reads your output as trustworthy context, so you must be strictly faithful.

ANNOTATION (community or editorial prose — may ramble, hype, or digress):
${rawAnnotation}

Write 1-3 plain sentences capturing ONLY what the annotation actually says: references, wordplay or double meanings, who or what it is about, and the factual context it provides.

Drop everything that is not grounding: reception ("fans loved it", "became a hit"), chart, sales, or award claims, production trivia, and biography that does not explain the meaning.

Rules:
- Never add a fact, name, or claim that is not present in the annotation. If unsure, leave it out.
- No preamble, no surrounding quotes. Output only the compressed facts.
- If the annotation is pure hype with no grounding content, output one brief sentence summarizing it plainly. Never output nothing.`;
}

const JudgeSchema = z.object({
	faithful: z.boolean(),
	unsupported_claims: z.array(z.string()),
});
type Judge = z.infer<typeof JudgeSchema>;

interface Pair {
	label: string;
	raw: string;
	distilled: string;
	expectFaithful: boolean;
}

const DISTILLER = createLlmService("google-vertex", "gemini-2.5-flash-lite");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function listGoldKeys(): string[] {
	return readdirSync(LYRICS_DIR)
		.filter((f) => f.endsWith(".json"))
		.map((f) => f.replace(/\.json$/, ""))
		.sort();
}

interface RawAnnotation {
	key: string;
	raw: string;
}

function collectAnnotations(key: string): RawAnnotation[] {
	const doc = loadLyricsDoc(key);
	const seen = new Set<string>();
	const out: RawAnnotation[] = [];
	for (const section of doc.sections) {
		for (const line of section.lines) {
			for (const ann of line.annotations ?? []) {
				const norm = normalizeAnnotationText(ann.text);
				if (norm.length === 0 || seen.has(norm)) continue;
				seen.add(norm);
				out.push({ key, raw: ann.text });
			}
		}
	}
	return out;
}

async function distill(raw: string): Promise<string | null> {
	const generated = await DISTILLER.generateText(annotationOnlyDistillPrompt(raw), {
		functionId: "annotation-distill-exp",
		maxOutputTokens: 256,
	});
	if (Result.isError(generated)) return null;
	const text = generated.value.text.trim();
	return text.length === 0 ? null : text;
}

function judgePrompt(raw: string, distilled: string): string {
	return [
		"You are a strict fact-checker. You are given a RAW source annotation about a song",
		"lyric and a DISTILLED summary an automated system generated from it. Your only job is",
		"to detect invented facts.",
		"",
		"Decide whether EVERY factual claim in the DISTILLED text is supported by the RAW",
		"annotation. A claim is supported if it is stated in the RAW text or follows directly",
		"from it. Paraphrase, compression, and generalization that stay true to RAW are",
		"supported. Do NOT penalize the distilled text for leaving things out, for being short,",
		"or for style — flag ONLY claims that assert something RAW does not support.",
		"",
		"RAW ANNOTATION:",
		'"""',
		raw,
		'"""',
		"",
		"DISTILLED TEXT:",
		'"""',
		distilled,
		'"""',
		"",
		"Respond with ONLY a JSON object, no markdown fences and no commentary, in exactly this",
		'shape: {"faithful": boolean, "unsupported_claims": string[]}',
		"- faithful is true only if every claim in DISTILLED is supported by RAW.",
		"- If faithful is false, unsupported_claims must list each unsupported distilled claim.",
		"- If faithful is true, unsupported_claims must be [].",
	].join("\n");
}

function parseJudge(text: string): Judge {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end === -1 || end < start) {
		throw new Error(`no JSON object in judge output: ${text.slice(0, 200)}`);
	}
	const judge = JudgeSchema.parse(JSON.parse(text.slice(start, end + 1)));
	if (!judge.faithful && judge.unsupported_claims.length === 0) {
		throw new Error("judge returned faithful=false with no unsupported_claims");
	}
	return judge;
}

function isTransient(message: string): boolean {
	return /\b529\b|overloaded|timed out|ETIMEDOUT|ECONNRESET/i.test(message);
}

async function runJudge(prompt: string): Promise<{ text: string; costUsd?: number }> {
	const attempts = 8;
	let lastError: unknown;
	for (let i = 0; i < attempts; i++) {
		try {
			return await runClaude(prompt, { model: "opus", timeoutMs: 300_000 });
		} catch (error) {
			lastError = error;
			const message = error instanceof Error ? error.message : String(error);
			if (i === attempts - 1 || !isTransient(message)) throw error;
			await sleep(Math.min(15_000 * (i + 1), 60_000));
		}
	}
	throw lastError;
}

interface Outcome {
	label: string;
	correct: boolean;
	costUsd: number;
}

async function judgePair(pair: Pair): Promise<Outcome> {
	try {
		const { text, costUsd } = await runJudge(judgePrompt(pair.raw, pair.distilled));
		const judge = parseJudge(text);
		const correct = judge.faithful === pair.expectFaithful;
		const mark = correct ? "ok" : "WRONG";
		const verdict = judge.faithful ? "faithful" : "FLAGGED";
		const ev = judge.unsupported_claims.slice(0, 3).join(" | ");
		console.log(`  [${mark}] ${pair.label}: ${verdict}${ev ? ` (${ev})` : ""}`);
		return { label: pair.label, correct, costUsd: costUsd ?? 0 };
	} catch (error) {
		console.error(
			`  [ERR ] ${pair.label}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return { label: pair.label, correct: false, costUsd: 0 };
	}
}

async function runPool<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const i = next++;
			results[i] = await fn(items[i]);
		}
	});
	await Promise.all(workers);
	return results;
}

async function main() {
	const all = listGoldKeys();
	const filter = new Set(process.argv.slice(2));
	const keys = filter.size === 0 ? all : all.filter((k) => filter.has(k));
	if (keys.length === 0) {
		console.error(`No matching gold keys. Available: ${all.join(", ")}`);
		process.exit(2);
	}

	const annotations = keys.flatMap(collectAnnotations);
	const negSources = NEGATIVE_SOURCE_KEYS.flatMap(collectAnnotations);
	const allToDistill = [...annotations, ...negSources];
	console.log(`Distilling ${allToDistill.length} annotations annotation-only (in memory)...`);
	const distilled = await runPool(allToDistill, 6, async (a) => ({
		...a,
		distilled: await distill(a.raw),
	}));

	const positives: Pair[] = [];
	let skipped = 0;
	for (let i = 0; i < annotations.length; i++) {
		const d = distilled[i];
		if (!d.distilled) {
			skipped++;
			continue;
		}
		positives.push({
			label: `gold:${d.key}`,
			raw: d.raw,
			distilled: d.distilled,
			expectFaithful: true,
		});
	}

	const negatives: Pair[] = [];
	const splices = [
		(d: string) => `${d} ${FABRICATED_CHART_FACT}`,
		(d: string) => `${FABRICATED_BIO_FACT} ${d}`,
	];
	for (let i = 0; i < NEGATIVE_SOURCE_KEYS.length; i++) {
		const key = NEGATIVE_SOURCE_KEYS[i];
		const src = distilled.find((d) => d.key === key && d.distilled);
		if (!src?.distilled) continue;
		negatives.push({
			label: `negative:${i === 0 ? "append-chart" : "swap-bio"}:${key}`,
			raw: src.raw,
			distilled: splices[i](src.distilled),
			expectFaithful: false,
		});
	}

	const cases = [...positives, ...negatives];
	console.log(
		`Judging ${positives.length} gold pairs + ${negatives.length} negatives` +
			(skipped ? ` (${skipped} annotations had no distillation, skipped)` : ""),
	);

	const outcomes = await runPool(cases, 2, judgePair);
	const failures = outcomes.filter((o) => !o.correct);
	const costUsd = outcomes.reduce((sum, o) => sum + o.costUsd, 0);

	if (failures.length) {
		console.log("\nUnexpected results:");
		for (const f of failures) console.log(`  - ${f.label}`);
	}
	console.log(
		`\n${cases.length - failures.length}/${cases.length} as expected. Opus cost ~$${costUsd.toFixed(2)}.`,
	);
	process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
