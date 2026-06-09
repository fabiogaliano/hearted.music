#!/usr/bin/env bun
/// <reference types="bun" />

// Calibration harness for the cite-or-fail grounding judge. It answers two questions the Phase-4
// loop depends on: (1) is the judge SELF-CONSISTENT — does it return the same verdict when run
// repeatedly on the same input at its real operating temperature? and (2) is it CALIBRATED — does
// its verdict agree with a checked-in label on the 9 golds (should pass) and the subtle negatives
// (should fail)? It reports BOTH raw agreement and the binary Cohen's κ, and never collapses them
// into one number, because at this fixture size κ is jumpy and must be read alongside raw
// agreement and self-consistency.
//
// This makes real Opus calls (one per judge run): items × repeats. The default 13 items × 3
// repeats = 39 Opus calls. Treat it as a deliberate paid run, not part of every edit loop.
//
//   bun scripts/voice-audit/grounding-calibration.ts                 # all items, 3 repeats
//   bun scripts/voice-audit/grounding-calibration.ts --repeats 2 --only negatives
//   bun scripts/voice-audit/grounding-calibration.ts --only golds

import { Result } from "better-result";
import type { SongRead } from "@/lib/domains/enrichment/content-analysis/read-schema";
import { loadGoldExemplars } from "./exemplars";
import { GROUNDING_NEGATIVES } from "./fixtures/grounding-negatives";
import { loadGroundingContext, type GroundingContext } from "./lyrics-context";
import { runGroundingJudge } from "./tier2/grounding-judge";

// --- Pure metrics (exported for tests; no LLM calls) ---
//
// Convention everywhere: a boolean is the GROUNDED verdict — true = "grounded / should pass".

export interface BinaryPair {
	/** What the judge decided (majority over repeats). */
	judge: boolean;
	/** The checked-in label. */
	label: boolean;
}

export function rawAgreement(pairs: BinaryPair[]): number {
	if (pairs.length === 0) return 1;
	const agree = pairs.filter((p) => p.judge === p.label).length;
	return agree / pairs.length;
}

// Plain (unweighted) Cohen's κ for the binary grounded/not-grounded decision against the label.
// pe is chance agreement from the two marginals. When pe = 1 (one class never appears on either
// side) κ is undefined; we return 1 for perfect observed agreement and 0 otherwise, the standard
// degenerate-case convention.
export function cohenKappaBinary(pairs: BinaryPair[]): number {
	const n = pairs.length;
	if (n === 0) return 1;
	let agree = 0;
	let judgeTrue = 0;
	let labelTrue = 0;
	for (const p of pairs) {
		if (p.judge === p.label) agree++;
		if (p.judge) judgeTrue++;
		if (p.label) labelTrue++;
	}
	const po = agree / n;
	const pJ = judgeTrue / n;
	const pL = labelTrue / n;
	const pe = pJ * pL + (1 - pJ) * (1 - pL);
	if (1 - pe === 0) return po === 1 ? 1 : 0;
	return (po - pe) / (1 - pe);
}

export interface SelfConsistencyItem {
	id: string;
	pass: number;
	fail: number;
	/** Fraction of runs matching the item's majority verdict. */
	agreement: number;
	/** True when the runs disagreed at all (any pass AND any fail). */
	flipped: boolean;
	/** Majority grounded verdict; pass wins an exact tie (only possible with even repeats). */
	majority: boolean;
}

export interface SelfConsistencySummary {
	items: SelfConsistencyItem[];
	meanAgreement: number;
	flippedCount: number;
}

export function selfConsistencySummary(
	runsByItem: Array<{ id: string; runs: boolean[] }>,
): SelfConsistencySummary {
	const items: SelfConsistencyItem[] = runsByItem.map(({ id, runs }) => {
		const pass = runs.filter(Boolean).length;
		const fail = runs.length - pass;
		const agreement = runs.length ? Math.max(pass, fail) / runs.length : 0;
		return { id, pass, fail, agreement, flipped: pass > 0 && fail > 0, majority: pass >= fail };
	});
	const meanAgreement = items.length
		? items.reduce((a, i) => a + i.agreement, 0) / items.length
		: 0;
	return { items, meanAgreement, flippedCount: items.filter((i) => i.flipped).length };
}

// --- Paid harness (guarded; only runs when invoked directly) ---

interface CalItem {
	id: string;
	read: SongRead;
	ctx: GroundingContext;
	/** true = should be grounded (a gold); false = a subtle negative. */
	label: boolean;
}

interface Flags {
	repeats: number;
	only: "all" | "golds" | "negatives";
	model?: string;
	timeoutMs?: number;
}

