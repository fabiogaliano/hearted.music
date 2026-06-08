#!/usr/bin/env bun
/// <reference types="bun" />

// Runs the lens-coherence judge over the four gold reads (which must pass) and two
// deliberately-broken reads (which must be flagged): a decorative lens grafted onto a
// real take, and a lazy SURFACE tag on a song with genuine buried depth. This is the
// Session 5 acceptance check for the judge; it makes live LLM calls, so it is a script,
// not a vitest test.
//
//   bun scripts/voice-audit/check-lens-coherence.ts
//
// Requires an LLM provider (defaults to google, same as the Tier-2 judges).

import { Result } from "better-result";
import type { SongRead } from "@/lib/domains/enrichment/content-analysis/read-schema";
import { createLlmService } from "@/lib/integrations/llm/service";
import { loadGoldExemplars } from "./exemplars";
import { lensCoherencePrompt } from "./tier2/prompts/lens-coherence";
import { LensCoherenceSchema } from "./tier2/schemas";

interface Case {
	label: string;
	read: SongRead;
	expectCoherent: boolean;
}

function buildCases(): Case[] {
	const golds = loadGoldExemplars();
	const dl = golds.get("4ml4WlnHDEpOK8HRVYTCWf");
	if (!dl) throw new Error("drivers license gold missing");

	const cases: Case[] = [...golds.values()].map((g) => ({
		label: `gold:${g.key}`,
		read: g.read,
		expectCoherent: true,
	}));

	// A decorative, abstract-noun lens grafted onto a real take. The take argues
	// "license as eulogy"; the lens claims something the take never supports.
	cases.push({
		label: "broken:decorative-lens",
		read: { ...dl.read, lens: "a meditation on growing up" },
		expectCoherent: false,
	});

	// A lazy SURFACE tag on a song whose take/contradiction carry genuine depth — the
	// inverse failure the judge must catch (comparison-notes §6.2).
	cases.push({
		label: "broken:lazy-surface",
		read: { ...dl.read, lens: "moving for the joy of moving" },
		expectCoherent: false,
	});

	return cases;
}

async function main() {
	const llm = createLlmService("google");
	const cases = buildCases();
	let failures = 0;

	for (const c of cases) {
		const result = await llm.generateObject(
			lensCoherencePrompt(c.read),
			LensCoherenceSchema,
		);
		if (Result.isError(result)) {
			console.error(`  ${c.label}: judge error — ${result.error}`);
			failures++;
			continue;
		}
		const { coherent, problems } = result.value.output;
		const correct = coherent === c.expectCoherent;
		if (!correct) failures++;
		const verdict = coherent ? "coherent" : "FLAGGED";
		const mark = correct ? "ok" : "WRONG";
		console.log(
			`  [${mark}] ${c.label}: ${verdict}${problems.length ? ` (${problems.join("; ")})` : ""}`,
		);
	}

	console.log(
		`\n${cases.length - failures}/${cases.length} as expected (4 golds coherent, 2 broken reads flagged).`,
	);
	process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
