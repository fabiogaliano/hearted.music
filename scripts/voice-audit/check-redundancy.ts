#!/usr/bin/env bun
/// <reference types="bun" />

// Acceptance check for the redundancy judge (XCT-1 / ARC-8 / LIN-8 / CON-2). The 9 golds
// must all pass — including As It Was, whose load-bearing "as it was" spine repetition (TYP-3)
// must NOT read as redundancy. Two deliberately-broken reads must flag: a contradiction
// reworded from the take, and a scene that restates the take verbatim instead of dramatizing
// it. Runs on Gemini (same as the other pointwise judges); live calls, so it is a script.
//
//   bun scripts/voice-audit/check-redundancy.ts

import { Result } from "better-result";
import type { ConceptRead } from "@/lib/domains/enrichment/content-analysis/concept-schema";
import { createLlmService } from "@/lib/integrations/llm/service";
import { loadGoldExemplars } from "./exemplars";
import { redundancyPrompt } from "./tier2/prompts/redundancy";
import { RedundancySchema } from "./tier2/schemas";

interface Case {
	label: string;
	read: ConceptRead;
	expectDistinct: boolean;
}

function buildCases(): Case[] {
	const golds = loadGoldExemplars();
	const byKey = new Map([...golds.values()].map((g) => [g.key, g]));

	const cases: Case[] = [...golds.values()].map((g) => ({
		label: `gold:${g.key}`,
		read: g.read,
		expectDistinct: true,
	}));

	// CON-2: a contradiction that is verbatim take sentences names no new tension — dead weight.
	const dl = byKey.get("drivers-license");
	if (dl) {
		cases.push({
			label: "broken:contradiction-restates-take",
			read: {
				...dl.read,
				contradiction:
					"He is probably with that blonde girl who is everything she is insecure about. She still fuckin' loves him.",
			},
			expectDistinct: false,
		});
	}

	// ARC-8: a scene that restates the take's opening verbatim instead of dramatizing it.
	const bt = byKey.get("beautiful-things");
	if (bt) {
		const arc = bt.read.arc.map((b, i) =>
			i === bt.read.arc.length - 1
				? {
						...b,
						scene:
							"He's finally sane, at peace, with a girl his parents love. And that's the problem.",
					}
				: b,
		);
		cases.push({
			label: "broken:scene-restates-take",
			read: { ...bt.read, arc },
			expectDistinct: false,
		});
	}

	return cases;
}

async function main() {
	// Vertex (GCP-billed, ADC) — the provider the stored experiments used and the config
	// default; the AI Studio `google` key path is separate and credit-gated.
	const llm = createLlmService("google-vertex");
	const cases = buildCases();
	let failures = 0;

	for (const c of cases) {
		const result = await llm.generateObject(
			redundancyPrompt(c.read),
			RedundancySchema,
		);
		if (Result.isError(result)) {
			console.error(`  [ERR ] ${c.label}: judge error — ${result.error}`);
			failures++;
			continue;
		}
		const { distinct, redundant_pairs } = result.value.output;
		const correct = distinct === c.expectDistinct;
		if (!correct) failures++;
		const verdict = distinct ? "distinct" : "FLAGGED";
		const mark = correct ? "ok" : "WRONG";
		console.log(
			`  [${mark}] ${c.label}: ${verdict}${redundant_pairs.length ? ` (${redundant_pairs.join("; ")})` : ""}`,
		);
	}

	console.log(
		`\n${cases.length - failures}/${cases.length} as expected (9 golds distinct, 2 broken reads flagged).`,
	);
	process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
