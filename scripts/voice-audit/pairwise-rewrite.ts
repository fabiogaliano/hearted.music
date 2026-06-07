#!/usr/bin/env bun
/// <reference types="bun" />

// The paid arbiter run the Round-3 readiness call deferred: does the rewrite pass convert v17's
// pairwise losses vs gold into ties/wins? It is a MATCHED within-run comparison — for each gold it
// takes the newest-N real v17 flash reads from experiments/, judges the RAW read vs gold, then judges
// the SAME read after the rewrite pass vs gold, both via the program's Opus pairwise judge (judgePair,
// both orders, position-bias reconciled). Same candidates on both sides → the only variable is the
// rewrite, so the delta is the rewrite's effect with no confound. Compare to the established v17-raw
// flash floor (eval-artifacts/v17-base.json: 0W/0T/27L).
//
//   bun scripts/voice-audit/pairwise-rewrite.ts --songs drivers-license --limit 1   # 1-pair-each smoke
//   bun scripts/voice-audit/pairwise-rewrite.ts --limit 3                            # full n=3 × 9 golds
//
// Writes eval-artifacts/v17-raw-matched.json and v17-rewrite-matched.json (scoreboard-readable; diff
// with: bun scripts/voice-audit/scoreboard.ts eval-artifacts/v17-raw-matched.json eval-artifacts/v17-rewrite-matched.json).
// Cost: 2 pairs/candidate × ~$0.14. n=3 × 9 golds ≈ 54 pairs ≈ $7.5.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	ConceptReadSchema,
	type ConceptRead,
} from "@/lib/domains/enrichment/content-analysis/concept-schema";
import { createLlmService } from "@/lib/integrations/llm/service";
import {
	collapseOutcome,
	EVAL_ARTIFACT_SCHEMA_VERSION,
	writeEvalArtifact,
	type EvalArtifact,
	type EvalRunVerdict,
	type RunOutcome,
} from "./eval-artifact";
import type { RunRecord } from "./experiments";
import { loadGoldExemplars } from "./exemplars";
import { rewriteRead } from "./rewrite/rewrite-pass";
import { voiceStats } from "./stats";
import { runAllRules } from "./tier1/rules";
import { judgePair, type BalancedVerdict } from "./tier2/pairwise";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const EXPERIMENTS = join(SCRIPT_DIR, "experiments");
const GOLD_KEYS = ["not-like-us", "drivers-license", "blinding-lights", "motion-sickness", "dtmf", "no-sex-for-ben", "beautiful-things", "pink-pony-club", "as-it-was"];

function parseArgs() {
	const argv = process.argv.slice(2);
	const get = (f: string) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
	return {
		limit: Math.max(1, Number(get("--limit") ?? 3)),
		songs: get("--songs")?.split(",").map((s) => s.trim()) ?? GOLD_KEYS,
	};
}

function loadV17Flash(): RunRecord[] {
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
				r.promptVersion === "17" &&
				(r.model?.includes("flash") ?? false) &&
				ConceptReadSchema.safeParse(r.analysis).success,
		);
}

function runOutcome(v: BalancedVerdict): RunOutcome {
	return v.winner === "first" ? "WIN" : v.winner === "second" ? "LOSS" : "TIE";
}

// judgePair can throw AFTER runClaude succeeds when Opus returns malformed/truncated JSON
// (parseVerdict), which runClaude's CLI-level retry does not cover. A fresh sample almost always
// parses, so retry the whole pair a few times; returns null only on persistent failure so the
// caller skips that candidate instead of aborting the run (mirrors evaluate.ts's per-candidate skip).
async function judgePairSafe(
	song: string,
	first: ConceptRead,
	second: ConceptRead,
	attempts = 3,
): Promise<BalancedVerdict | null> {
	for (let i = 0; i < attempts; i++) {
		try {
			return await judgePair(song, first, second, { model: "opus" });
		} catch (err) {
			console.error(`  ⚠ judge parse/throw (attempt ${i + 1}/${attempts}): ${String((err as Error)?.message ?? err).slice(0, 100)}`);
		}
	}
	return null;
}

function high(read: ConceptRead): number {
	return runAllRules(read).filter((h) => h.severity === "high").length;
}

function verdictRecord(runId: string, read: ConceptRead, v: BalancedVerdict): EvalRunVerdict {
	const hits = runAllRules(read);
	const t = { high: 0, medium: 0, low: 0 };
	for (const h of hits) t[h.severity]++;
	return {
		runId,
		outcome: runOutcome(v),
		confidence: v.confidence,
		agreement: v.agreement,
		candidateWordCount: voiceStats(read).wordCount,
		tier1: t,
		pairwiseRationales: [v.runs[0].rationale, v.runs[1].rationale],
	};
}

function artifact(label: string, songs: EvalArtifact["songs"]): EvalArtifact {
	return {
		schemaVersion: EVAL_ARTIFACT_SCHEMA_VERSION,
		label,
		variant: { promptVersion: label.includes("rewrite") ? "17+rewrite" : "17", model: "google-vertex:gemini-2.5-flash", temperature: 0.3 },
		judgeModel: "opus",
		generatedAt: new Date().toISOString(),
		songs,
	};
}

