import { lyricalV17 } from "./lyrical-v17";
import type { PromptVersion } from "./types";

// v24 = lyrical-v17.ts + ONE register edit (Phase-4 iteration H6). Branches from v17.
//
// Hypothesis: attack the pivot's grammatical SCAFFOLDING rather than the pivot itself. "X is not Y. It
// is Z" is built entirely out of the defining copula — both halves are "is/are" verdicts about what the
// song really is. None of v18–v22 touched the copula; they argued with the pivot at the level of the
// pattern. This edit REPLACES v17's anti-pivot line with a positive grammar mandate: build the read out
// of motion (verbs of action — what the song and its people do), and reserve "is/are" for plain fact,
// never for the verdict about what the song "really means." If the model has no defining copula to lean
// on, the pivot has nothing to ride. Affirmative, names no banned string, never says "not/isn't" of the
// pivot. Measured FREE via the tier1 cross-sentence antithesis rule; Opus spent only if the rate drops.
// Caveat to check in the manual read: a low antithesis count here could be rule-dodging (fewer copulas
// → fewer "It is" re-assertions for the regex to catch) rather than genuinely more direct prose — so
// the winner's candidates get hand-read, not trusted on the count alone. Everything else byte-identical
// to v17. ACTIVE stays v13. Run at temperature 0.3. See claudedocs/08 (H6).

const ANTI_PIVOT_LINE = `Say what something is. Don't say what it "isn't" and then pivot to what it is. A plain subordinate contrast inside a sentence is not that move and is fine: "the door stays shut, not slammed."`;

const COPULA_DISPLACEMENT_LINE = `Build the read out of motion. Reach for verbs of action — what the song and its people do, push, chase, refuse — and let "is" and "are" carry plain fact only, not the verdict about what the song "really means." A read that moves stays close to the song and sounds like a person; a read that keeps defining sounds like an essay.`;

const template = lyricalV17.template.replace(
	ANTI_PIVOT_LINE,
	COPULA_DISPLACEMENT_LINE,
);
if (template === lyricalV17.template) {
	throw new Error(
		"lyrical-v24: anti-pivot anchor not found in v17 template — edit is a no-op",
	);
}

export const lyricalV24: PromptVersion = {
	version: "24",
	kind: "lyrical",
	notes:
		"v17 + ONE register edit (Phase-4 H6): replaces v17's anti-pivot line with a positive grammar mandate that attacks the pivot's scaffolding — build the read out of motion (verbs of action) and reserve 'is/are' for plain fact, not verdicts about what the song really means. The 'X is not Y. It is Z' pivot is all defining copula; starve the copula and the pivot has nothing to ride. Affirmative, names no banned string. Measured free via the tier1 antithesis rule (with a manual read of the winner to rule out rule-dodging vs genuine directness). Everything else identical to v17. Branches from v17. Registered but NOT active (prod ships v13). Run at temperature 0.3.",
	template,
};
