#!/usr/bin/env bun
/// <reference types="bun" />

// Acceptance check for the grounding judge (GRD-1/2/3/6, IMG-3). Runs the judge live over
// the 9 gold reads — each fed its own heard lyrics + vote-gated annotations — which must ALL
// pass, then over deliberately-broken reads that splice imported content the lyrics and
// annotations do not support, which must ALL flag. Pass-the-golds + catch-the-negatives =
// calibrated. The judge runs on Opus via the `claude` CLI (see grounding-judge.ts), so this
// is a script with live calls, not a vitest test.
//
//   bun scripts/voice-audit/check-grounding.ts            # all 9 golds + the negatives
//   bun scripts/voice-audit/check-grounding.ts as-it-was  # one gold (+ negatives) — cheap iteration
//
// Negatives always run; a gold filter only narrows the (expensive) positive set.

import { Result } from "better-result";
import type { SongRead } from "@/lib/domains/enrichment/content-analysis/read-schema";
import { loadGoldExemplars } from "./exemplars";
import { loadGroundingContext, type GroundingContext } from "./lyrics-context";
import { runGroundingJudge } from "./tier2/grounding-judge";

interface Case {
	label: string;
	read: SongRead;
	ctx: GroundingContext;
	expectGrounded: boolean;
}

function spliceTake(read: SongRead, suffix: string): SongRead {
	return { ...read, take: `${read.take} ${suffix}` };
}

function buildCases(filter: Set<string>): Case[] {
	const golds = loadGoldExemplars();
	const byKey = new Map([...golds.values()].map((g) => [g.key, g]));

	const positives: Case[] = [...golds.values()]
		.filter((g) => filter.size === 0 || filter.has(g.key))
		.map((g) => ({
			label: `gold:${g.key}`,
			read: g.read,
			ctx: loadGroundingContext(g.key),
			expectGrounded: true,
		}));

	const negatives: Case[] = [];
	// GRD-2 imported reception — spliced into the one gold with zero annotations, so the
	// chart/crowd claim is unambiguously absent from both sources.
	const nsfb = byKey.get("no-sex-for-ben");
	if (nsfb) {
		negatives.push({
			label: "broken:reception",
			read: spliceTake(
				nsfb.read,
				"By then it was the song of the summer, screamed back by sold-out crowds every night of the tour.",
			),
			ctx: loadGroundingContext("no-sex-for-ben"),
			expectGrounded: false,
		});
	}
	// GRD-3 imported biography — beautiful-things has only one (parents) annotation, so a
	// record-deal backstory traces to neither lyric nor annotation.
	const bt = byKey.get("beautiful-things");
	if (bt) {
		negatives.push({
			label: "broken:biography",
			read: spliceTake(
				bt.read,
				"He wrote it the week he signed his first major-label deal, fresh off a viral audition.",
			),
			ctx: loadGroundingContext("beautiful-things"),
			expectGrounded: false,
		});
	}
	// IMG-3 constructed atmosphere — a place and time nothing in drivers-license establishes.
	const dl = byKey.get("drivers-license");
	if (dl) {
		const arc = dl.read.arc.map((b, i) =>
			i === 0
				? {
						...b,
						scene: `${b.scene} All of it happens in an empty rain-soaked parking lot at 3 a.m.`,
					}
				: b,
		);
		negatives.push({
			label: "broken:atmosphere",
			read: { ...dl.read, arc },
			ctx: loadGroundingContext("drivers-license"),
			expectGrounded: false,
		});
	}

	return [...positives, ...negatives];
}

async function main() {
	const filter = new Set(process.argv.slice(2));
	const cases = buildCases(filter);
	let failures = 0;
	let costUsd = 0;

	for (const c of cases) {
		const result = await runGroundingJudge(c.read, c.ctx);
		if (Result.isError(result)) {
			console.error(`  [ERR ] ${c.label}: judge error — ${result.error.message}`);
			failures++;
			continue;
		}
		const { output, costUsd: cost } = result.value;
		costUsd += cost ?? 0;
		const correct = output.grounded === c.expectGrounded;
		if (!correct) failures++;
		const verdict = output.grounded ? "grounded" : "FLAGGED";
		const mark = correct ? "ok" : "WRONG";
		const ev = output.ungrounded_claims.slice(0, 3).join(" | ");
		const para = output.paratextual_flags.length
			? ` [para: ${output.paratextual_flags.join("; ")}]`
			: "";
		console.log(
			`  [${mark}] ${c.label}: ${verdict}${ev ? ` (${ev})` : ""}${para}`,
		);
		if (!correct && output.rationale.length) {
			console.log(`        rationale: ${output.rationale.join(" / ")}`);
		}
	}

	console.log(
		`\n${cases.length - failures}/${cases.length} as expected. Opus cost ~$${costUsd.toFixed(2)}.`,
	);
	process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
