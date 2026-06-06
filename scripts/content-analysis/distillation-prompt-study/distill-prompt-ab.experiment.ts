#!/usr/bin/env bun
/// <reference types="bun" />

// FINAL pre-ship experiment for the distiller prompt change. NOT production, NOT the gate.
//
// Decides whether to change prompts/distill.ts and re-distill the catalog. Tests 3 variants of
// the distiller prompt head-to-head on the SAME gold annotations, in memory (no cache touched):
//
//   V0  current production prompt (line shown, no guardrail)            <- baseline
//   V1  annotation-only (no lyric line at all)
//   V2  line kept but labeled "context, not a fact source" + guardrail  <- proposed fix
//
// One Opus judge call per annotation scores all three at once (neutral labels S1/S2/S3, order
// rotated per item to cancel position bias), reporting per variant:
//   - leak_claims     facts taken from the lyric LINE but not in the annotation  (the defect)
//   - invented_claims facts in neither line nor annotation                       (genuine slips)
//   - grounding_score 0/1/2 how well it preserves the annotation's grounding facts
// Plus coverage (non-empty distillations) per variant, and 2 sanity checks that the judge still
// catches a spliced-in invented fact.
//
// Pre-registered decision rule prints SHIP V2 / SHIP V1 / DON'T SHIP. Distillation runs at low
// concurrency so coverage gaps are real signal, not a Vertex burst-quota artifact.
//
//   bun scripts/content-analysis/distill-prompt-ab.experiment.ts [song-key...]

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Result } from "better-result";
import { z } from "zod";
import { normalizeAnnotationText } from "@/lib/domains/enrichment/lyrics/utils/lyrics-formatter";
import { distillAnnotationPrompt } from "@/lib/domains/enrichment/content-analysis/prompts/distill";
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

const VARIANTS = ["V0", "V1", "V2"] as const;
type VariantKey = (typeof VARIANTS)[number];

// V1: annotation only, no line.
function v1Prompt(raw: string): string {
	return `You compress a Genius lyric annotation down to only the grounding facts it contains. Another model reads your output as trustworthy context, so you must be strictly faithful.

ANNOTATION (community or editorial prose — may ramble, hype, or digress):
${raw}

Write 1-3 plain sentences capturing ONLY what the annotation actually says: references, wordplay or double meanings, who or what it is about, and the factual context it provides.

Drop everything that is not grounding: reception ("fans loved it", "became a hit"), chart, sales, or award claims, production trivia, and biography that does not explain the meaning.

Rules:
- Never add a fact, name, or claim that is not present in the annotation. If unsure, leave it out.
- No preamble, no surrounding quotes. Output only the compressed facts.
- If the annotation is pure hype with no grounding content, output one brief sentence summarizing it plainly. Never output nothing.`;
}

// V2: prod prompt + line is explicitly context-only + guardrail against lyric-sourced facts.
function v2Prompt(raw: string, line: string): string {
	return `You compress a Genius lyric annotation down to only the facts that could ground an interpretation of the specific lyric line it describes. Another model reads your output as trustworthy context, so you must be strictly faithful.

LYRIC LINE (shown only so you know which line this annotation explains — it is NOT a source of facts):
${line}

ANNOTATION (community or editorial prose — may ramble, hype, or digress):
${raw}

Write 1-3 plain sentences capturing ONLY what the annotation actually says about what this line means: references, wordplay or double meanings, who or what it is about, and the factual context that explains the line.

Drop everything that is not grounding: reception ("fans loved it", "became a hit"), chart, sales, or award claims, production trivia, and biography that does not directly explain the line.

Rules:
- Never add a fact, name, or claim that is not present in the annotation. If unsure, leave it out.
- The lyric line above is context only. Never state a fact that comes from the lyric line rather than the annotation; if a detail appears only in the line and not in the annotation, leave it out.
- No preamble, no "this line", no surrounding quotes. Output only the compressed facts.
- If the annotation is pure hype with no grounding content, output one brief sentence stating plainly what the annotation conveys. Never output nothing.`;
}

function variantPrompt(v: VariantKey, raw: string, line: string): string {
	if (v === "V0") return distillAnnotationPrompt(raw);
	if (v === "V1") return v1Prompt(raw);
	return v2Prompt(raw, line);
}

