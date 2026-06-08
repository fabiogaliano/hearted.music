// The grounding judge runs on Opus, not Gemini Flash. Grounding is the priority-1 signal
// and the subtlest call in the program — telling a fair interpretation of a heard lyric
// apart from an imported real-world fact is exactly the kind of judgment Flash is weakest
// at, and the one place a miscalibration silently corrupts the whole Phase-4 loop. It goes
// through the same `claude` CLI path the pairwise judge already uses for Opus (no extra API
// key; spawned tool-free), rather than createLlmService, because that is the proven
// strong-model route in this codebase. Model choice recorded here as a calibration decision.

import { Result } from "better-result";
import type { SongRead } from "@/lib/domains/enrichment/content-analysis/read-schema";
import type { GroundingContext } from "../lyrics-context";
import { runClaude } from "./claude-cli";
import { groundingPrompt } from "./prompts/grounding";
import { GroundingSchema, type Grounding } from "./schemas";

export const GROUNDING_MODEL = "opus";

export interface GroundingJudgeOptions {
	model?: string;
	timeoutMs?: number;
}

export interface GroundingJudgeResult {
	output: Grounding;
	costUsd?: number;
}

// Opus is asked for bare JSON but occasionally wraps it; pull the first balanced object.
function extractJson(text: string): string {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	const body = fenced ? fenced[1] : text;
	const start = body.indexOf("{");
	if (start === -1) {
		throw new Error(`no JSON object in grounding output: ${text.slice(0, 200)}`);
	}
	let depth = 0;
	for (let i = start; i < body.length; i++) {
		if (body[i] === "{") depth++;
		else if (body[i] === "}" && --depth === 0) return body.slice(start, i + 1);
	}
	throw new Error(`unterminated JSON in grounding output: ${text.slice(0, 200)}`);
}

export async function runGroundingJudge(
	read: SongRead,
	ctx: GroundingContext,
	options: GroundingJudgeOptions = {},
): Promise<Result<GroundingJudgeResult, Error>> {
	const prompt = `${groundingPrompt(read, ctx.heardLyrics, ctx.annotationsBlock)}

Return ONLY the JSON object — no prose, no code fence.`;
	try {
		const res = await runClaude(prompt, {
			model: options.model ?? GROUNDING_MODEL,
			timeoutMs: options.timeoutMs,
		});
		const parsed: Grounding = GroundingSchema.parse(
			JSON.parse(extractJson(res.text)),
		);
		return Result.ok({ output: parsed, costUsd: res.costUsd });
	} catch (err) {
		return Result.err(err instanceof Error ? err : new Error(String(err)));
	}
}
