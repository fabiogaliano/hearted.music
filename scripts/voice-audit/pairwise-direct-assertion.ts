#!/usr/bin/env bun
/// <reference types="bun" />

// Paid arbiter for the user-supplied anti-pivot idea (Phase-4 H11/H12). The idea has two halves and
// this run scores both against gold in ONE matched within-run design (like pairwise-rewrite.ts):
//
//   - GENERATION half (v29): judge the RAW v29 flash read vs gold. Does the author's positive-menu
//     generation prompt beat the established v17-raw flash floor (eval-artifacts/v17-base.json: 0/27)?
//   - REWRITE half (direct-assertion): rewrite the SAME v29 read with rewriteRead(mode:"direct-assertion")
//     — delete Statement A entirely, strengthen the surviving claim to stand alone — then judge vs gold.
//     Does deleting-and-strengthening convert any losses the minimal recast (round 3b: 0/54) did not?
//
// Same candidates on both sides → the only variable on the rewrite side is the direct-assertion pass.
// Opus judge, both orders, position-bias reconciled. Writes two scoreboard-readable artifacts.
//
//   bun scripts/voice-audit/pairwise-direct-assertion.ts --songs drivers-license --limit 1   # smoke
//   bun scripts/voice-audit/pairwise-direct-assertion.ts --limit 3                            # n=3 × 9 golds
//
// Cost: 2 pairs/candidate × 2 sides × ~$0.14. n=3 × 9 golds ≈ 108 pairs. Gate behind clean per-song
// v29 coverage (≥ limit fresh v29 flash reads/song) before spending.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	SongReadSchema,
	type SongRead,
} from "@/lib/domains/enrichment/content-analysis/read-schema";
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
import { rewriteRead } from "@/lib/domains/enrichment/content-analysis/voice/rewrite-pass";
import { voiceStats } from "./stats";
import { runAllRules } from "@/lib/domains/enrichment/content-analysis/voice/tier1-rules";
import { judgePair, type BalancedVerdict } from "./tier2/pairwise";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const EXPERIMENTS = join(SCRIPT_DIR, "experiments");
const GOLD_KEYS = ["not-like-us", "drivers-license", "blinding-lights", "motion-sickness", "dtmf", "no-sex-for-ben", "beautiful-things", "pink-pony-club", "as-it-was"];

function parseArgs() {
	const argv = process.argv.slice(2);
	const get = (f: string) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
	return {
		// Default base v17 → directly comparable to round-3b's v17-raw 0/27 and v17+minimal-rewrite 0/54
		// floors, isolating the direct-assertion rewrite as the only variable. Pass --version 29 to test
		// the author's full pipeline (positive-menu generation + direct-assertion rewrite) instead.
		version: get("--version") ?? "17",
		limit: Math.max(1, Number(get("--limit") ?? 3)),
		songs: get("--songs")?.split(",").map((s) => s.trim()) ?? GOLD_KEYS,
	};
}

function loadFlash(version: string): RunRecord[] {
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
				r.promptVersion === version &&
				(r.model?.includes("flash") ?? false) &&
				r.temperature === 0.3 &&
				SongReadSchema.safeParse(r.analysis).success,
		);
}

function runOutcome(v: BalancedVerdict): RunOutcome {
	return v.winner === "first" ? "WIN" : v.winner === "second" ? "LOSS" : "TIE";
}