const DISTILLER = createLlmService("google-vertex", "gemini-2.5-flash-lite");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function listGoldKeys(): string[] {
	return readdirSync(LYRICS_DIR)
		.filter((f) => f.endsWith(".json"))
		.map((f) => f.replace(/\.json$/, ""))
		.sort();
}

interface Annotation {
	key: string;
	raw: string;
	line: string;
}

function collectAnnotations(key: string): Annotation[] {
	const doc = loadLyricsDoc(key);
	const seen = new Set<string>();
	const out: Annotation[] = [];
	for (const section of doc.sections) {
		for (const line of section.lines) {
			for (const ann of line.annotations ?? []) {
				const norm = normalizeAnnotationText(ann.text);
				if (norm.length === 0 || seen.has(norm)) continue;
				seen.add(norm);
				out.push({ key, raw: ann.text, line: line.text });
			}
		}
	}
	return out;
}

let distillErrorSamples = 0;
// The catalog-batch failure rate is high (the prod path also lost ~40% under concurrency), so
// retry transient distiller errors with backoff. Distinguish a hard empty (model returned
// nothing) from a persistent error so coverage gaps are interpretable, not silent.
async function distill(prompt: string): Promise<string | null> {
	for (let attempt = 0; attempt < 5; attempt++) {
		const generated = await DISTILLER.generateText(prompt, {
			functionId: "annotation-distill-ab",
			maxOutputTokens: 256,
		});
		if (Result.isOk(generated)) {
			const text = generated.value.text.trim();
			return text.length === 0 ? null : text;
		}
		if (distillErrorSamples < 3) {
			distillErrorSamples++;
			console.error(`  [distill-err] ${generated.error.message?.slice(0, 160)}`);
		}
		await sleep(Math.min(5_000 * (attempt + 1), 30_000));
	}
	return null;
}

const SummarySchema = z.object({
	leak_claims: z.array(z.string()),
	invented_claims: z.array(z.string()),
	grounding_score: z.number().int().min(0).max(2),
	missing_grounding: z.array(z.string()),
});
const JudgeSchema = z.object({
	S1: SummarySchema,
	S2: SummarySchema,
	S3: SummarySchema,
});
type Summary = z.infer<typeof SummarySchema>;

function judgePrompt(raw: string, line: string, s1: string, s2: string, s3: string): string {
	return `You are auditing three automated summaries of a Genius lyric annotation. You are given the RAW annotation, the LYRIC LINE it describes, and three summaries S1, S2, S3.

A "grounding fact" is a fact stated in the RAW annotation that helps explain the line (references, wordplay, who/what it is about, factual context). Pure restatement of the LYRIC LINE is NOT a grounding fact.

For EACH summary, report:
- leak_claims: claims that come from the LYRIC LINE but are NOT in the RAW annotation.
- invented_claims: claims present in NEITHER the lyric line NOR the RAW annotation (fabricated or distorted facts, including dropped hedges stated as fact, reversed/misattributed facts, wrong names).
- grounding_score: 2 = preserves all key grounding facts of the annotation; 1 = preserves most, misses only minor detail; 0 = misses a major grounding fact or distorts one.
- missing_grounding: key grounding facts from the annotation that the summary omits.

Judge each summary ONLY against the RAW annotation and LYRIC LINE — not against the other summaries.

RAW ANNOTATION:
"""${raw}"""

LYRIC LINE:
"""${line}"""

SUMMARY S1:
"""${s1}"""

SUMMARY S2:
"""${s2}"""

SUMMARY S3:
"""${s3}"""

Respond with ONLY a JSON object, no markdown fences, exactly:
{"S1":{"leak_claims":[],"invented_claims":[],"grounding_score":0,"missing_grounding":[]},"S2":{...},"S3":{...}}`;
}

function parseJudge(text: string): z.infer<typeof JudgeSchema> {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end === -1 || end < start) {
		throw new Error(`no JSON object in judge output: ${text.slice(0, 200)}`);
	}
	return JudgeSchema.parse(JSON.parse(text.slice(start, end + 1)));
}

