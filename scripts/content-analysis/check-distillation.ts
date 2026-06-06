#!/usr/bin/env bun
/// <reference types="bun" />

// Sanity gate for annotation distillation: does the distiller invent facts the raw
// annotation doesn't support? It is NOT a voice-audit track — it checks one low-level
// content-analysis helper, so it lives here rather than under scripts/voice-audit/.
//
// For each gold lyrics doc it runs the real distiller (ensureAnnotationDistillations →
// google-vertex Flash-Lite, cached on content_hash so reruns are cheap), recovers every
// (rawAnnotation, distilledText) pair, and asks Opus — a different model family from the
// distiller, via the local `claude` CLI — whether every claim in the distilled text is
// supported by the raw annotation. Every gold pair must be judged faithful. Two handcrafted
// negatives, built from real gold distillations with an unsupported fact spliced in, must be
// flagged. Pass-the-golds + catch-the-negatives = the gate is meaningfully calibrated.
//
//   bun scripts/content-analysis/check-distillation.ts            # all 9 golds + negatives
//   bun scripts/content-analysis/check-distillation.ts as-it-was  # one gold (+ negatives) — cheap
//
// Negatives always run; a song-key filter only narrows the (expensive) positive set.

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ensureAnnotationDistillations } from "@/lib/domains/enrichment/content-analysis/annotation-distillation";
import { normalizeAnnotationText } from "@/lib/domains/enrichment/lyrics/utils/lyrics-formatter";
import { loadLyricsDoc } from "../voice-audit/lyrics-context";
import { runClaude } from "../voice-audit/tier2/claude-cli";

const LYRICS_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"voice-audit",
	"exemplars",
	"lyrics",
);

// Source golds for the two negatives. They always run regardless of the argv filter, so the
// catch-the-negatives half of the gate is never skipped during cheap single-song iteration.
const NEGATIVE_SOURCE_KEYS = ["as-it-was", "blinding-lights"] as const;

// Wildly specific, source-absent claims. Spliced into a real distilled text, each one is a
// fact the raw annotation cannot support, so a faithful judge must flag it.
const FABRICATED_CHART_FACT =
	"It spent nineteen consecutive weeks at number one in Norway.";
const FABRICATED_BIO_FACT =
	"The songwriter has said this verse was written entirely in a Reykjavík hotel in 2009.";

// Local judge schema — kept in this script, not promoted to shared infra.
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

function listGoldKeys(): string[] {
	return readdirSync(LYRICS_DIR)
		.filter((f) => f.endsWith(".json"))
		.map((f) => f.replace(/\.json$/, ""))
		.sort();
}

// Walk the doc's annotations, dedup by the same normalized key the distiller uses, and look
// each one up in the returned map. An annotation missing from the map was never distilled
// (the distiller fell back to raw); we can't faithfulness-check what wasn't produced, so we
// count those as skipped rather than silently dropping them.
function recoverPairs(
	key: string,
	map: Map<string, string>,
): { pairs: Pair[]; skipped: number } {
	const doc = loadLyricsDoc(key);
	const seen = new Set<string>();
	const pairs: Pair[] = [];
	let skipped = 0;
	for (const section of doc.sections) {
		for (const line of section.lines) {
			for (const annotation of line.annotations ?? []) {
				const normalized = normalizeAnnotationText(annotation.text);
				if (normalized.length === 0 || seen.has(normalized)) continue;
				seen.add(normalized);
				const distilled = map.get(normalized);
				if (distilled === undefined) {
					skipped++;
					continue;
				}
				pairs.push({
					label: `gold:${key}`,
					raw: annotation.text,
					distilled,
					expectFaithful: true,
				});
			}
		}
	}
	return { pairs, skipped };
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

// Tolerant of a model that wraps JSON in prose or ```json fences: slice from the first { to
// the last }. Throws on malformed output or a false verdict with no claim — both are
// "unexpected" results the gate should surface, not swallow.
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

interface Outcome {
	label: string;
	correct: boolean;
	costUsd: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 529/overload/timeout are transient upstream conditions, not bad output. The CLI already
// retries internally; this rides out a longer overload window on top of that. A failed call
// returns no Opus tokens, so retrying costs nothing — only a successful judge call is billed.
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

// Bounded low: concurrent Opus calls add pressure when the API is busy, and the CLI's backoff
// can then outlast the per-call timeout. Two in flight keeps a full run moving without that.
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

async function buildNegatives(): Promise<Pair[]> {
	const splices = [
		{ tag: "append-chart", make: (d: string) => `${d} ${FABRICATED_CHART_FACT}` },
		{ tag: "swap-bio", make: (d: string) => `${FABRICATED_BIO_FACT} ${d}` },
	];
	const negatives: Pair[] = [];
	for (let i = 0; i < NEGATIVE_SOURCE_KEYS.length; i++) {
		const key = NEGATIVE_SOURCE_KEYS[i];
		const map = await ensureAnnotationDistillations(loadLyricsDoc(key).sections);
		const { pairs } = recoverPairs(key, map);
		const source = pairs[0];
		if (!source) {
			console.warn(`  [warn] no distilled pair for negative source ${key}; skipping`);
			continue;
		}
		const splice = splices[i % splices.length];
		negatives.push({
			label: `negative:${splice.tag}:${key}`,
			raw: source.raw,
			distilled: splice.make(source.distilled),
			expectFaithful: false,
		});
	}
	return negatives;
}

async function main() {
	const all = listGoldKeys();
	const filter = new Set(process.argv.slice(2));
	const keys = filter.size === 0 ? all : all.filter((k) => filter.has(k));
	if (keys.length === 0) {
		console.error(`No matching gold keys. Available: ${all.join(", ")}`);
		process.exit(2);
	}

	const positives: Pair[] = [];
	let skippedTotal = 0;
	for (const key of keys) {
		const map = await ensureAnnotationDistillations(loadLyricsDoc(key).sections);
		const { pairs, skipped } = recoverPairs(key, map);
		positives.push(...pairs);
		skippedTotal += skipped;
	}

	const negatives = await buildNegatives();
	const cases = [...positives, ...negatives];
	console.log(
		`Judging ${positives.length} gold pairs across ${keys.length} song(s) + ${negatives.length} negatives` +
			(skippedTotal ? ` (${skippedTotal} annotations had no distillation, skipped)` : ""),
	);

	const outcomes = await runPool(cases, 2, judgePair);
	const failures = outcomes.filter((o) => !o.correct);
	const costUsd = outcomes.reduce((sum, o) => sum + o.costUsd, 0);

	if (failures.length) {
		console.log(`\nUnexpected results:`);
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
