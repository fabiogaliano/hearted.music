#!/usr/bin/env bun
/// <reference types="bun" />

// One-off: confirms each Phase-4 H5–H9 variant (v23–v27) loaded without its no-op guard throwing,
// differs from v17, and shows the exact changed region so the edit can be eyeballed before any
// generation budget is spent. Run: bun scripts/voice-audit/verify-variants.ts

import { getLyricalPrompt } from "@/lib/domains/enrichment/content-analysis/prompts/registry";

const base = getLyricalPrompt("17").template;
const variants = ["23", "24", "25", "26", "27", "28"];

function lineDiff(a: string, b: string): { from: string[]; to: string[] } {
	const al = a.split("\n");
	const bl = b.split("\n");
	let start = 0;
	while (start < al.length && start < bl.length && al[start] === bl[start]) start++;
	let endA = al.length - 1;
	let endB = bl.length - 1;
	while (endA >= start && endB >= start && al[endA] === bl[endB]) {
		endA--;
		endB--;
	}
	return { from: al.slice(start, endA + 1), to: bl.slice(start, endB + 1) };
}

for (const v of variants) {
	const t = getLyricalPrompt(v).template;
	const identical = t === base;
	const dChars = t.length - base.length;
	console.log(`\n${"=".repeat(80)}\nv${v}  (Δ ${dChars >= 0 ? "+" : ""}${dChars} chars, identical-to-v17=${identical})`);
	if (identical) {
		console.log("  !! IDENTICAL TO v17 — guard failed to catch a no-op edit");
		continue;
	}
	const { from, to } = lineDiff(base, t);
	console.log(`\n  --- v17 (removed/changed, ${from.length} line(s)) ---`);
	for (const l of from) console.log(`  - ${l}`);
	console.log(`\n  +++ v${v} (added/changed, ${to.length} line(s)) ---`);
	for (const l of to) console.log(`  + ${l}`);
}

// Pairwise: every variant must differ from every other (no accidental dupes).
console.log(`\n${"=".repeat(80)}\nuniqueness check:`);
const templates = new Map(variants.map((v) => [v, getLyricalPrompt(v).template]));
let allUnique = true;
for (let i = 0; i < variants.length; i++) {
	for (let j = i + 1; j < variants.length; j++) {
		if (templates.get(variants[i]) === templates.get(variants[j])) {
			console.log(`  !! v${variants[i]} === v${variants[j]}`);
			allUnique = false;
		}
	}
}
console.log(allUnique ? "  all 5 variants are distinct ✓" : "  DUPLICATE VARIANTS FOUND");
process.exit(0);