function isTransient(message: string): boolean {
	return /\b529\b|overloaded|timed out|ETIMEDOUT|ECONNRESET/i.test(message);
}

async function runJudge(prompt: string): Promise<string> {
	const attempts = 8;
	let lastError: unknown;
	for (let i = 0; i < attempts; i++) {
		try {
			const { text } = await runClaude(prompt, { model: "opus", timeoutMs: 300_000 });
			return text;
		} catch (error) {
			lastError = error;
			const message = error instanceof Error ? error.message : String(error);
			if (i === attempts - 1 || !isTransient(message)) throw error;
			await sleep(Math.min(15_000 * (i + 1), 60_000));
		}
	}
	throw lastError;
}

async function runPool<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const i = next++;
			results[i] = await fn(items[i], i);
		}
	});
	await Promise.all(workers);
	return results;
}

// Six orderings so each variant lands in each slot equally often across the set.
const PERMS: VariantKey[][] = [
	["V0", "V1", "V2"],
	["V1", "V2", "V0"],
	["V2", "V0", "V1"],
	["V0", "V2", "V1"],
	["V2", "V1", "V0"],
	["V1", "V0", "V2"],
];

interface Tally {
	judged: number;
	leak: number;
	invented: number;
	scoreSum: number;
	score0: number;
	missingExamples: string[];
}
function emptyTally(): Tally {
	return { judged: 0, leak: 0, invented: 0, scoreSum: 0, score0: 0, missingExamples: [] };
}
function record(t: Tally, s: Summary, label: string) {
	t.judged++;
	if (s.leak_claims.length) t.leak++;
	if (s.invented_claims.length) t.invented++;
	t.scoreSum += s.grounding_score;
	if (s.grounding_score === 0) {
		t.score0++;
		if (s.missing_grounding[0] && t.missingExamples.length < 4) {
			t.missingExamples.push(`${label}: ${s.missing_grounding[0]}`);
		}
	}
}

