#!/usr/bin/env bun
/// <reference types="bun" />

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	auditFiles,
	exceedsBudget,
	summarize,
	DEFAULT_SEVERITY_BUDGET,
} from "./tier1/report";
import {
	DEFAULT_TOKEN_BUDGET,
	runTier2OnFiles,
	summarizeTier2,
} from "./tier2/judge";
import {
	compareToBaseline,
	readBaseline,
	summarizeDiff,
	writeBaseline,
} from "./baseline";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const BASELINE_PATH = path.join(SCRIPT_DIR, "baseline.json");
const GOLDEN_PATH = path.join(SCRIPT_DIR, "golden/index.json");

interface CliFlags {
	tier: 1 | 2 | "all";
	file?: string;
	baseline: boolean;
	compare: boolean;
	ci: boolean;
	help: boolean;
}

function parseFlags(argv: string[]): CliFlags {
	const out: CliFlags = {
		tier: "all",
		baseline: false,
		compare: false,
		ci: false,
		help: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		switch (arg) {
			case "--tier": {
				const v = argv[++i];
				if (v === "1") out.tier = 1;
				else if (v === "2") out.tier = 2;
				else out.tier = "all";
				break;
			}
			case "--file":
				out.file = argv[++i];
				break;
			case "--baseline":
				out.baseline = true;
				break;
			case "--compare":
				out.compare = true;
				break;
			case "--ci":
				out.ci = true;
				break;
			case "-h":
			case "--help":
				out.help = true;
				break;
		}
	}
	return out;
}

function printHelp() {
	console.log(`voice-audit — regression gate for song analysis

Usage:
  bun scripts/voice-audit/cli.ts                  # tier 1 + tier 2 over golden set
  bun scripts/voice-audit/cli.ts --tier 1         # deterministic rules only
  bun scripts/voice-audit/cli.ts --file <path>    # audit a single JSON
  bun scripts/voice-audit/cli.ts --baseline       # regenerate baseline.json
  bun scripts/voice-audit/cli.ts --compare        # diff against baseline, exit 1 on regression
  bun scripts/voice-audit/cli.ts --compare --ci   # CI mode: enforce severity + token budgets on checked-in fixtures`);
}

interface GoldenEntry {
	songId: string;
	source: string;
}

function loadGoldenFiles(): string[] {
	if (!existsSync(GOLDEN_PATH)) return [];
	const manifest = JSON.parse(readFileSync(GOLDEN_PATH, "utf-8")) as {
		entries: GoldenEntry[];
	};
	return manifest.entries.map((e) => path.resolve(REPO_ROOT, e.source));
}

async function main() {
	const flags = parseFlags(process.argv.slice(2));
	if (flags.help) {
		printHelp();
		return;
	}

	const files = flags.file
		? [path.resolve(process.cwd(), flags.file)]
		: loadGoldenFiles();

	if (files.length === 0) {
		console.error(
			"No files to audit. Populate scripts/voice-audit/golden/index.json or pass --file.",
		);
		process.exit(2);
	}

	const tier1 = auditFiles(files);
	console.log(summarize(tier1));

	if (flags.baseline) {
		const baseline = writeBaseline(BASELINE_PATH, tier1);
		console.log(
			`\nWrote baseline: ${BASELINE_PATH} (${baseline.totals.high}h/${baseline.totals.medium}m/${baseline.totals.low}l)`,
		);
		return;
	}

	let exitCode = 0;

	if (flags.compare) {
		const baseline = readBaseline(BASELINE_PATH);
		if (!baseline) {
			console.error(
				`\nNo baseline at ${BASELINE_PATH}. Run --baseline first.`,
			);
			process.exit(2);
		}
		const diff = compareToBaseline(tier1, baseline);
		console.log("\n" + summarizeDiff(diff));
		if (diff.regressed) exitCode = 1;
	} else if (exceedsBudget(tier1, DEFAULT_SEVERITY_BUDGET)) {
		// Aspirational absolute budget — only gates when not comparing to a baseline.
		// Use after a prompt rewrite as a standalone sanity check.
		console.log(
			`\nSeverity budget exceeded (>${DEFAULT_SEVERITY_BUDGET.maxHigh} high or >${DEFAULT_SEVERITY_BUDGET.maxMedium} medium).`,
		);
		exitCode = 1;
	}

	const runTier2 = flags.tier !== 1;
	if (runTier2) {
		const cleanFiles = tier1.files
			.filter(
				(f) =>
					!f.skipped &&
					f.hits.every((hit) => hit.severity === "low"),
			)
			.map((f) => f.source);

		if (cleanFiles.length === 0) {
			console.log("\nTier 2 skipped: no files passed Tier 1.");
		} else {
			const result = await runTier2OnFiles(cleanFiles, {
				budget: DEFAULT_TOKEN_BUDGET,
			});
			console.log("\n" + summarizeTier2(result));
			if (result.exceeded) exitCode = 1;
		}
	}

	process.exit(exitCode);
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