async function main() {
	const args = parseArgs();
	const gold = loadGoldExemplars();
	const byKey = new Map([...gold.values()].map((g) => [g.key, g]));
	const records = loadV17Flash();

	const llm = createLlmService("google-vertex");

	const rawSongs: EvalArtifact["songs"] = [];
	const rwSongs: EvalArtifact["songs"] = [];
	let cost = 0;

	console.log(`Paid matched pairwise — v17 raw vs v17+rewrite, both vs gold, Opus judge, limit ${args.limit}/song`);
	console.log(`Songs: ${args.songs.join(", ")}\n`);

	for (const key of args.songs) {
		const g = byKey.get(key);
		if (!g) {
			console.error(`  no gold for ${key}; skipping`);
			continue;
		}
		const cands = records
			.filter((r) => r.spotifyTrackId === g.spotifyTrackId)
			.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
			.slice(0, args.limit);
		if (!cands.length) {
			console.error(`  no v17 flash reads for ${key}; skipping`);
			continue;
		}
		if (cands.length < args.limit) {
			console.error(`  ⚠ ${key}: only ${cands.length} v17 reads (< ${args.limit}); song may be indeterminate`);
		}

		const rawRuns: EvalRunVerdict[] = [];
		const rwRuns: EvalRunVerdict[] = [];

		for (const cand of cands) {
			const raw = cand.analysis;
			const rw = await rewriteRead(raw, llm, { maxPasses: 2 });

			process.stdout.write(`  ${key} [${cand.runId.slice(0, 19)}] raw(h${high(raw)})… `);
			const rawV = await judgePairSafe(g.song, raw, g.read);
			if (rawV) cost += rawV.costUsd;
			process.stdout.write(`${rawV ? runOutcome(rawV) : "SKIP"}  |  rewrite(h${high(raw)}→${high(rw.read)})… `);
			const rwV = await judgePairSafe(g.song, rw.read, g.read);
			if (rwV) cost += rwV.costUsd;
			console.log(`${rwV ? runOutcome(rwV) : "SKIP"}   ($${cost.toFixed(2)})`);

			if (rawV) rawRuns.push(verdictRecord(cand.runId, raw, rawV));
			if (rwV) rwRuns.push(verdictRecord(cand.runId, rw.read, rwV));
		}

		rawSongs.push({ key, song: g.song, spotifyTrackId: g.spotifyTrackId, goldWordCount: voiceStats(g.read).wordCount, runs: rawRuns, songOutcome: collapseOutcome(rawRuns) });
		rwSongs.push({ key, song: g.song, spotifyTrackId: g.spotifyTrackId, goldWordCount: voiceStats(g.read).wordCount, runs: rwRuns, songOutcome: collapseOutcome(rwRuns) });
	}

	const rawPath = join(SCRIPT_DIR, "eval-artifacts", "v17-raw-matched.json");
	const rwPath = join(SCRIPT_DIR, "eval-artifacts", "v17-rewrite-matched.json");
	writeEvalArtifact(rawPath, artifact("v17-raw@matched", rawSongs));
	writeEvalArtifact(rwPath, artifact("v17+rewrite@matched", rwSongs));

	const tally = (songs: EvalArtifact["songs"]) => {
		let w = 0, t = 0, l = 0, succ = 0, fail = 0, ind = 0;
		for (const s of songs) {
			for (const r of s.runs) {
				if (r.outcome === "WIN") w++;
				else if (r.outcome === "TIE") t++;
				else l++;
			}
			if (s.songOutcome === "success") succ++;
			else if (s.songOutcome === "fail") fail++;
			else ind++;
		}
		return { w, t, l, succ, fail, ind, n: w + t + l, songs: songs.length };
	};
	const rawT = tally(rawSongs);
	const rwT = tally(rwSongs);
	const pct = (x: { w: number; t: number; n: number }) => x.n ? (((x.w + x.t) / x.n) * 100).toFixed(0) : "0";

	console.log(`\n${"=".repeat(72)}`);
	console.log(`v17 RAW     vs gold: ${rawT.w}W/${rawT.t}T/${rawT.l}L  → win+tie ${pct(rawT)}%   | per-song: ${rawT.succ} success / ${rawT.fail} fail / ${rawT.ind} indet (of ${rawT.songs})`);
	console.log(`v17+REWRITE vs gold: ${rwT.w}W/${rwT.t}T/${rwT.l}L  → win+tie ${pct(rwT)}%   | per-song: ${rwT.succ} success / ${rwT.fail} fail / ${rwT.ind} indet (of ${rwT.songs})`);
	console.log(`\nTotal Opus cost: $${cost.toFixed(2)}`);
	console.log(`Artifacts: ${rawPath}\n           ${rwPath}`);
	console.log(`Diff: bun scripts/voice-audit/scoreboard.ts ${rawPath} ${rwPath}`);
	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
