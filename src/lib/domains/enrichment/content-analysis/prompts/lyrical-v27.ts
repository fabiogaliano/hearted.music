import { lyricalV17 } from "./lyrical-v17";
import type { PromptVersion } from "./types";

// v27 = lyrical-v17.ts + ONE register edit (Phase-4 iteration H9). Branches from v17.
//
// Hypothesis: the prior session concluded "naming the pivot primes it," but every failed experiment
// named it via CONCRETE bad-string examples (v20 spelled "This is not X. It is Y" as a Wrong: pair →
// rate rose to 0.56). Web research (DEV, "Why does AI keep saying it's not X, it's Y") draws the
// distinction the project missed: phrase-banning fails, but "prompts that target the behavior at the
// level of linguistic CATEGORY — prohibiting 'thesis-antithesis patterns,' 'dialectical hedging,'
// 'rhetorical equivocation' — are significantly more effective," paired with "define things
// affirmatively and treat contrastive structures as high-impact tools used sparingly." This edit
// REPLACES v17's anti-pivot line with exactly that: category-level prohibition + affirmative reframe +
// contrast-sparingly, carrying NO concrete "X is not Y" string. It is the direct A/B against v20 (same
// target, concrete strings → primed): if v27's rate sits below v20's, abstract-category naming beats
// phrase-banning for this model — a genuinely new finding for the project. Measured FREE via the tier1
// antithesis rule. Everything else byte-identical to v17. ACTIVE stays v13. Run at temperature 0.3.
// See scripts/voice-audit/experiments/changelog.md (H9).

const ANTI_PIVOT_LINE = `Say what something is. Don't say what it "isn't" and then pivot to what it is. A plain subordinate contrast inside a sentence is not that move and is fine: "the door stays shut, not slammed."`;

const CATEGORY_LEVEL_LINE = `Define affirmatively: state what something is and let the claim stand. Steer clear of thesis-antithesis patterns, dialectical hedging, and rhetorical equivocation — any move that builds a claim by negating or balancing one idea against another on the way to the point. Contrast is a high-impact tool used sparingly: at most once in a whole read, never the default shape of a sentence. A plain subordinate contrast inside a single sentence is not that move and stays fine: "the door stays shut, not slammed."`;

const template = lyricalV17.template.replace(
	ANTI_PIVOT_LINE,
	CATEGORY_LEVEL_LINE,
);
if (template === lyricalV17.template) {
	throw new Error(
		"lyrical-v27: anti-pivot anchor not found in v17 template — edit is a no-op",
	);
}

export const lyricalV27: PromptVersion = {
	version: "27",
	kind: "lyrical",
	notes:
		"v17 + ONE register edit (Phase-4 H9): replaces v17's anti-pivot line with a CATEGORY-level prohibition (thesis-antithesis patterns, dialectical hedging, rhetorical equivocation) + affirmative reframe + contrast-sparingly, carrying NO concrete bad-string example. Direct A/B against v20 (same target via concrete strings, which primed to 0.56): tests the DEV-article claim that abstract category naming beats phrase-banning. Measured free via the tier1 antithesis rule. Everything else identical to v17. Branches from v17. Registered but NOT active (prod ships v13). Run at temperature 0.3.",
	template,
};
