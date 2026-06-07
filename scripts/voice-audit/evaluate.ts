#!/usr/bin/env bun
/// <reference types="bun" />

// The optimization target. Given stored experiment runs, this reports, per song and
// overall: the pairwise judge win-rate vs the gold Hearted exemplars (the real "reads
// like a human friend" signal), the descriptive statistical tells next to gold's own
// numbers, and the existing Tier-1 tallies. Tier-1 is a fast necessary guardrail; the
// judge win-rate is what we actually optimize. See
// claudedocs/voice-eval-design-decision-2026-05-27.md.
//
//   bun scripts/voice-audit/evaluate.ts --version 13 --temperature 0.3
//   bun scripts/voice-audit/evaluate.ts --version 13 --temperature 0.3 --songs fast --limit 1
//   bun scripts/voice-audit/evaluate.ts --version 13 --dry-run        # stats + tier1 only, no judge calls/cost
//   bun scripts/voice-audit/evaluate.ts --version 17 --out eval-artifacts/v17-base.json --pointwise   # full scorecard
//
// --limit caps runs/song; it defaults to 3 and MUST stay ODD for any inferential run. An even count
// lets a song split evenly and collapse to "indeterminate" (eval-artifact.collapseOutcome), silently
// dropping it from the n=9 inference — so an even --limit warns (louder when --out persists it).
// Use n=3 for baseline/variant comparisons; --limit 1 is the cheap single-song smoke. See
// claudedocs/06-block1-implementation-plan.md WP2 §4.
//
// Cost: each judged pair is two Opus calls (~$0.14). Pairs judged = songs × limit.
// --pointwise additionally runs the 8 tier-2 judges per candidate (7 Gemini + 1 Opus grounding
// call). Grounding is the cost driver, so pointwise is opt-in — the cheap iteration loop stays
// pairwise-only, and the scoreboard reads pointwise data only when this flag wrote it.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	ConceptReadSchema,
	type ConceptRead,
} from "@/lib/domains/enrichment/content-analysis/concept-schema";
import { createLlmService, type LlmService } from "@/lib/integrations/llm/service";
import {
	collapseOutcome,
	EVAL_ARTIFACT_SCHEMA_VERSION,
	writeEvalArtifact,
	type EvalArtifact,
	type EvalRunVerdict,
	type EvalSongRecord,
	type JudgeFindingRecord,
	type RunOutcome,
} from "./eval-artifact";
import type { RunRecord } from "./experiments";
import { loadGoldExemplars, type GoldExemplar } from "./exemplars";
import { loadGroundingContext } from "./lyrics-context";
import { voiceStats, type VoiceStats } from "./stats";
import { DEFAULT_TOKEN_BUDGET, judgeAnalysis } from "./tier2/judge";
import { judgePair, type BalancedVerdict } from "./tier2/pairwise";

const EXPERIMENTS = join(dirname(fileURLToPath(import.meta.url)), "experiments");

interface Flags {
	version?: string;
	temperature?: number;
	temperatureSet: boolean;
	songs?: string[];
	limit: number;
	judgeModel: string;
	dryRun: boolean;
	pointwise: boolean;
	out?: string;
}

function parseFlags(argv: string[]): Flags {
	const out: Flags = {
		limit: 3,
		judgeModel: "opus",
		dryRun: false,
		pointwise: false,
		temperatureSet: false,
	};
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--version") out.version = argv[++i];
		else if (argv[i] === "--temperature" || argv[i] === "--temp") {
			out.temperature = Number(argv[++i]);
			out.temperatureSet = true;
		} else if (argv[i] === "--songs") out.songs = argv[++i].split(",").map((s) => s.trim());
		else if (argv[i] === "--limit") out.limit = Math.max(1, Number(argv[++i]) || 1);
		else if (argv[i] === "--judge-model") out.judgeModel = argv[++i];
		else if (argv[i] === "--dry-run") out.dryRun = true;
		else if (argv[i] === "--pointwise") out.pointwise = true;
		else if (argv[i] === "--out") out.out = argv[++i];
	}
	return out;
}

const ZERO_TOKENS = { prompt: 0, completion: 0, total: 0 };

