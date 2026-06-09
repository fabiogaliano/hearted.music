#!/usr/bin/env bun
/// <reference types="bun" />

// Re-scores every recorded run's stored analysis under the CURRENT Tier-1 rules,
// showing stored-vs-now totals. Use after changing a rule to see its effect on
// history without spending API calls. Read-only: does not rewrite the records.
//
//   bun scripts/voice-audit/rescore.ts

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SongReadSchema } from "@/lib/domains/enrichment/content-analysis/read-schema";
import type { RunRecord } from "./experiments";
import { tallyHits } from "./experiments";
import { runAllRules } from "@/lib/domains/enrichment/content-analysis/voice/tier1-rules";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "experiments");

function main() {
	const files = readdirSync(DIR)
		.filter((f) => f.endsWith(".json"))
		.sort();
	if (files.length === 0) {
		console.log("No recorded runs to re-score.");
		return;
	}

	for (const file of files) {
		const record = JSON.parse(readFileSync(join(DIR, file), "utf-8")) as RunRecord;
		// Tier-1 rules now grade the read shape; legacy 8-field runs are skipped.
		const parsed = SongReadSchema.safeParse(record.analysis);
		if (!parsed.success) continue;
		const hits = runAllRules(parsed.data);
		const { totals, byRule } = tallyHits(hits);
		const before = `${record.totals.high}/${record.totals.medium}/${record.totals.low}`;
		const after = `${totals.high}/${totals.medium}/${totals.low}`;
		const delta = totals.high - record.totals.high;
		const arrow = delta === 0 ? "=" : delta < 0 ? `↓${-delta}` : `↑${delta}`;
		const top = Object.entries(byRule)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 3)
			.map(([r, c]) => `${r}×${c}`)
			.join(", ");
		console.log(
			`v${record.promptVersion} ${record.model.replace(/^google:/, "")}  stored ${before} → now ${after} (high ${arrow})  ${top}`,
		);
	}
}

main();
