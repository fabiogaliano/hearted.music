// Pairwise voice judge: Opus compares two analyses of the same song against the
// Hearted rubric (see judge-persona.md) and picks which reads more human. Pairwise
// tracks human preference better than pointwise scoring, but it amplifies position
// bias, so every pair runs in BOTH orders and the verdicts are reconciled: agreement
// is a real win, a flip is treated as a tie. The judge is a different model family
// than the generator to avoid self-preference.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { ConceptRead } from "@/lib/domains/enrichment/content-analysis/concept-schema";
import { runClaude } from "./claude-cli";

const PERSONA_FILE = join(dirname(fileURLToPath(import.meta.url)), "judge-persona.md");

const Side = z.enum(["A", "B", "tie"]);

export const VerdictSchema = z.object({
	per_dimension: z.object({
		warmth_attention: Side,
		image_specificity: Side,
		direct_interpretation: Side,
		human_rhythm: Side,
		absence_of_ai_tells: Side,
	}),
	ai_tells_found: z
		.object({
			A: z.array(z.string()).default([]),
			B: z.array(z.string()).default([]),
		})
		.default({ A: [], B: [] }),
	winner: Side,
	confidence: z.enum(["high", "medium", "low"]),
	rationale: z.string(),
});

export type Verdict = z.infer<typeof VerdictSchema>;

export function renderAnalysis(a: ConceptRead): string {
	const lines = [
		`image: ${a.image}`,
		`lens: ${a.lens}`,
		`tension: ${a.tension}`,
		`take: ${a.take}`,
		`contradiction: ${a.contradiction ?? "(none)"}`,
		"arc:",
		...a.arc.map((beat) => `  - ${beat.label} (${beat.mood}): ${beat.scene}`),
		"line_insights:",
		...a.lines.map((l) => `  - on "${l.line}": ${l.insight}`),
		`texture: ${a.texture}`,
	];
	return lines.join("\n");
}

function buildPrompt(song: string, aText: string, bText: string): string {
	return `SONG: ${song}
(Use your own knowledge of this song to judge whether claims are specific to it.)

ANALYSIS A:
${aText}

ANALYSIS B:
${bText}

Compare A and B per the rubric. Return ONLY the JSON object.`;
}

// The persona asks for bare JSON, but models occasionally wrap it in prose or a
// fence; pull the first balanced object out before parsing.
function extractJson(text: string): string {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	const body = fenced ? fenced[1] : text;
	const start = body.indexOf("{");
	if (start === -1) throw new Error(`no JSON object in judge output: ${text.slice(0, 200)}`);
	let depth = 0;
	for (let i = start; i < body.length; i++) {
		if (body[i] === "{") depth++;
		else if (body[i] === "}" && --depth === 0) return body.slice(start, i + 1);
	}
	throw new Error(`unterminated JSON in judge output: ${text.slice(0, 200)}`);
}

export function parseVerdict(text: string): Verdict {
	return VerdictSchema.parse(JSON.parse(extractJson(text)));
}

export interface JudgeOptions {
	model?: string;
	timeoutMs?: number;
}

async function judgeOnce(
	song: string,
	aText: string,
	bText: string,
	options: JudgeOptions,
): Promise<{ verdict: Verdict; costUsd?: number }> {
	const res = await runClaude(buildPrompt(song, aText, bText), {
		model: options.model ?? "opus",
		systemPromptFile: PERSONA_FILE,
		timeoutMs: options.timeoutMs,
	});
	return { verdict: parseVerdict(res.text), costUsd: res.costUsd };
}

export type Identity = "first" | "second" | "tie";

export interface BalancedVerdict {
	winner: Identity;
	agreement: boolean;
	confidence: "high" | "medium" | "low";
	runs: [Verdict, Verdict];
	costUsd: number;
}

// run1 labels first=A, second=B; run2 swaps. Map each winner back to identity, then
// reconcile: same identity = agreement (high), one tie = lean to the decisive call
// (medium), opposite identities = position bias, call it a tie (low).
function toIdentity(side: "A" | "B" | "tie", aIsFirst: boolean): Identity {
	if (side === "tie") return "tie";
	const isFirst = side === "A" ? aIsFirst : !aIsFirst;
	return isFirst ? "first" : "second";
}

export interface Reconciled {
	winner: Identity;
	agreement: boolean;
	confidence: "high" | "medium" | "low";
}

// Pure reconciliation of the two swapped runs, exported for testing. `w1Side` is the
// run1 winner (first=A); `w2Side` is the run2 winner (first=B).
export function reconcile(
	w1Side: "A" | "B" | "tie",
	w2Side: "A" | "B" | "tie",
): Reconciled {
	const w1 = toIdentity(w1Side, true);
	const w2 = toIdentity(w2Side, false);
	if (w1 === w2) {
		return { winner: w1, agreement: true, confidence: w1 === "tie" ? "medium" : "high" };
	}
	if (w1 === "tie" || w2 === "tie") {
		return { winner: w1 === "tie" ? w2 : w1, agreement: false, confidence: "medium" };
	}
	return { winner: "tie", agreement: false, confidence: "low" };
}

export async function judgePair(
	song: string,
	first: ConceptRead,
	second: ConceptRead,
	options: JudgeOptions = {},
): Promise<BalancedVerdict> {
	const firstText = renderAnalysis(first);
	const secondText = renderAnalysis(second);
	const [run1, run2] = await Promise.all([
		judgeOnce(song, firstText, secondText, options),
		judgeOnce(song, secondText, firstText, options),
	]);

	return {
		...reconcile(run1.verdict.winner, run2.verdict.winner),
		runs: [run1.verdict, run2.verdict],
		costUsd: (run1.costUsd ?? 0) + (run2.costUsd ?? 0),
	};
}