// The 8 pointwise judges (7 Gemini + the Opus grounding pass) on one candidate, fed the same
// vote-gated grounding context Phase 3 hands the prompt. Returns findings in the artifact's shape
// plus the Opus grounding dollar cost (Gemini token cost is not metered here). Run only under
// --pointwise: grounding is an Opus call per candidate, so it is the cost driver of the scorecard.
async function runPointwise(
	llm: LlmService,
	songKey: string,
	analysis: ConceptRead,
): Promise<{ findings: JudgeFindingRecord[]; costUsd: number }> {
	const grounding = loadGroundingContext(songKey);
	const result = await judgeAnalysis(llm, analysis, ZERO_TOKENS, DEFAULT_TOKEN_BUDGET, {
		grounding,
	});
	const findings: JudgeFindingRecord[] = result.findings.map((f) => ({
		judge: f.judge,
		passed: f.passed,
		evidence: f.evidence,
		rationale: f.rationale,
	}));
	return { findings, costUsd: result.groundingCostUsd ?? 0 };
}

function runOutcome(v: BalancedVerdict): RunOutcome {
	return v.winner === "first" ? "WIN" : v.winner === "second" ? "LOSS" : "TIE";
}

// Old-shape (pre-v14) runs are skipped: their stored analysis is the legacy 8-field
// model, which no longer validates against ConceptReadSchema. Until v14 generation
// produces new-shape runs, this returns none and the evaluator reports "no matching
// runs" — the documented audit-blindness window of the clean cut.
function loadRuns(): RunRecord[] {
	return readdirSync(EXPERIMENTS)
		.filter((f) => f.endsWith(".json"))
		.map((f) => {
			try {
				return JSON.parse(readFileSync(join(EXPERIMENTS, f), "utf-8")) as RunRecord;
			} catch {
				return null;
			}
		})
		.filter(
			(r): r is RunRecord =>
				r !== null &&
				r.promptKind === "lyrical" &&
				ConceptReadSchema.safeParse(r.analysis).success,
		);
}

function selectCandidates(
	runs: RunRecord[],
	gold: Map<string, GoldExemplar>,
	flags: Flags,
): Map<string, RunRecord[]> {
	const byTrack = new Map<string, RunRecord[]>();
	for (const run of runs) {
		if (flags.version && run.promptVersion !== flags.version) continue;
		if (flags.temperatureSet && run.temperature !== flags.temperature) continue;
		const g = gold.get(run.spotifyTrackId ?? "");
		if (!g) continue;
		if (flags.songs && !flags.songs.includes(g.key)) continue;
		const list = byTrack.get(run.spotifyTrackId as string) ?? [];
		list.push(run);
		byTrack.set(run.spotifyTrackId as string, list);
	}
	// Most recent first, capped at the per-song limit.
	for (const [track, list] of byTrack) {
		list.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
		byTrack.set(track, list.slice(0, flags.limit));
	}
	return byTrack;
}

interface SongEval {
	key: string;
	song: string;
	gold: GoldExemplar;
	candidates: {
		runId: string;
		tier1: { high: number; medium: number; low: number };
		stats: VoiceStats;
		verdict?: BalancedVerdict;
		tier2?: JudgeFindingRecord[];
	}[];
}

function fmt(n: number | null, digits = 2): string {
	return n === null ? "n/a" : n.toFixed(digits);
}

function statsLine(s: VoiceStats): string {
	return `MTLD ${fmt(s.mtld, 1)}  burst ${fmt(s.burstiness.burstiness)}  fnRatio ${fmt(s.functionWordRatio)}  words ${s.wordCount}`;
}

