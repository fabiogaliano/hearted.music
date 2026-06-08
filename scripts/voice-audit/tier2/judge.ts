import { readFileSync } from "node:fs";
import path from "node:path";
import { Result } from "better-result";
import { z } from "zod";
import {
	SongReadSchema,
	type SongRead,
} from "@/lib/domains/enrichment/content-analysis/read-schema";
import {
	createLlmService,
	type LlmService,
} from "@/lib/integrations/llm/service";
import type {
	JudgeFinding,
	JudgeReport,
	TokenBudget,
	TokenUsage,
} from "../types";
import type { GroundingContext } from "../lyrics-context";
import { extractAnalysis } from "../tier1/report";
import { runGroundingJudge } from "./grounding-judge";
import { abstractNounTrapPrompt } from "./prompts/abstract-noun-trap";
import { arcNarrativePrompt } from "./prompts/arc-narrative";
import { essayisticRegisterPrompt } from "./prompts/essayistic-register";
import { lensCoherencePrompt } from "./prompts/lens-coherence";
import { redundancyPrompt } from "./prompts/redundancy";
import { registerSpecificityPrompt } from "./prompts/register-specificity";
import { voiceSoftnessPrompt } from "./prompts/voice-softness";
import {
	AbstractNounTrapSchema,
	ArcNarrativeSchema,
	EssayisticRegisterSchema,
	LensCoherenceSchema,
	RedundancySchema,
	RegisterSpecificitySchema,
	VoiceSoftnessSchema,
} from "./schemas";

export const DEFAULT_TOKEN_BUDGET: TokenBudget = {
	inputLimit: 250_000,
	outputLimit: 10_000,
};

interface JudgeRunner {
	name: string;
	run: (
		llm: LlmService,
		read: SongRead,
	) => Promise<
		Result<
			{
				finding: Omit<JudgeFinding, "judge">;
				tokens?: TokenUsage;
			},
			Error
		>
	>;
}

function makeJudge<T>(
	name: string,
	schema: z.ZodType<T>,
	buildPrompt: (a: SongRead) => string,
	toFinding: (result: T) => Omit<JudgeFinding, "judge">,
): JudgeRunner {
	return {
		name,
		run: async (llm, analysis) => {
			const prompt = buildPrompt(analysis);
			const result = await llm.generateObject(prompt, schema);
			if (Result.isError(result)) {
				return Result.err(
					result.error instanceof Error
						? result.error
						: new Error(String(result.error)),
				);
			}
			return Result.ok({
				finding: toFinding(result.value.output),
				tokens: result.value.tokens,
			});
		},
	};
}

const JUDGES: JudgeRunner[] = [
	makeJudge(
		"register-specificity",
		RegisterSpecificitySchema,
		registerSpecificityPrompt,
		(r) => ({
			passed: r.specific,
			evidence: r.generic_sentences,
			rationale: r.rationale.join(" / "),
		}),
	),
	makeJudge(
		"abstract-noun-trap",
		AbstractNounTrapSchema,
		abstractNounTrapPrompt,
		(r) => ({
			passed: r.concrete,
			evidence: r.offending_nouns,
			rationale: r.rationale.join(" / "),
		}),
	),
	makeJudge(
		"essayistic-register",
		EssayisticRegisterSchema,
		essayisticRegisterPrompt,
		(r) => ({
			passed: r.conversational,
			evidence: r.essayistic_phrases,
			rationale: r.rationale.join(" / "),
		}),
	),
	makeJudge(
		"arc-narrative",
		ArcNarrativeSchema,
		arcNarrativePrompt,
		(r) => ({
			passed: r.narrative,
			evidence: [...r.disconnect_points, ...r.recap_scenes],
			rationale: r.rationale.join(" / "),
		}),
	),
	makeJudge(
		"lens-coherence",
		LensCoherenceSchema,
		lensCoherencePrompt,
		(r) => ({
			passed: r.coherent,
			evidence: r.problems,
			rationale: r.rationale.join(" / "),
		}),
	),
	makeJudge(
		"redundancy",
		RedundancySchema,
		redundancyPrompt,
		(r) => ({
			passed: r.distinct,
			evidence: r.redundant_pairs,
			rationale: r.rationale.join(" / "),
		}),
	),
	makeJudge(
		"voice-softness",
		VoiceSoftnessSchema,
		voiceSoftnessPrompt,
		(r) => ({
			passed: r.clean,
			evidence: [...r.kicker_hits, ...r.fragment_hits, ...r.parallelism_hits],
			rationale: r.rationale.join(" / "),
		}),
	),
];

function zeroTokens(): TokenUsage {
	return { prompt: 0, completion: 0, total: 0 };
}

function addTokens(acc: TokenUsage, next: TokenUsage | undefined): TokenUsage {
	if (!next) return acc;
	return {
		prompt: acc.prompt + next.prompt,
		completion: acc.completion + next.completion,
		total: acc.total + next.total,
	};
}

function wouldExceed(
	totals: TokenUsage,
	next: TokenUsage | undefined,
	budget: TokenBudget,
): boolean {
	const prompt = totals.prompt + (next?.prompt ?? 0);
	const completion = totals.completion + (next?.completion ?? 0);
	return prompt > budget.inputLimit || completion > budget.outputLimit;
}