async function sanityJudgeCatchesInvention(distilledByKey: Map<string, Annotation & { V2: string }>): Promise<boolean> {
	const sample = [...distilledByKey.values()].slice(0, 2);
	if (sample.length < 2) return true;
	const fabricated = [
		"It spent nineteen consecutive weeks at number one in Norway.",
		"The songwriter wrote this entirely in a Reykjavík hotel in 2009.",
	];
	let ok = true;
	for (let i = 0; i < sample.length; i++) {
		const a = sample[i];
		const poisoned = `${a.V2} ${fabricated[i]}`;
		const text = await runJudge(judgePrompt(a.raw, a.line, poisoned, a.V2, a.V2));
		try {
			const j = parseJudge(text);
			if (j.S1.invented_claims.length === 0) ok = false;
		} catch {
			ok = false;
		}
	}
	return ok;
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
	console.log(`Distilling ${annotations.length} annotations × 3 variants (in memory, low concurrency)...`);

	const tasks = annotations.flatMap((a, idx) =>
		VARIANTS.map((v) => ({ idx, v, prompt: variantPrompt(v, a.raw, a.line) })),
	);
	const distilledFlat = await runPool(tasks, 2, async (t) => ({
		idx: t.idx,
		v: t.v,
		text: await distill(t.prompt),
	}));

	const distilled: Record<VariantKey, (string | null)[]> = {
		V0: new Array(annotations.length).fill(null),
		V1: new Array(annotations.length).fill(null),
		V2: new Array(annotations.length).fill(null),
	};
	for (const d of distilledFlat) distilled[d.v][d.idx] = d.text;

	const coverage: Record<VariantKey, number> = { V0: 0, V1: 0, V2: 0 };
	for (const v of VARIANTS) coverage[v] = distilled[v].filter(Boolean).length;

	// Judge only annotations where all three produced output — fair grounding comparison set.
	const judgeIdx = annotations
		.map((_, i) => i)
		.filter((i) => distilled.V0[i] && distilled.V1[i] && distilled.V2[i]);
	console.log(
		`Coverage (non-empty): V0=${coverage.V0} V1=${coverage.V1} V2=${coverage.V2} of ${annotations.length}. ` +
			`Judging ${judgeIdx.length} annotations (all 3 present) on Opus...`,
	);

	const tallies: Record<VariantKey, Tally> = { V0: emptyTally(), V1: emptyTally(), V2: emptyTally() };
	let judgeErrors = 0;

	await runPool(judgeIdx, 2, async (i, n) => {
		const a = annotations[i];
		const order = PERMS[n % PERMS.length];
		const slot = {
			S1: distilled[order[0]][i] as string,
			S2: distilled[order[1]][i] as string,
			S3: distilled[order[2]][i] as string,
		};
		try {
			const text = await runJudge(judgePrompt(a.raw, a.line, slot.S1, slot.S2, slot.S3));
			const j = parseJudge(text);
			record(tallies[order[0]], j.S1, a.key);
			record(tallies[order[1]], j.S2, a.key);
			record(tallies[order[2]], j.S3, a.key);
			const leaks = VARIANTS.map((v) => `${v}:${[j.S1, j.S2, j.S3][order.indexOf(v)].leak_claims.length}`).join(" ");
			console.log(`  [${a.key}] leak ${leaks}`);
		} catch (error) {
			judgeErrors++;
			console.error(`  [ERR] ${a.key}: ${error instanceof Error ? error.message : String(error)}`);
		}
	});

	const sanityMap = new Map<string, Annotation & { V2: string }>();
	for (const i of judgeIdx) {
		const a = annotations[i];
		if (!sanityMap.has(a.key)) sanityMap.set(a.key, { ...a, V2: distilled.V2[i] as string });
	}
	const judgeReliable = await sanityJudgeCatchesInvention(sanityMap);

	const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(0) : "0");
	console.log("\n================ RESULTS ================");
	console.log("variant  coverage   leak%   invented%   grounding(mean)   major-drops");
	for (const v of VARIANTS) {
		const t = tallies[v];
		console.log(
			`  ${v}      ${coverage[v]}/${annotations.length}      ${pct(t.leak, t.judged).padStart(3)}%    ${pct(t.invented, t.judged).padStart(3)}%        ${(t.scoreSum / Math.max(t.judged, 1)).toFixed(2)}             ${t.score0}`,
		);
	}
	for (const v of VARIANTS) {
		if (tallies[v].missingExamples.length) {
			console.log(`\n${v} major grounding drops:`);
			for (const m of tallies[v].missingExamples) console.log(`  - ${m}`);
		}
	}
	console.log(`\njudge sanity (catches spliced invention): ${judgeReliable ? "PASS" : "FAIL"}; judge errors: ${judgeErrors}`);

	// Pre-registered decision rule (relative, not absolute: the judge itself is noisy, so
	// leak==0 is unrealistic — require a substantial cut vs the current prompt without
	// regressing grounding or slips). Ship the best qualifying variant.
	const v0 = tallies.V0;
	const leakRate = (t: Tally) => (t.judged ? t.leak / t.judged : 1);
	const invRate = (t: Tally) => (t.judged ? t.invented / t.judged : 1);
	const mean = (t: Tally) => (t.judged ? t.scoreSum / t.judged : 0);
	const improves = (cand: Tally, candCov: number) =>
		judgeReliable &&
		cand.judged > 0 &&
		leakRate(cand) <= leakRate(v0) * 0.5 &&
		mean(cand) >= mean(v0) &&
		invRate(cand) <= invRate(v0) &&
		candCov >= coverage.V0 * 0.9;

	const labels: Record<VariantKey, string> = {
		V0: "current",
		V1: "annotation-only",
		V2: "line-as-context + guardrail",
	};
	const ranked = (["V1", "V2"] as VariantKey[])
		.filter((v) => improves(tallies[v], coverage[v]))
		.sort(
			(a, b) =>
				leakRate(tallies[a]) - leakRate(tallies[b]) ||
				mean(tallies[b]) - mean(tallies[a]),
		);

	const verdict = ranked.length
		? `SHIP ${ranked[0]} (${labels[ranked[0]]})`
		: "DON'T SHIP — no variant clearly beat the current prompt";
	console.log(`\nVERDICT: ${verdict}`);
	console.log("=========================================");
	process.exit(verdict.startsWith("DON'T") ? 1 : 0);
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