async function main() {
	const flags = parseFlags(process.argv.slice(2));
	// Odd-run discipline (plan WP2 §4): an even run count can split evenly and collapse to
	// "indeterminate", dropping the song from the n=9 inference. Warn rather than block — even-run
	// histories remain a legacy fallback — but make the cost loud, especially when --out persists it.
	if (flags.limit % 2 === 0) {
		console.error(
			`⚠ --limit ${flags.limit} is EVEN: a song whose runs split evenly collapses to "indeterminate" and drops out of the n=9 inference. Use an ODD count (n=3 recommended) for any baseline/variant run.${flags.out ? " This run persists an artifact (--out), so the loss is baked into the saved scorecard." : ""}`,
		);
	}
	const gold = loadGoldExemplars();
	const candidates = selectCandidates(loadRuns(), gold, flags);

	if (candidates.size === 0) {
		console.error(
			`No matching runs. version=${flags.version ?? "any"} temperature=${flags.temperatureSet ? flags.temperature : "any"}. Gold songs: ${[...gold.values()].map((g) => g.key).join(", ")}.`,
		);
		process.exit(1);
	}

	const versionLabel = flags.version ? `v${flags.version}` : "all versions";
	const tempLabel = flags.temperatureSet ? `temp ${flags.temperature}` : "any temp";
	console.log(`\nEvaluating ${versionLabel} @ ${tempLabel} vs gold (limit ${flags.limit}/song${flags.dryRun ? ", dry-run" : ""})`);

	const evals: SongEval[] = [];
	let totalCost = 0;
	let skippedCandidates = 0;
	let variantMeta:
		| { promptVersion?: string; model?: string; temperature: number | null }
		| undefined;
	// The 7 Gemini judges go through Vertex (ADC-billed), matching generation and the sibling
	// checkers (check-redundancy/voice-softness); the AI Studio "google" key path is depleted and
	// is not the billed path this pipeline runs on. Same model (gemini-2.5-flash), just the working
	// endpoint. The grounding judge spawns Opus via the claude CLI inside judgeAnalysis. Built once
	// and only when actually judging pointwise.
	const llm = flags.pointwise && !flags.dryRun ? createLlmService("google-vertex") : null;

	for (const [track, runs] of candidates) {
		const g = gold.get(track) as GoldExemplar;
		const songEval: SongEval = { key: g.key, song: g.song, gold: g, candidates: [] };
		for (const run of runs) {
			variantMeta ??= {
				promptVersion: run.promptVersion,
				model: run.model,
				temperature: run.temperature ?? null,
			};
			const tier1 = {
				high: run.totals.high,
				medium: run.totals.medium,
				low: run.totals.low,
			};
			const stats = voiceStats(run.analysis);
			let verdict: BalancedVerdict | undefined;
			let tier2: JudgeFindingRecord[] | undefined;
			if (!flags.dryRun) {
				try {
					process.stdout.write(`  judging ${g.key} (${run.promptVersion}) ... `);
					verdict = await judgePair(g.song, run.analysis, g.read, {
						model: flags.judgeModel,
					});
					totalCost += verdict.costUsd;
					console.log(
						`candidate ${verdict.winner === "first" ? "WINS" : verdict.winner === "second" ? "loses" : "ties"} vs gold (${verdict.confidence}${verdict.agreement ? "" : ", flipped"})`,
					);
					if (llm) {
						const pointwise = await runPointwise(llm, g.key, run.analysis as ConceptRead);
						tier2 = pointwise.findings;
						totalCost += pointwise.costUsd;
						const failed = tier2.filter((f) => !f.passed).map((f) => f.judge);
						console.log(
							`         ↳ tier2: ${failed.length ? `FAIL ${failed.join(", ")}` : "all 8 pass"}`,
						);
					}
				} catch (err) {
					// A judge that still throws after runClaude's retry budget (e.g. a persistent content
					// filter on one candidate) must not abort the whole baseline and discard every prior
					// candidate — the artifact is written only at the end. Skip just this run; the song may
					// drop to an even run count and surface as indeterminate in the scoreboard, which is the
					// honest outcome, not a silent loss.
					skippedCandidates++;
					console.error(
						`\n  ⚠ judge failed for ${g.key} run ${run.runId} after retries: ${String((err as Error)?.message ?? err).slice(0, 160)} — skipping this candidate`,
					);
					continue;
				}
			}
			songEval.candidates.push({ runId: run.runId, tier1, stats, verdict, tier2 });
		}
		evals.push(songEval);
	}

	console.log(`\n${"=".repeat(64)}\nRESULTS — ${versionLabel} @ ${tempLabel}\n${"=".repeat(64)}`);

	let wins = 0;
	let ties = 0;
	let losses = 0;
	let highSum = 0;
	let mediumSum = 0;
	let candidateCount = 0;

	for (const e of evals) {
		console.log(`\n${e.song}`);
		console.log(`  gold:  ${statsLine(voiceStats(e.gold.read))}`);
		for (const c of e.candidates) {
			candidateCount++;
			highSum += c.tier1.high;
			mediumSum += c.tier1.medium;
			const v = c.verdict;
			if (v) {
				if (v.winner === "first") wins++;
				else if (v.winner === "tie") ties++;
				else losses++;
			}
			const verdictStr = v
				? `vs gold: ${v.winner === "first" ? "WIN" : v.winner === "second" ? "LOSS" : "TIE"} (${v.confidence})`
				: "vs gold: (dry-run)";
			console.log(
				`  cand:  ${statsLine(c.stats)}  |  tier1 ${c.tier1.high}h/${c.tier1.medium}m  |  ${verdictStr}`,
			);
			if (v) console.log(`         ↳ ${v.runs[0].rationale}`);
		}
	}

	console.log(`\n${"-".repeat(64)}`);
	if (!flags.dryRun) {
		const passRate = candidateCount ? ((wins + ties) / candidateCount) * 100 : 0;
		console.log(
			`Judge vs gold: ${wins} win, ${ties} tie, ${losses} loss  →  pass-rate (win+tie) ${passRate.toFixed(0)}%`,
		);
	}
	console.log(
		`Tier-1 means: ${(highSum / candidateCount).toFixed(2)} high, ${(mediumSum / candidateCount).toFixed(2)} medium  (over ${candidateCount} candidates)`,
	);
	if (!flags.dryRun) console.log(`Judge cost: $${totalCost.toFixed(2)}`);
	if (skippedCandidates > 0) {
		console.error(
			`⚠ ${skippedCandidates} candidate(s) skipped after exhausting the judge retry budget — affected songs may be indeterminate in the scoreboard.`,
		);
	}

	if (flags.out) {
		if (flags.dryRun) {
			console.error("\n--out ignored: a dry-run has no verdicts to persist.");
		} else {
			const artifact = buildArtifact(evals, variantMeta, flags, versionLabel, tempLabel);
			writeEvalArtifact(flags.out, artifact);
			console.log(`\nEval artifact → ${flags.out}`);
		}
	}
	process.exit(0);
}

