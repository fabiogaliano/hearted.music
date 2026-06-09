import { lyricalV17 } from "./lyrical-v17";
import type { PromptVersion } from "./types";

// v23 = lyrical-v17.ts + ONE register edit (Phase-4 iteration H5). Branches from v17.
//
// Hypothesis: the converged finding "you cannot prompt the pivot away" was reached with levers that
// all share one flaw — they NAME the pivot (v20/v21 spelled it as a "Wrong:" example → priming spike
// 0.56/0.63) or REMOVE the guidance into a vacuum (v22, flat 0.38). Web research (2026-06) on
// register steering converges hard: "larger LLMs perform WORSE on negative instructions"; "negative
// prompts shift focus toward what you're avoiding" (the priming we measured); the reliable lever is a
// PURELY AFFIRMATIVE construction rule that never references the banned pattern. v17's anti-pivot line
// is phrased negatively ("Don't say what it 'isn't'…") and even names "isn't"/"not". This edit REPLACES
// it with a pure positive production rule: name the thing, one forward claim per sentence, "both X and
// Y" when two things are true — with ZERO negation words and ZERO bad-string examples, so there is
// nothing to prime against. Measured FREE via the tier1 cross-sentence antithesis rule (runAllRules);
// Opus spent only if the rate drops below v17's 0.28. Everything else byte-identical to v17. ACTIVE
// stays v13. Run at temperature 0.3. See scripts/voice-audit/experiments/changelog.md (H5).
//
// Derived from lyricalV17.template by a single guarded replace: if the anchor line is absent the module
// throws rather than silently shipping a clone of v17 (which would burn generation budget on a no-op).

const ANTI_PIVOT_LINE = `Say what something is. Don't say what it "isn't" and then pivot to what it is. A plain subordinate contrast inside a sentence is not that move and is fine: "the door stays shut, not slammed."`;

const AFFIRMATIVE_LINE = `Say what something is, straight out, and let it stand. Name the thing, then let it act — one forward claim to a sentence, then on to the next. When two things are both true of the song, say so plainly and keep going ("a milestone and a funeral in the same breath").`;

const template = lyricalV17.template.replace(ANTI_PIVOT_LINE, AFFIRMATIVE_LINE);
if (template === lyricalV17.template) {
	throw new Error(
		"lyrical-v23: anti-pivot anchor not found in v17 template — edit is a no-op",
	);
}

export const lyricalV23: PromptVersion = {
	version: "23",
	kind: "lyrical",
	notes:
		"v17 + ONE register edit (Phase-4 H5): replaces v17's negatively-phrased anti-pivot line ('Say what something is. Don't say what it isn't…') with a PURELY affirmative construction rule — name the thing, one forward claim per sentence, 'both X and Y' when two things are true — carrying zero negation words and zero bad-string examples, so there is nothing to prime against. Tests the 2026 research consensus that positive instructions beat negative for register and that naming the pattern primes it. Measured free via the tier1 cross-sentence antithesis rule. Everything else identical to v17. Branches from v17. Registered but NOT active (prod ships v13). Run at temperature 0.3.",
	template,
};