// judgePair can throw AFTER runClaude succeeds when Opus returns malformed/truncated JSON; a fresh
// sample almost always parses. Retry the whole pair; return null only on persistent failure so the
// caller skips that candidate instead of aborting the run (mirrors evaluate.ts / pairwise-rewrite.ts).
async function judgePairSafe(
	song: string,
	first: SongRead,
	second: SongRead,
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

function high(read: SongRead): number {
	return runAllRules(read).filter((h) => h.severity === "high").length;
}

function verdictRecord(runId: string, read: SongRead, v: BalancedVerdict): EvalRunVerdict {
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

function artifact(label: string, variant: EvalArtifact["variant"], songs: EvalArtifact["songs"]): EvalArtifact {
	return {
		schemaVersion: EVAL_ARTIFACT_SCHEMA_VERSION,
		label,
		variant,
		judgeModel: "opus",
		generatedAt: new Date().toISOString(),
		songs,
	};
}

async function main() {
	const args = parseArgs();
	const gold = loadGoldExemplars();
	const byKey = new Map([...gold.values()].map((g) => [g.key, g]));
	const records = loadFlash(args.version);

	const llm = createLlmService("google-vertex");

	const rawSongs: EvalArtifact["songs"] = [];
	const daSongs: EvalArtifact["songs"] = [];
	let cost = 0;

	console.log(`Paid matched pairwise — v${args.version} raw vs v${args.version}+direct-assertion, both vs gold, Opus judge, limit ${args.limit}/song`);
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
			console.error(`  no v${args.version} flash reads for ${key}; skipping`);
			continue;
		}
		if (cands.length < args.limit) {
			console.error(`  ⚠ ${key}: only ${cands.length} v${args.version} reads (< ${args.limit}); song may be indeterminate`);
		}

		const rawRuns: EvalRunVerdict[] = [];
		const daRuns: EvalRunVerdict[] = [];

		for (const cand of cands) {
			const raw = cand.analysis;
			const da = await rewriteRead(raw, llm, { maxPasses: 2, mode: "direct-assertion" });

			process.stdout.write(`  ${key} [${cand.runId.slice(0, 19)}] raw(h${high(raw)})… `);
			const rawV = await judgePairSafe(g.song, raw, g.read);
			if (rawV) cost += rawV.costUsd;
			process.stdout.write(`${rawV ? runOutcome(rawV) : "SKIP"}  |  direct-assertion(h${high(raw)}→${high(da.read)})… `);
			const daV = await judgePairSafe(g.song, da.read, g.read);
			if (daV) cost += daV.costUsd;
			console.log(`${daV ? runOutcome(daV) : "SKIP"}   ($${cost.toFixed(2)})`);

			if (rawV) rawRuns.push(verdictRecord(cand.runId, raw, rawV));
			if (daV) daRuns.push(verdictRecord(cand.runId, da.read, daV));
		}

		rawSongs.push({ key, song: g.song, spotifyTrackId: g.spotifyTrackId, goldWordCount: voiceStats(g.read).wordCount, runs: rawRuns, songOutcome: collapseOutcome(rawRuns) });
		daSongs.push({ key, song: g.song, spotifyTrackId: g.spotifyTrackId, goldWordCount: voiceStats(g.read).wordCount, runs: daRuns, songOutcome: collapseOutcome(daRuns) });
	}

	const rawPath = join(SCRIPT_DIR, "eval-artifacts", `v${args.version}-raw-matched.json`);
	const daPath = join(SCRIPT_DIR, "eval-artifacts", `v${args.version}-direct-assertion-matched.json`);
	writeEvalArtifact(rawPath, artifact(`v${args.version}-raw@matched`, { promptVersion: args.version, model: "google-vertex:gemini-2.5-flash", temperature: 0.3 }, rawSongs));
	writeEvalArtifact(daPath, artifact(`v${args.version}+direct-assertion@matched`, { promptVersion: `${args.version}+direct-assertion`, model: "google-vertex:gemini-2.5-flash", temperature: 0.3 }, daSongs));

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
	const daT = tally(daSongs);
	const pct = (x: { w: number; t: number; n: number }) => x.n ? (((x.w + x.t) / x.n) * 100).toFixed(0) : "0";

	console.log(`\n${"=".repeat(72)}`);
	console.log(`v${args.version} RAW              vs gold: ${rawT.w}W/${rawT.t}T/${rawT.l}L  → win+tie ${pct(rawT)}%   | per-song: ${rawT.succ} success / ${rawT.fail} fail / ${rawT.ind} indet (of ${rawT.songs})`);
	console.log(`v${args.version}+DIRECT-ASSERTION vs gold: ${daT.w}W/${daT.t}T/${daT.l}L  → win+tie ${pct(daT)}%   | per-song: ${daT.succ} success / ${daT.fail} fail / ${daT.ind} indet (of ${daT.songs})`);
	console.log(`\nReference floors: v17-raw flash 0/27 (v17-base.json); v17+minimal-rewrite 0/54 (round 3b).`);
	console.log(`Total Opus cost: $${cost.toFixed(2)}`);
	console.log(`Artifacts: ${rawPath}\n           ${daPath}`);
	console.log(`Diff: bun scripts/voice-audit/scoreboard.ts ${rawPath} ${daPath}`);
	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
