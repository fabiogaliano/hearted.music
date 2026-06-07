#!/usr/bin/env bun
/// <reference types="bun" />

// Pre-WP5 preflight: the cheap, FREE end-to-end smoke that proves the pipeline is wired before the
// paid baseline run (Block 1 WP5) doubles as the first integration test. The unit tests check the
// aggregation math in isolation; they never prove evaluate → write → read → scoreboard runs together
// on disk. This does, with no judge calls — then it PRINTS the one paid command you finish with.
// Run it AFTER regen.ts has generated candidates and BEFORE the paid `--pointwise --out` baseline.
//
//   bun scripts/voice-audit/preflight.ts --version 17   # the version you're about to baseline
//   bun scripts/voice-audit/preflight.ts                # any stored version
//
// Checks (all free, real binaries — not reimplemented):
//   1. dry-run path — `evaluate.ts --dry-run` exercises loadRuns + gold match + stats + tier1 with no
//      judge calls; fails loudly when there are no matching runs (the WP5-killing "no matching runs"
//      surprise — generate them with regen.ts first).
//   2. artifact round-trip — writes a synthetic EvalArtifact, then runs `scoreboard.ts` on it, proving
//      write → read (schema-version gate) → marginal + tier-2 render all work end to end on disk.
// Exit code is 0 only when both checks pass, so this is CI-usable.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	EVAL_ARTIFACT_SCHEMA_VERSION,
	writeEvalArtifact,
	type EvalArtifact,
} from "./eval-artifact";
import { loadGoldExemplars } from "./exemplars";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVALUATE = join(HERE, "evaluate.ts");
const SCOREBOARD = join(HERE, "scoreboard.ts");

function flagValue(argv: string[], flag: string): string | undefined {
	const i = argv.indexOf(flag);
	return i >= 0 ? argv[i + 1] : undefined;
}

interface CheckResult {
	ok: boolean;
	stdout: string;
	stderr: string;
}

function shell(args: string[]): CheckResult {
	const proc = Bun.spawnSync(["bun", ...args], { stdout: "pipe", stderr: "pipe" });
	return {
		ok: proc.exitCode === 0,
		stdout: proc.stdout.toString(),
		stderr: proc.stderr.toString(),
	};
}

function report(label: string, ok: boolean, detail?: string): void {
	console.log(`${ok ? "✓ PASS" : "✗ FAIL"}  ${label}`);
	if (detail) {
		for (const line of detail.trim().split("\n")) console.log(`        ${line}`);
	}
}

// A synthetic artifact whose only job is to flow through write → read → scoreboard. Odd run counts
// (so nothing collapses to indeterminate) and tier-2 findings on every run (so the pointwise render
// path is exercised too, not just the marginal one).
function syntheticArtifact(): EvalArtifact {
	const mkRun = (outcome: "WIN" | "LOSS" | "TIE", runId: string) => ({
		runId,
		outcome,
		confidence: "high" as const,
		agreement: true,
		candidateWordCount: 120,
		tier1: { high: 0, medium: 1, low: 2 },
		pairwiseRationales: ["preflight rationale A", "preflight rationale B"],
		tier2: [
			{ judge: "grounding", passed: true, evidence: ["preflight"] },
			{ judge: "redundancy", passed: false, evidence: ["scene repeats take"] },
		],
	});
	return {
		schemaVersion: EVAL_ARTIFACT_SCHEMA_VERSION,
		label: "preflight@synthetic",
		variant: { promptVersion: "preflight", model: "synthetic", temperature: 0.3 },
		judgeModel: "opus",
		generatedAt: "2026-01-01T00:00:00.000Z",
		songs: [
			{
				key: "preflight-1",
				song: "Preflight One",
				spotifyTrackId: "preflight-1",
				goldWordCount: 100,
				runs: [mkRun("WIN", "p1-a"), mkRun("LOSS", "p1-b"), mkRun("WIN", "p1-c")],
				songOutcome: "success",
			},
		],
	};
}

function main(): void {
	const argv = process.argv.slice(2);
	const version = flagValue(argv, "--version");
	console.log(
		`\nPREFLIGHT — free pipeline smoke before the paid WP5 baseline${version ? ` (version ${version})` : ""}\n`,
	);

	// Check 1 — the real free path: loadRuns + gold match + stats + tier1, no judge calls.
	const dryArgs = [EVALUATE, "--dry-run", "--limit", "1"];
	if (version) dryArgs.push("--version", version);
	const dry = shell(dryArgs);
	const dryDetail = dry.ok
		? dry.stdout.split("\n").find((l) => l.includes("Tier-1 means")) ?? ""
		: `${dry.stderr.trim() || dry.stdout.trim()}\n→ no matching runs to evaluate; generate candidates with regen.ts first (an ODD --runs count, e.g. 3).`;
	report("dry-run path (loadRuns → gold match → stats → tier1)", dry.ok, dryDetail);

	// Check 2 — write → read (schema gate) → scoreboard render, on disk.
	const dir = mkdtempSync(join(tmpdir(), "voice-preflight-"));
	const artifactPath = join(dir, "synthetic.json");
	let roundTripOk = false;
	let roundTripDetail = "";
	try {
		writeEvalArtifact(artifactPath, syntheticArtifact());
		const board = shell([SCOREBOARD, artifactPath]);
		const renderedMarginal = board.stdout.includes("win-or-tie");
		const renderedPointwise = board.stdout.includes("TIER-2 PASS-RATES");
		roundTripOk = board.ok && renderedMarginal && renderedPointwise;
		roundTripDetail = roundTripOk
			? "wrote → read (schemaVersion gate) → marginal + tier-2 render all OK"
			: `scoreboard exit=${board.ok ? 0 : "≠0"} marginal=${renderedMarginal} tier2=${renderedPointwise}\n${(board.stderr || board.stdout).trim()}`;
	} catch (err) {
		roundTripDetail = String(err);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	report("artifact round-trip (write → read → scoreboard)", roundTripOk, roundTripDetail);

	// The paid step is yours to run — print it explicitly rather than firing a billed call from a smoke.
	let goldKeys: string[] = [];
	try {
		goldKeys = [...loadGoldExemplars().values()].map((g) => g.key);
	} catch {
		goldKeys = [];
	}
	const sampleSong = goldKeys[0] ?? "<gold-key>";
	const versionArg = version ?? "<version>";
	console.log(`\n${"-".repeat(72)}`);
	console.log("Next — the PAID 1-song integration check (run this yourself; ~one pair + grounding):");
	console.log(
		`  bun scripts/voice-audit/evaluate.ts --version ${versionArg} --songs ${sampleSong} --limit 1 --pointwise --out eval-artifacts/preflight-1song.json`,
	);
	console.log("  bun scripts/voice-audit/scoreboard.ts eval-artifacts/preflight-1song.json");
	if (goldKeys.length) console.log(`  (gold keys: ${goldKeys.join(", ")})`);
	console.log(
		"If both checks above PASS and that 1-song run writes a readable scorecard, the full WP5 baseline is safe to burn.",
	);

	process.exit(dry.ok && roundTripOk ? 0 : 1);
}

main();