function buildArtifact(
	evals: SongEval[],
	variantMeta:
		| { promptVersion?: string; model?: string; temperature: number | null }
		| undefined,
	flags: Flags,
	versionLabel: string,
	tempLabel: string,
): EvalArtifact {
	const songs: EvalSongRecord[] = evals.map((e) => {
		const goldWordCount = voiceStats(e.gold.read).wordCount;
		const runs: EvalRunVerdict[] = e.candidates
			.filter((c) => c.verdict)
			.map((c) => {
				const v = c.verdict as BalancedVerdict;
				return {
					runId: c.runId,
					outcome: runOutcome(v),
					confidence: v.confidence,
					agreement: v.agreement,
					candidateWordCount: c.stats.wordCount,
					tier1: c.tier1,
					pairwiseRationales: [v.runs[0].rationale, v.runs[1].rationale],
					...(c.tier2 ? { tier2: c.tier2 } : {}),
				};
			});
		return {
			key: e.key,
			song: e.song,
			spotifyTrackId: e.gold.spotifyTrackId,
			goldWordCount,
			runs,
			songOutcome: collapseOutcome(runs),
		};
	});
	return {
		schemaVersion: EVAL_ARTIFACT_SCHEMA_VERSION,
		label: `${versionLabel}@${tempLabel}`,
		variant: {
			promptVersion: variantMeta?.promptVersion ?? flags.version,
			model: variantMeta?.model,
			temperature: variantMeta?.temperature ?? (flags.temperatureSet ? (flags.temperature ?? null) : null),
		},
		judgeModel: flags.judgeModel,
		generatedAt: new Date().toISOString(),
		songs,
	};
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
