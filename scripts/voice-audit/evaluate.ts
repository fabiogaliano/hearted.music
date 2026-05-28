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
//
// Cost: each judged pair is two Opus calls (~$0.14). Pairs judged = songs × limit.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunRecord } from "./experiments";
import { loadGoldExemplars, type GoldExemplar } from "./exemplars";
import { voiceStats, type VoiceStats } from "./stats";
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
}

function parseFlags(argv: string[]): Flags {
	const out: Flags = { limit: 2, judgeModel: "opus", dryRun: false, temperatureSet: false };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--version") out.version = argv[++i];
		else if (argv[i] === "--temperature" || argv[i] === "--temp") {
			out.temperature = Number(argv[++i]);
			out.temperatureSet = true;
		} else if (argv[i] === "--songs") out.songs = argv[++i].split(",").map((s) => s.trim());
		else if (argv[i] === "--limit") out.limit = Math.max(1, Number(argv[++i]) || 1);
		else if (argv[i] === "--judge-model") out.judgeModel = argv[++i];
		else if (argv[i] === "--dry-run") out.dryRun = true;
	}
	return out;
}

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
		.filter((r): r is RunRecord => r !== null && r.promptKind === "lyrical");
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

	for (const [track, runs] of candidates) {
		const g = gold.get(track) as GoldExemplar;
		const songEval: SongEval = { key: g.key, song: g.song, gold: g, candidates: [] };
		for (const run of runs) {
			const tier1 = {
				high: run.totals.high,
				medium: run.totals.medium,
				low: run.totals.low,
			};
			const stats = voiceStats(run.analysis);
			let verdict: BalancedVerdict | undefined;
			if (!flags.dryRun) {
				process.stdout.write(`  judging ${g.key} (${run.promptVersion}) ... `);
				verdict = await judgePair(g.song, run.analysis, g.analysis, {
					model: flags.judgeModel,
				});
				totalCost += verdict.costUsd;
				console.log(
					`candidate ${verdict.winner === "first" ? "WINS" : verdict.winner === "second" ? "loses" : "ties"} vs gold (${verdict.confidence}${verdict.agreement ? "" : ", flipped"})`,
				);
			}
			songEval.candidates.push({ runId: run.runId, tier1, stats, verdict });
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
		console.log(`  gold:  ${statsLine(voiceStats(e.gold.analysis))}`);
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
	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
