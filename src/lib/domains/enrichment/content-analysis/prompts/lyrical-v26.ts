import { lyricalV17 } from "./lyrical-v17";
import type { PromptVersion } from "./types";

// v26 = lyrical-v17.ts MINUS its spelled-out book-report "Wrong:" example strings (Phase-4 iteration
// H8). Branches from v17.
//
// Hypothesis: v17 spells several bad sentences verbatim as "Wrong:" examples, and the model LIFTS them.
// Proven in H3: not-like-us's take opened "This is a declaration of war" — word-for-word v17's own
// Wrong example. Research corroborates that spelling a bad full-sentence pattern primes it (phrase-level
// negative examples teach the exact string, not the behavior). The anti-pivot LINE is left exactly as
// v17's here — this edit changes only the priming SOURCE — so the comparison is clean: does removing the
// liftable book-report exemplars (the framing-verb opener strings + the self-reference examples) lower
// the antithesis / book-report-opener rate on its own? The mechanical comma-+-"-ing" pairs are LEFT in
// place: that is a different failure class (participial-closure, which already passes well) with no
// priming evidence, and gutting it would confound the test. Each removal is guarded — if an anchor is
// absent the module throws rather than silently shipping a clone of v17. Measured FREE via runAllRules
// (antithesis + book-report-opener counts). Everything else byte-identical to v17. ACTIVE stays v13.
// Run at temperature 0.3. See scripts/voice-audit/experiments/changelog.md (H8).

const FRAMING_VERB_BLOCK = `Open every field on the noun or the image itself, never on a framing verb ("This is," "It is," "This song is").
  Wrong: "This is a declaration of war."
  Right: "A declaration of war, fought on three fronts."`;

const FRAMING_VERB_DEPRIMED = `Open every field on the noun or the image itself — the thing, not a frame built around it. The first words should land the reader inside the song.`;

const SELF_REFERENCE_EXAMPLES = `
  Wrong: "A hard hitting beat drives the track."
  Right: "A hard hitting beat drives the whole thing forward."
  Wrong: "The track opens with a whisper."
  Right: "A whisper opens it."`;

let template = lyricalV17.template.replace(
	FRAMING_VERB_BLOCK,
	FRAMING_VERB_DEPRIMED,
);
if (template === lyricalV17.template) {
	throw new Error(
		"lyrical-v26: framing-verb anchor not found in v17 template — edit is a no-op",
	);
}
const afterFirst = template;
template = template.replace(SELF_REFERENCE_EXAMPLES, "");
if (template === afterFirst) {
	throw new Error(
		"lyrical-v26: self-reference example anchor not found — edit is a no-op",
	);
}

export const lyricalV26: PromptVersion = {
	version: "26",
	kind: "lyrical",
	notes:
		"v17 MINUS its spelled-out book-report 'Wrong:' example strings (Phase-4 H8): removes the framing-verb opener exemplars (incl. 'This is a declaration of war', which not-like-us copied verbatim in H3) and the self-reference examples, converting the rule to plain affirmative guidance, on the hypothesis that the model lifts spelled bad full-sentences. The anti-pivot LINE is kept exactly as v17's so this isolates the priming-source removal; the mechanical comma+-ing pairs are left (different failure class, no priming evidence). Measured free via runAllRules (antithesis + book-report-opener). Everything else identical to v17. Branches from v17. Registered but NOT active (prod ships v13). Run at temperature 0.3.",
	template,
};
