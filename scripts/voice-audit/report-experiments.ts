#!/usr/bin/env bun
/// <reference types="bun" />

// Summarizes the experiment log (experiments/runs.jsonl), aggregated by prompt
// version + model so noisy single runs don't mislead. Lower mean-high is better.
//
//   bun scripts/voice-audit/report-experiments.ts

import { readRunSummaries } from "./experiments";

function pad(s: string, width: number): string {
	return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function mean(xs: number[]): number {
	return xs.reduce((a, b) => a + b, 0) / xs.length;
}

interface Agg {
	version: string;
	model: string;
	n: number;
	high: number[];
	medium: number[];
	byRule: Record<string, number>;
}

function main() {
	const runs = readRunSummaries();
	if (runs.length === 0) {
		console.log("No runs recorded yet. Run: bun scripts/voice-audit/regen.ts");
		return;
	}

	const groups = new Map<string, Agg>();
	for (const r of runs) {
		const key = `${r.song}__v${r.promptVersion}__${r.model}`;
		let g = groups.get(key);
		if (!g) {
			g = { version: r.promptVersion, model: r.model, n: 0, high: [], medium: [], byRule: {} };
			groups.set(key, g);
		}
		g.n++;
		g.high.push(r.totals.high);
		g.medium.push(r.totals.medium);
		for (const [rule, c] of Object.entries(r.byRule))
			g.byRule[rule] = (g.byRule[rule] ?? 0) + c;
	}

	const bySong = new Map<string, Agg[]>();
	for (const [key, g] of groups) {
		const song = key.split("__v")[0];
		const list = bySong.get(song) ?? [];
		list.push(g);
		bySong.set(song, list);
	}

	for (const [song, aggs] of bySong) {
		console.log(`\n${song}`);
		console.log(
			`  ${pad("ver", 5)} ${pad("model", 22)} ${pad("n", 3)} ${pad("high mean[min-max]", 22)} ${pad("med", 5)} top rules (total)`,
		);
		aggs.sort((a, b) => mean(a.high) - mean(b.high));
		for (const g of aggs) {
			const hi = `${mean(g.high).toFixed(1)} [${Math.min(...g.high)}-${Math.max(...g.high)}]`;
			const top = Object.entries(g.byRule)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 3)
				.map(([r, c]) => `${r}×${c}`)
				.join(", ");
			console.log(
				`  ${pad(`v${g.version}`, 5)} ${pad(g.model.replace(/^google:/, ""), 22)} ${pad(String(g.n), 3)} ${pad(hi, 22)} ${pad(mean(g.medium).toFixed(1), 5)} ${top}`,
			);
		}
		const winner = aggs[0];
		console.log(
			`  → best: v${winner.version} (${winner.model.replace(/^google:/, "")}), mean ${mean(winner.high).toFixed(1)} high over ${winner.n} runs`,
		);
	}
}

main();
