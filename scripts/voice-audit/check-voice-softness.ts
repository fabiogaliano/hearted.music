#!/usr/bin/env bun
/// <reference types="bun" />

// Acceptance check for the combined voice-softness judge (SFT-1 kicker / SFT-5 fragmentation
// / SFT-7 parallelism). This is the trickiest gate: the 9 golds are fragment-rich and end
// beats on short active turns ("It becomes a vow.", "he is the one it cannot reach."), and
// all must pass. Three deliberately-broken reads — one per check — must flag: an aphoristic
// kicker, a fragmentation pile, and a mirrored "X is the Y". Runs on Gemini; live calls.
//
//   bun scripts/voice-audit/check-voice-softness.ts

import { Result } from "better-result";
import type { ConceptRead } from "@/lib/domains/enrichment/content-analysis/concept-schema";
import { createLlmService } from "@/lib/integrations/llm/service";
import { loadGoldExemplars } from "./exemplars";
import { voiceSoftnessPrompt } from "./tier2/prompts/voice-softness";
import { VoiceSoftnessSchema } from "./tier2/schemas";

interface Case {
	label: string;
	read: ConceptRead;
	expectClean: boolean;
}

function buildCases(): Case[] {
	const golds = loadGoldExemplars();
	const byKey = new Map([...golds.values()].map((g) => [g.key, g]));

	const cases: Case[] = [...golds.values()].map((g) => ({
		label: `gold:${g.key}`,
		read: g.read,
		expectClean: true,
	}));

	// SFT-1 + SFT-7: an abstract self-admiring button bolted onto the take.
	const ms = byKey.get("motion-sickness");
	if (ms) {
		cases.push({
			label: "broken:kicker",
			read: { ...ms.read, take: `${ms.read.take} The calm is the cruelty.` },
			expectClean: false,
		});
	}

	// SFT-5: a pile of clipped fragments that severs the connective tissue.
	const aiw = byKey.get("as-it-was");
	if (aiw) {
		const arc = aiw.read.arc.map((b, i) =>
			i === 0
				? {
						...b,
						scene: "Gravity. The weight of it. No way up. Just the floor. Just staying. Nothing rising.",
					}
				: b,
		);
		cases.push({
			label: "broken:fragment-pile",
			read: { ...aiw.read, arc },
			expectClean: false,
		});
	}

	// SFT-7: manufactured profundity by symmetry, not a real claim.
	const bl = byKey.get("blinding-lights");
	if (bl) {
		cases.push({
			label: "broken:parallelism",
			read: {
				...bl.read,
				take: `${bl.read.take} She is the question; he is the answer.`,
			},
			expectClean: false,
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
			voiceSoftnessPrompt(c.read),
			VoiceSoftnessSchema,
		);
		if (Result.isError(result)) {
			console.error(`  [ERR ] ${c.label}: judge error — ${result.error}`);
			failures++;
			continue;
		}
		const { clean, kicker_hits, fragment_hits, parallelism_hits } =
			result.value.output;
		const correct = clean === c.expectClean;
		if (!correct) failures++;
		const hits = [
			...kicker_hits.map((h) => `kicker:"${h}"`),
			...fragment_hits.map((h) => `frag:"${h}"`),
			...parallelism_hits.map((h) => `parallel:"${h}"`),
		];
		const verdict = clean ? "clean" : "FLAGGED";
		const mark = correct ? "ok" : "WRONG";
		console.log(
			`  [${mark}] ${c.label}: ${verdict}${hits.length ? ` (${hits.join("; ")})` : ""}`,
		);
	}

	console.log(
		`\n${cases.length - failures}/${cases.length} as expected (9 golds clean, 3 broken reads flagged).`,
	);
	process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