function parseFlags(argv: string[]): Flags {
	const out: Flags = { repeats: 3, only: "all" };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--repeats") out.repeats = Math.max(1, Number(argv[++i]) || 1);
		else if (argv[i] === "--only") out.only = argv[++i] as Flags["only"];
		else if (argv[i] === "--model") out.model = argv[++i];
		else if (argv[i] === "--timeout") out.timeoutMs = Number(argv[++i]);
	}
	return out;
}

function buildItems(only: Flags["only"]): CalItem[] {
	const golds = loadGoldExemplars();
	const byKey = new Map([...golds.values()].map((g) => [g.key, g]));
	const items: CalItem[] = [];

	if (only !== "negatives") {
		for (const g of golds.values()) {
			items.push({
				id: `gold:${g.key}`,
				read: g.read,
				ctx: loadGroundingContext(g.key),
				label: true,
			});
		}
	}
	if (only !== "golds") {
		for (const fx of GROUNDING_NEGATIVES) {
			const base = byKey.get(fx.baseKey);
			if (!base) throw new Error(`fixture ${fx.id}: unknown baseKey ${fx.baseKey}`);
			items.push({
				id: `neg:${fx.id}`,
				read: fx.mutate(base.read),
				ctx: loadGroundingContext(fx.baseKey),
				label: false,
			});
		}
	}
	return items;
}

function fmt(n: number): string {
	return n.toFixed(2);
}

async function main() {
	const flags = parseFlags(process.argv.slice(2));
	const items = buildItems(flags.only);

	console.log(
		`\nGrounding calibration — ${items.length} items × ${flags.repeats} repeats = ${items.length * flags.repeats} Opus calls (${flags.model ?? "opus"})`,
	);

	const runsByItem: Array<{ id: string; runs: boolean[] }> = [];
	const pairs: BinaryPair[] = [];
	let cost = 0;
	let errors = 0;

	for (const item of items) {
		const runs: boolean[] = [];
		for (let r = 0; r < flags.repeats; r++) {
			process.stdout.write(`  ${item.id} [${r + 1}/${flags.repeats}] ... `);
			const res = await runGroundingJudge(item.read, item.ctx, {
				model: flags.model,
				timeoutMs: flags.timeoutMs,
			});
			if (Result.isOk(res)) {
				cost += res.value.costUsd ?? 0;
				runs.push(res.value.output.grounded);
				console.log(res.value.output.grounded ? "grounded" : "NOT grounded");
			} else {
				// A parse/CLI failure (incl. cite-or-fail violations) counts as a not-grounded run,
				// and is surfaced so formatting noise is not mistaken for a real disagreement.
				errors++;
				runs.push(false);
				console.log(`error: ${res.error.message.slice(0, 60)}`);
			}
		}
		runsByItem.push({ id: item.id, runs });
		const pass = runs.filter(Boolean).length;
		pairs.push({ judge: pass >= runs.length - pass, label: item.label });
	}

	const sc = selfConsistencySummary(runsByItem);
	const agreement = rawAgreement(pairs);
	const kappa = cohenKappaBinary(pairs);

	console.log(`\n${"=".repeat(64)}\nGROUNDING CALIBRATION REPORT\n${"=".repeat(64)}`);

	console.log("\nSELF-CONSISTENCY (same input, repeated runs at operating temp):");
	console.log(
		`  mean self-agreement: ${fmt(sc.meanAgreement)}  (target 0.80 desired, 0.70 floor)`,
	);
	console.log(`  items that flipped: ${sc.flippedCount}/${sc.items.length}`);
	for (const it of sc.items) {
		console.log(
			`    ${it.id.padEnd(28)} ${it.pass}✓/${it.fail}✗  agree ${fmt(it.agreement)}${it.flipped ? "  ⚠ flip" : ""}`,
		);
	}

	console.log("\nCALIBRATION vs checked-in label (judge majority vs label):");
	console.log(`  raw agreement: ${fmt(agreement)}  (${pairs.filter((p) => p.judge === p.label).length}/${pairs.length})`);
	console.log(`  binary Cohen's κ: ${fmt(kappa)}  (~0.60 = substantial; jumpy on a small fixture)`);
	console.log(
		"  NOTE: raw agreement and κ are SEPARATE numbers — κ corrects for chance, raw does not.",
	);
	for (const p of pairs.map((pair, i) => ({ ...pair, id: runsByItem[i].id }))) {
		const mark = p.judge === p.label ? "ok" : "MISS";
		console.log(
			`    ${p.id.padEnd(28)} judge=${p.judge ? "grounded" : "not"}  label=${p.label ? "grounded" : "not"}  ${mark}`,
		);
	}

	if (errors) console.log(`\n${errors} run(s) errored (counted as not-grounded).`);
	console.log(`\nOpus cost: $${cost.toFixed(2)}\n`);
	process.exit(0);
}

if (import.meta.main) {
	main().catch((err) => {
		console.error(err);
		process.exit(2);
	});
}