// Grounding needs more than the read: the lyrics + vote-gated annotations the writer could
// have heard. Supplied here so judgeAnalysis can run the Opus grounding pass; omit it (the
// generic file runner has no lyrics) and grounding is simply skipped.
export interface JudgeContext {
	grounding?: GroundingContext;
}

export async function judgeAnalysis(
	llm: LlmService,
	analysis: SongRead,
	totals: TokenUsage,
	budget: TokenBudget,
	context: JudgeContext = {},
): Promise<{
	findings: JudgeFinding[];
	tokens: TokenUsage;
	exceeded: boolean;
	/** Opus grounding pass cost (CLI reports dollars, not tokens — kept off the token budget). */
	groundingCostUsd?: number;
}> {
	const findings: JudgeFinding[] = [];
	let runTotal = zeroTokens();
	let exceeded = false;

	for (const judge of JUDGES) {
		const result = await judge.run(llm, analysis);

		if (Result.isError(result)) {
			findings.push({
				judge: judge.name,
				passed: false,
				evidence: [`judge-error: ${result.error.message}`],
			});
			continue;
		}

		const { finding, tokens } = result.value;
		if (wouldExceed(addTokens(totals, runTotal), tokens, budget)) {
			findings.push({
				judge: judge.name,
				passed: false,
				evidence: ["token-budget-exceeded"],
			});
			exceeded = true;
			break;
		}

		runTotal = addTokens(runTotal, tokens);
		findings.push({ judge: judge.name, ...finding });
	}

	// Priority-1 grounding pass on Opus. Runs after the Gemini judges and only when lyrics
	// context is present. Para-textual flags ride in the rationale, never as a fail (GRD-5).
	let groundingCostUsd: number | undefined;
	if (context.grounding && !exceeded) {
		const g = await runGroundingJudge(analysis, context.grounding);
		if (Result.isError(g)) {
			findings.push({
				judge: "grounding",
				passed: false,
				evidence: [`judge-error: ${g.error.message}`],
			});
		} else {
			const { output, costUsd } = g.value;
			groundingCostUsd = costUsd;
			const notes = [
				...output.rationale,
				...output.paratextual_flags.map((f) => `para-textual (review): ${f}`),
			];
			findings.push({
				judge: "grounding",
				passed: output.grounded,
				evidence: output.ungrounded_claims,
				rationale: notes.length ? notes.join(" / ") : undefined,
			});
		}
	}

	return { findings, tokens: runTotal, exceeded, groundingCostUsd };
}

export interface Tier2RunOptions {
	budget?: TokenBudget;
	llm?: LlmService;
}

export async function runTier2OnFiles(
	filePaths: string[],
	options: Tier2RunOptions = {},
): Promise<{
	reports: JudgeReport[];
	totals: TokenUsage;
	budget: TokenBudget;
	exceeded: boolean;
}> {
	const budget = options.budget ?? DEFAULT_TOKEN_BUDGET;
	const llm = options.llm ?? createLlmService("google");

	const reports: JudgeReport[] = [];
	let totals = zeroTokens();
	let exceeded = false;

	for (const filePath of filePaths) {
		if (exceeded) break;
		const absolute = path.isAbsolute(filePath)
			? filePath
			: path.resolve(process.cwd(), filePath);
		const raw = JSON.parse(readFileSync(absolute, "utf-8"));
		const { songId, read } = extractAnalysis(raw);
		if (!read) continue;
		const parsed = SongReadSchema.safeParse(read);
		if (!parsed.success) continue;

		const result = await judgeAnalysis(llm, parsed.data, totals, budget);
		totals = addTokens(totals, result.tokens);
		reports.push({
			source: absolute,
			songId,
			findings: result.findings,
			tokens: result.tokens,
		});
		if (result.exceeded) {
			exceeded = true;
		}
	}

	return { reports, totals, budget, exceeded };
}

export function summarizeTier2(result: {
	reports: JudgeReport[];
	totals: TokenUsage;
	budget: TokenBudget;
	exceeded: boolean;
}): string {
	const lines: string[] = [];
	const failedByJudge = new Map<string, number>();
	for (const r of result.reports) {
		for (const f of r.findings) {
			if (!f.passed) {
				failedByJudge.set(f.judge, (failedByJudge.get(f.judge) ?? 0) + 1);
			}
		}
	}
	lines.push(
		`Tier 2: ${result.reports.length} files — tokens ${result.totals.prompt}/${result.budget.inputLimit} in, ${result.totals.completion}/${result.budget.outputLimit} out${result.exceeded ? " (BUDGET EXCEEDED)" : ""}`,
	);
	for (const [judge, count] of failedByJudge) {
		lines.push(`  ${judge}: ${count} failures`);
	}
	for (const r of result.reports) {
		const failed = r.findings.filter((f) => !f.passed);
		if (failed.length === 0) continue;
		const label = r.songId ?? path.basename(r.source);
		lines.push(`\n${label}`);
		for (const f of failed) {
			const ev = f.evidence.slice(0, 3).map((e) => `"${e}"`).join(", ");
			lines.push(`  [${f.judge}] ${ev}${f.rationale ? ` — ${f.rationale}` : ""}`);
		}
	}
	return lines.join("\n");
}
